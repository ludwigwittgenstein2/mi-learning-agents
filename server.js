require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const cron       = require('node-cron');
const db         = require('./src/db');
const { sendSpacingReminder, sendWelcomeEmail, sendDailyReport } = require('./src/email');
const { runAgent, getSystemPrompt } = require('./src/agents');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ════════════════════════════════════════════════════════
// AUTH / LEARNER ROUTES
// ════════════════════════════════════════════════════════

// Register or login
app.post('/api/learner', async (req, res) => {
  try {
    const { email, name, apiKey, topic } = req.body;
    if (!email || !name || !apiKey) {
      return res.status(400).json({ error: 'email, name, and apiKey are required' });
    }
    if (!apiKey.startsWith('sk-ant-')) {
      return res.status(400).json({ error: 'Invalid Anthropic API key — must start with sk-ant-' });
    }

    // Quick validation: test the key with a minimal call
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey });
      await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'hi' }],
      });
    } catch (e) {
      return res.status(400).json({ error: 'API key validation failed: ' + e.message });
    }

    const learner = await db.createLearner(email, name, apiKey, topic || 'Myocardial Infarction');

    // Seed default concepts for their topic
    const defaultConcepts = [
      'Core pathophysiology', 'Diagnostic criteria', 'Management priorities',
      'Pharmacological treatment', 'Complications', 'Prognosis and follow-up'
    ];
    for (const c of defaultConcepts) {
      await db.upsertConcept(learner.id, c, learner.topic);
    }

    // Send welcome email (non-blocking)
    sendWelcomeEmail(learner).catch(console.error);

    res.json({ learner: { id: learner.id, email: learner.email, name: learner.name, topic: learner.topic } });
  } catch (err) {
    console.error('Learner creation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get learner profile + stats
app.get('/api/learner/:id', async (req, res) => {
  try {
    const learner = await db.getLearner(req.params.id);
    if (!learner) return res.status(404).json({ error: 'Learner not found' });
    const stats   = await db.getLearnerStats(req.params.id);
    const concepts = await db.getConcepts(req.params.id);
    const due     = concepts.filter(c => new Date(c.next_review) <= new Date());
    res.json({
      learner: { id: learner.id, email: learner.email, name: learner.name, topic: learner.topic },
      stats,
      concepts,
      dueCount: due.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update topic
app.patch('/api/learner/:id/topic', async (req, res) => {
  try {
    await db.updateLearnerTopic(req.params.id, req.body.topic);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login by email
app.post('/api/learner/login', async (req, res) => {
  try {
    const { email, apiKey } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    if (!apiKey) return res.status(400).json({ error: 'Anthropic API key is required' });
    if (!apiKey.startsWith('sk-ant-')) return res.status(400).json({ error: 'Invalid API key — must start with sk-ant-' });

    const learner = await db.getLearnerByEmail(email);
    if (!learner) return res.status(404).json({ error: 'No account found for this email — please register first' });

    // Validate the key with a minimal API call
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey });
      await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'hi' }],
      });
    } catch (e) {
      return res.status(400).json({ error: 'API key validation failed: ' + e.message });
    }

    // Update stored API key for this session
    await db.pool.query('UPDATE learners SET api_key = $1 WHERE id = $2', [apiKey, learner.id]);

    const stats    = await db.getLearnerStats(learner.id);
    const concepts = await db.getConcepts(learner.id);
    const due      = concepts.filter(c => new Date(c.next_review) <= new Date());
    res.json({
      learner: { id: learner.id, email: learner.email, name: learner.name, topic: learner.topic },
      stats,
      dueCount: due.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════
// AGENT ROUTES — true agentic loop with tool use
// Valid agent names: retrieval, spacing, interleaving, reflection, orchestrator
// ════════════════════════════════════════════════════════
const VALID_AGENTS = new Set(['retrieval', 'spacing', 'interleaving', 'reflection', 'orchestrator']);

app.post('/api/agent/:agentName', async (req, res) => {
  try {
    const { agentName } = req.params;
    const { learnerId, message, topic } = req.body;

    if (!VALID_AGENTS.has(agentName)) {
      return res.status(400).json({ error: `Unknown agent: ${agentName}. Valid agents: ${[...VALID_AGENTS].join(', ')}` });
    }

    if (!learnerId || !message) {
      return res.status(400).json({ error: 'learnerId and message are required' });
    }

    const apiKey = await db.getApiKey(learnerId);
    if (!apiKey) return res.status(404).json({ error: 'Learner not found' });

    const learner = await db.getLearner(learnerId);
    const agentTopic = topic || learner.topic || 'Myocardial Infarction';

    // Update last active
    await db.pool.query('UPDATE learners SET last_active = NOW() WHERE id = $1', [learnerId]);

    // Start session
    const sessionId = await db.startSession(learnerId, agentName, agentTopic);

    const context = { learnerId, agent: agentName, topic: agentTopic };
    const systemPrompt = getSystemPrompt(agentName, agentTopic);

    console.log(`\nAgent: ${agentName} | Learner: ${learnerId} | Topic: ${agentTopic}`);

    // Orchestrator: uses server API key, no tools, no session logging
    if (agentName === 'orchestrator') {
      await db.endSession(sessionId, 0);
      const serverKey = process.env.ANTHROPIC_API_KEY;
      if (!serverKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set on server' });
      const result = await runAgent(serverKey, systemPrompt, message, context, []);
      return res.json({ text: result.text, toolsUsed: 0 });
    }

    const result = await runAgent(apiKey, systemPrompt, message, context, [
      'save_answer', 'get_learner_history', 'get_learner_stats',
      'schedule_review', 'get_due_concepts', 'flag_weak_concept'
    ]);

    // End session
    await db.endSession(sessionId, result.toolsUsed || 1);

    res.json({ text: result.text, toolsUsed: result.toolsUsed });
  } catch (err) {
    console.error(`Agent error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════
// SPACING DATA ROUTES
// ════════════════════════════════════════════════════════
app.get('/api/learner/:id/concepts', async (req, res) => {
  try {
    const concepts = await db.getConcepts(req.params.id);
    res.json(concepts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/learner/:id/history', async (req, res) => {
  try {
    const history = await db.getAnswerHistory(req.params.id, 20);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════
// RESEARCH EXPORT (password protected)
// ════════════════════════════════════════════════════════
app.get('/api/research/export', async (req, res) => {
  const pw = process.env.RESEARCH_PASSWORD || 'research2026';
  if (req.query.password !== pw) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const data = await db.exportResearchData();
    res.json({ count: data.length, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════
// HEALTH CHECK
// ════════════════════════════════════════════════════════
app.get('/health', async (req, res) => {
  try {
    await db.pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', port: PORT });
  } catch (e) {
    res.json({ status: 'ok', db: 'disconnected — add DATABASE_URL', port: PORT });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ════════════════════════════════════════════════════════
// DAILY SCHEDULER — spaced repetition reminders
// Runs every day at 8:00 AM ET
// ════════════════════════════════════════════════════════
cron.schedule('0 8 * * *', async () => {
  console.log('\n[Scheduler] Running daily report…');
  try {
    // Get all active learners (not just those with due reviews)
    const result = await db.pool.query(`
      SELECT l.*, array_agg(c.name) FILTER (WHERE c.next_review <= NOW()) as due_concepts
      FROM learners l
      LEFT JOIN concepts c ON c.learner_id = l.id
      WHERE l.last_active > NOW() - INTERVAL '30 days'
      GROUP BY l.id
    `);
    const learners = result.rows;
    console.log(`[Scheduler] Sending reports to ${learners.length} learner(s)`);

    for (const learner of learners) {
      try {
        const dueConcepts = (learner.due_concepts || []).filter(Boolean);
        // Get last 24h of answers
        const histResult = await db.pool.query(`
          SELECT question, correct, gaps, score, agent
          FROM answers
          WHERE learner_id = $1 AND created_at > NOW() - INTERVAL '24 hours'
          ORDER BY created_at DESC
        `, [learner.id]);
        const recentAnswers = histResult.rows;
        const stats = await db.getLearnerStats(learner.id);

        await sendDailyReport(learner, {
          dueConcepts,
          recentAnswers,
          stats,
          learnerId: learner.id,
        });
      } catch (err) {
        console.error(`[Scheduler] Failed for ${learner.email}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[Scheduler] Error:', err.message);
  }
}, { timezone: 'America/New_York' });

// ════════════════════════════════════════════════════════
// START
// ════════════════════════════════════════════════════════
async function start() {
  try {
    if (process.env.DATABASE_URL) {
      await db.initDB();
    } else {
      console.warn('⚠  No DATABASE_URL — database features disabled. Add PostgreSQL on Railway.');
    }
  } catch (err) {
    console.warn('⚠  DB init failed:', err.message);
  }

  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║   MI Learning Agents — 4-Agent System            ║
╠══════════════════════════════════════════════════╣
║  Agents:     Retrieval, Spacing,                 ║
║              Interleaving, Reflection            ║
║  URL:        http://localhost:${PORT}               ║
║  DB:         ${process.env.DATABASE_URL ? '✓ Connected' : '✗ No DATABASE_URL set    '}              ║
║  Email:      ${process.env.RESEND_API_KEY ? '✓ Resend configured' : '✗ No RESEND_API_KEY (optional)'}       ║
║  Scheduler:  ✓ Daily at 8:00 AM ET               ║
║  Research:   /api/research/export?password=...   ║
╚══════════════════════════════════════════════════╝
    `);
  });
}

start();
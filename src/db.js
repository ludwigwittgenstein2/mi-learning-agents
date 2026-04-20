const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ── Encryption for API keys ──────────────────────────────
const ENC_KEY = process.env.ENCRYPTION_KEY || 'mi-agents-default-key-change-in-prod';
const KEY = crypto.scryptSync(ENC_KEY, 'salt', 32);

function encryptKey(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decryptKey(text) {
  const [ivHex, encHex] = text.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const enc = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', KEY, iv);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString();
}

// ── Initialize schema ────────────────────────────────────
async function initDB() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('✓ Database schema initialized');
}

// ── Learner queries ──────────────────────────────────────
async function createLearner(email, name, apiKey, topic) {
  const enc = encryptKey(apiKey);
  const res = await pool.query(
    `INSERT INTO learners (email, name, api_key_enc, topic)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE
       SET name = $2, api_key_enc = $3, topic = $4, last_active = NOW()
     RETURNING id, email, name, topic`,
    [email.toLowerCase(), name, enc, topic]
  );
  return res.rows[0];
}

async function getLearner(id) {
  const res = await pool.query('SELECT * FROM learners WHERE id = $1', [id]);
  return res.rows[0];
}

async function getLearnerByEmail(email) {
  const res = await pool.query('SELECT * FROM learners WHERE email = $1', [email.toLowerCase()]);
  return res.rows[0];
}

async function getApiKey(learnerId) {
  const res = await pool.query('SELECT api_key_enc FROM learners WHERE id = $1', [learnerId]);
  if (!res.rows[0]) return null;
  return decryptKey(res.rows[0].api_key_enc);
}

async function updateLearnerTopic(learnerId, topic) {
  await pool.query('UPDATE learners SET topic = $1, last_active = NOW() WHERE id = $2', [topic, learnerId]);
}

// ── Concept / Spacing queries ────────────────────────────
async function upsertConcept(learnerId, name, topic) {
  const res = await pool.query(
    `INSERT INTO concepts (learner_id, name, topic)
     VALUES ($1, $2, $3)
     ON CONFLICT (learner_id, name, topic) DO UPDATE SET topic = $3
     RETURNING *`,
    [learnerId, name, topic]
  );
  return res.rows[0];
}

async function getConcepts(learnerId) {
  const res = await pool.query(
    'SELECT * FROM concepts WHERE learner_id = $1 ORDER BY next_review ASC',
    [learnerId]
  );
  return res.rows;
}

async function getDueConcepts(learnerId) {
  const res = await pool.query(
    `SELECT * FROM concepts
     WHERE learner_id = $1 AND next_review <= NOW()
     ORDER BY next_review ASC`,
    [learnerId]
  );
  return res.rows;
}

// SM-2 algorithm update
async function updateConceptAfterReview(conceptId, recallScore) {
  // recallScore: 0=forgot, 1=partial, 2=good, 3=perfect
  const res = await pool.query('SELECT * FROM concepts WHERE id = $1', [conceptId]);
  const c = res.rows[0];
  if (!c) return;

  let ef = parseFloat(c.ease_factor);
  let interval = c.interval_days;
  let reps = c.reps + 1;

  // SM-2 formula
  ef = Math.max(1.3, ef + 0.1 - (3 - recallScore) * (0.08 + (3 - recallScore) * 0.02));

  if (recallScore < 2) {
    interval = 1;
    reps = 0;
  } else if (reps === 1) {
    interval = 1;
  } else if (reps === 2) {
    interval = 6;
  } else {
    interval = Math.round(interval * ef);
  }

  const retention = Math.round([20, 50, 75, 95][recallScore]);
  const nextReview = new Date(Date.now() + interval * 24 * 60 * 60 * 1000);

  await pool.query(
    `UPDATE concepts
     SET reps = $1, interval_days = $2, ease_factor = $3,
         next_review = $4, last_review = NOW(), retention_pct = $5
     WHERE id = $6`,
    [reps, interval, ef, nextReview, retention, conceptId]
  );

  return { interval, retention, nextReview };
}

// ── Answer history ───────────────────────────────────────
async function saveAnswer(learnerId, agent, topic, question, answer, score, correct, gaps, feedback) {
  const res = await pool.query(
    `INSERT INTO answers (learner_id, agent, topic, question, answer, score, correct, gaps, feedback)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [learnerId, agent, topic, question, answer, score, correct, gaps || [], feedback]
  );
  return res.rows[0].id;
}

async function getAnswerHistory(learnerId, limit = 50) {
  const res = await pool.query(
    'SELECT * FROM answers WHERE learner_id = $1 ORDER BY created_at DESC LIMIT $2',
    [learnerId, limit]
  );
  return res.rows;
}

async function getLearnerStats(learnerId) {
  const res = await pool.query(`
    SELECT
      COUNT(*)                                          AS total_answers,
      ROUND(AVG(score))                                 AS avg_score,
      ROUND(100.0 * SUM(CASE WHEN correct THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0)) AS accuracy,
      COUNT(DISTINCT agent)                             AS agents_used,
      COUNT(DISTINCT topic)                             AS topics_covered
    FROM answers WHERE learner_id = $1
  `, [learnerId]);
  return res.rows[0];
}

// ── Sessions ─────────────────────────────────────────────
async function startSession(learnerId, agent, topic) {
  const res = await pool.query(
    `INSERT INTO sessions (learner_id, agent, topic) VALUES ($1,$2,$3) RETURNING id`,
    [learnerId, agent, topic]
  );
  return res.rows[0].id;
}

async function endSession(sessionId, interactions) {
  await pool.query(
    `UPDATE sessions SET ended_at = NOW(), interactions = $1,
     duration_secs = EXTRACT(EPOCH FROM (NOW() - started_at))::int
     WHERE id = $2`,
    [interactions, sessionId]
  );
}

// ── Reminders ────────────────────────────────────────────
async function getLearnersWithDueReviews() {
  const res = await pool.query(`
    SELECT DISTINCT l.id, l.email, l.name, l.topic,
      COUNT(c.id) AS due_count,
      ARRAY_AGG(c.name) AS due_concepts
    FROM learners l
    JOIN concepts c ON c.learner_id = l.id
    WHERE c.next_review <= NOW()
    GROUP BY l.id, l.email, l.name, l.topic
  `);
  return res.rows;
}

async function saveReminder(learnerId, conceptId) {
  const res = await pool.query(
    `INSERT INTO reminders (learner_id, concept_id) VALUES ($1,$2) RETURNING id`,
    [learnerId, conceptId]
  );
  return res.rows[0].id;
}

// ── Research export ──────────────────────────────────────
async function exportResearchData() {
  const res = await pool.query(`
    SELECT
      l.email, l.name, l.topic,
      a.agent, a.question, a.score, a.correct, a.gaps,
      a.created_at
    FROM answers a
    JOIN learners l ON l.id = a.learner_id
    ORDER BY a.created_at DESC
  `);
  return res.rows;
}

module.exports = {
  pool, initDB,
  createLearner, getLearner, getLearnerByEmail, getApiKey, updateLearnerTopic,
  upsertConcept, getConcepts, getDueConcepts, updateConceptAfterReview,
  saveAnswer, getAnswerHistory, getLearnerStats,
  startSession, endSession,
  getLearnersWithDueReviews, saveReminder,
  exportResearchData,
};

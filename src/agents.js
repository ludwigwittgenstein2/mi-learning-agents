const Anthropic = require('@anthropic-ai/sdk');
const db = require('./db');

// ── Tool definitions — what agents can DO ────────────────
const TOOLS = {
  save_answer: {
    name: 'save_answer',
    description: 'Save a learner answer and assessment to the database for tracking progress over time',
    input_schema: {
      type: 'object',
      properties: {
        question:  { type: 'string', description: 'The question that was asked' },
        answer:    { type: 'string', description: 'The learner\'s answer' },
        score:     { type: 'number', description: 'Score 0-100' },
        correct:   { type: 'boolean', description: 'Whether the answer was correct' },
        gaps:      { type: 'array', items: { type: 'string' }, description: 'Knowledge gaps identified' },
        feedback:  { type: 'string', description: 'Feedback given to the learner' },
      },
      required: ['question', 'score', 'correct', 'feedback'],
    },
  },

  get_learner_history: {
    name: 'get_learner_history',
    description: 'Retrieve the learner\'s past answers and performance to personalize the current session',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of recent answers to retrieve (default 10)' },
      },
    },
  },

  schedule_review: {
    name: 'schedule_review',
    description: 'Schedule a concept for spaced repetition review using SM-2 algorithm',
    input_schema: {
      type: 'object',
      properties: {
        concept_name:  { type: 'string', description: 'Name of the concept to schedule' },
        recall_score:  { type: 'number', description: '0=forgot, 1=partial, 2=good, 3=perfect' },
      },
      required: ['concept_name', 'recall_score'],
    },
  },

  get_due_concepts: {
    name: 'get_due_concepts',
    description: 'Get all concepts currently due for spaced repetition review',
    input_schema: { type: 'object', properties: {} },
  },

  get_learner_stats: {
    name: 'get_learner_stats',
    description: 'Get aggregate statistics about the learner\'s performance across all agents',
    input_schema: { type: 'object', properties: {} },
  },

  flag_weak_concept: {
    name: 'flag_weak_concept',
    description: 'Flag a concept as weak so the spacing agent schedules it for immediate review',
    input_schema: {
      type: 'object',
      properties: {
        concept_name: { type: 'string', description: 'The concept to flag as weak' },
        reason:       { type: 'string', description: 'Why this concept needs review' },
      },
      required: ['concept_name'],
    },
  },
};

// ── Execute a tool call ──────────────────────────────────
async function executeTool(toolName, toolInput, context) {
  const { learnerId, agent, topic } = context;

  switch (toolName) {
    case 'save_answer': {
      const id = await db.saveAnswer(
        learnerId, agent, topic,
        toolInput.question, toolInput.answer || '',
        toolInput.score, toolInput.correct,
        toolInput.gaps || [], toolInput.feedback
      );
      return { success: true, answer_id: id, message: 'Answer saved to learner history' };
    }

    case 'get_learner_history': {
      const history = await db.getAnswerHistory(learnerId, toolInput.limit || 10);
      if (history.length === 0) return { history: [], message: 'No previous answers — this is the learner\'s first session' };
      const summary = history.map(h => ({
        agent: h.agent,
        question: h.question.substring(0, 80) + '...',
        score: h.score,
        correct: h.correct,
        gaps: h.gaps,
        when: h.created_at,
      }));
      return { history: summary, total: history.length };
    }

    case 'schedule_review': {
      let concept = await db.upsertConcept(learnerId, toolInput.concept_name, topic);
      const result = await db.updateConceptAfterReview(concept.id, toolInput.recall_score);
      return {
        success: true,
        concept: toolInput.concept_name,
        next_review_days: result?.interval,
        retention_pct: result?.retention,
        message: `Scheduled "${toolInput.concept_name}" for review in ${result?.interval} day(s)`
      };
    }

    case 'get_due_concepts': {
      const due = await db.getDueConcepts(learnerId);
      if (due.length === 0) return { due: [], message: 'No concepts currently due — all on schedule' };
      return {
        due: due.map(c => ({
          name: c.name,
          reps: c.reps,
          last_review: c.last_review,
          retention_pct: c.retention_pct,
          days_overdue: Math.floor((Date.now() - new Date(c.next_review)) / 86400000),
        })),
        count: due.length,
      };
    }

    case 'get_learner_stats': {
      const stats = await db.getLearnerStats(learnerId);
      return stats;
    }

    case 'flag_weak_concept': {
      // Schedule immediately (recall_score=0 → interval=1 day)
      const concept = await db.upsertConcept(learnerId, toolInput.concept_name, topic);
      await db.updateConceptAfterReview(concept.id, 0);
      return {
        success: true,
        message: `"${toolInput.concept_name}" flagged as weak — scheduled for review tomorrow`,
        reason: toolInput.reason,
      };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// ── Agentic loop — runs until agent stops calling tools ──
async function runAgent(apiKey, systemPrompt, userMessage, context, availableTools) {
  const client = new Anthropic({ apiKey });
  const tools = availableTools.map(name => TOOLS[name]).filter(Boolean);
  const messages = [{ role: 'user', content: userMessage }];
  let iterations = 0;
  const MAX_ITERATIONS = 6;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    // Only pass tools param if we have tools — empty array causes API error
    const createParams = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: systemPrompt,
      messages,
    };
    if (tools.length > 0) createParams.tools = tools;

    const response = await client.messages.create(createParams);

    // If no tool calls — agent is done, return final text
    if (response.stop_reason === 'end_turn') {
      const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
      return { text, toolsUsed: iterations - 1 };
    }

    // Process tool calls
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    if (toolUseBlocks.length === 0) {
      const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
      return { text, toolsUsed: iterations - 1 };
    }

    // Add assistant message with tool calls
    messages.push({ role: 'assistant', content: response.content });

    // Execute all tool calls and collect results
    const toolResults = [];
    for (const toolUse of toolUseBlocks) {
      console.log(`  → Tool: ${toolUse.name}`, JSON.stringify(toolUse.input).substring(0, 100));
      const result = await executeTool(toolUse.name, toolUse.input, context);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(result),
      });
    }

    // Add tool results and continue loop
    messages.push({ role: 'user', content: toolResults });
  }

  return { text: 'Agent reached maximum iterations.', toolsUsed: MAX_ITERATIONS };
}

// ── System prompts per agent ─────────────────────────────
function getSystemPrompt(agent, topic) {
  const base = `You are an agentic AI learning system for healthcare education. Current topic: ${topic}. You have access to tools to read learner history, save answers, and schedule reviews. Always use tools — do not just respond with text. Check learner history first, then act.`;

  const prompts = {
    retrieval: `${base}

You are the Retrieval Agent (Testing Effect — Roediger & Karpicke 2006).
Your agentic loop:
1. CALL get_learner_history to see what questions have already been asked and what gaps were identified
2. CALL get_learner_stats to understand overall performance
3. Generate a NEW question targeting the weakest area not recently tested
4. After receiving the learner's answer, assess it semantically
5. CALL save_answer with your assessment (score 0-100, correct true/false, gaps array, feedback)
6. CALL flag_weak_concept for any critical gap identified
7. CALL schedule_review for the concept just tested
8. Return your feedback to the learner

Always be evidence-based, clinically accurate, and specific about gaps.`,

    spacing: `${base}

You are the Spacing Agent (Ebbinghaus Forgetting Curve / SM-2 algorithm).
Your agentic loop:
1. CALL get_due_concepts to see what is currently due for review
2. Present the most overdue concept for recall
3. After the learner recalls, assess the quality of their recall (0=forgot, 1=partial, 2=good, 3=perfect)
4. CALL schedule_review with the concept name and recall score — this updates the SM-2 schedule
5. CALL save_answer to record the interaction
6. Explain what they missed and when they will see this concept again
7. Move to next due concept if any remain

The SM-2 algorithm will calculate the next review interval automatically.`,

    interleaving: `${base}

You are the Interleaving Agent (Discrimination Learning — Kornell & Bjork 2008).
Your agentic loop:
1. CALL get_learner_history to see which domains have been practiced recently
2. Randomly select a domain NOT recently practiced: Pathophysiology, Pharmacology, ECG interpretation, or Clinical management
3. Generate a question from that domain WITHOUT revealing the domain
4. After answer: reveal domain, assess domain identification, score the clinical answer
5. CALL save_answer with assessment
6. CALL flag_weak_concept if the domain identification was wrong (means discrimination failed)
7. Explain why this question belongs to that domain — the pedagogical insight`,

    generation: `${base}

You are the Generation Agent (Generation Effect — Slamecka & Graf 1978).
Your agentic loop:
1. CALL get_learner_history to see what gaps have been identified before
2. CALL get_learner_stats to understand current level
3. Select a concept the learner has NOT recently generated about, or one where gaps were found
4. Present a generation cue (NOT the answer)
5. After generation: compare to expert knowledge, identify SPECIFIC gaps
6. CALL save_answer with identified gaps
7. CALL flag_weak_concept for the most critical gap
8. CALL schedule_review to schedule the concept
9. Ask a targeted consolidation question about the most important gap`,

    elaboration: `${base}

You are the Elaboration Agent (Elaborative Interrogation — Pressley et al. 1992).
Your agentic loop:
1. CALL get_learner_history to understand current depth of knowledge
2. Start with a clinical-level why/how question
3. Read the learner's elaboration and DECIDE: deeper, redirect, or consolidate
4. CALL save_answer after each exchange
5. If going deeper: generate the next mechanistic question
6. If redirecting: address the misconception, then re-probe
7. If consolidating: CALL schedule_review for this concept
8. Build a Socratic path through 3 levels: Clinical → Physiological → Molecular`,

    reflection: `${base}

You are the Reflection Agent (Metacognitive Reflection — Schön 1983 / Flavell 1979).
Your agentic loop:
1. CALL get_learner_stats to understand overall performance
2. CALL get_learner_history to find patterns in errors and gaps
3. Present a targeted reflection prompt based on ACTUAL gaps found in history
4. Read the reflection and identify: genuine insights vs blind spots
5. CALL save_answer recording the reflection quality
6. CALL flag_weak_concept for any blind spot that reveals a critical knowledge gap
7. Generate a Socratic follow-up that challenges the most significant blind spot
This agent is evidence-based — reflections are grounded in actual performance data.`,

    difficulty: `${base}

You are the Difficulty Agent (Desirable Difficulties — Bjork 1994).
Your agentic loop:
1. CALL get_learner_stats to calibrate starting difficulty
2. CALL get_learner_history to see recent performance trajectory
3. Select difficulty level (1-4) targeting 60-70% success rate based on recent scores
4. Generate a question at the selected difficulty
5. After answer: score it (0-100)
6. CALL save_answer
7. Autonomously decide: escalate (score>75), hold (50-75), reduce (score<50)
8. Explain decision and preview next question level
Target: keep learner in the productive difficulty zone — never too easy, never frustrating.`,
  };

  prompts.orchestrator = `You are the orchestrator of a 7-agent learning system for healthcare education on ${topic}. The agents are: Retrieval (testing effect), Spacing (forgetting curve/SM-2), Interleaving (discrimination learning), Generation (generation effect), Elaboration (elaborative interrogation), Reflection (metacognition/Schon), Difficulty (desirable difficulties/Bjork). Given a learner profile, rank all 7 agents by current learning need and give a 1-sentence rationale for each. Return ONLY valid JSON, no other text: {"rankings":[{"agent":"Retrieval","urgency":"high|medium|low","rationale":"one sentence reason"},{"agent":"Spacing","urgency":"...","rationale":"..."},{"agent":"Interleaving","urgency":"...","rationale":"..."},{"agent":"Generation","urgency":"...","rationale":"..."},{"agent":"Elaboration","urgency":"...","rationale":"..."},{"agent":"Reflection","urgency":"...","rationale":"..."},{"agent":"Difficulty","urgency":"...","rationale":"..."}]}`;

  return prompts[agent] || base;
}

module.exports = { runAgent, getSystemPrompt, TOOLS };

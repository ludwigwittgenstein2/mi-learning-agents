-- ═══════════════════════════════════════════════════════
-- MI Learning Agents — Database Schema
-- Rejeleene & Mehta · Cleveland Clinic · 2026
-- ═══════════════════════════════════════════════════════

-- Learners (one row per user)
CREATE TABLE IF NOT EXISTS learners (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  api_key_enc   TEXT NOT NULL,          -- AES-encrypted Anthropic key
  topic         TEXT DEFAULT 'Myocardial Infarction',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_active   TIMESTAMPTZ DEFAULT NOW()
);

-- Concepts tracked per learner (spaced repetition schedule)
CREATE TABLE IF NOT EXISTS concepts (
  id            SERIAL PRIMARY KEY,
  learner_id    INTEGER REFERENCES learners(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  topic         TEXT NOT NULL,
  reps          INTEGER DEFAULT 0,
  interval_days INTEGER DEFAULT 1,
  ease_factor   NUMERIC DEFAULT 2.5,    -- SM-2 ease factor
  next_review   TIMESTAMPTZ DEFAULT NOW(),
  last_review   TIMESTAMPTZ,
  retention_pct INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(learner_id, name, topic)
);

-- Answer history (every agent interaction)
CREATE TABLE IF NOT EXISTS answers (
  id            SERIAL PRIMARY KEY,
  learner_id    INTEGER REFERENCES learners(id) ON DELETE CASCADE,
  agent         TEXT NOT NULL,          -- retrieval|spacing|interleaving|generation|elaboration|reflection|difficulty
  topic         TEXT NOT NULL,
  question      TEXT NOT NULL,
  answer        TEXT,
  score         INTEGER,               -- 0-100
  correct       BOOLEAN,
  gaps          TEXT[],                -- array of identified gaps
  feedback      TEXT,                  -- agent feedback given
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Agent sessions (each time a learner uses an agent)
CREATE TABLE IF NOT EXISTS sessions (
  id            SERIAL PRIMARY KEY,
  learner_id    INTEGER REFERENCES learners(id) ON DELETE CASCADE,
  agent         TEXT NOT NULL,
  topic         TEXT NOT NULL,
  duration_secs INTEGER,
  interactions  INTEGER DEFAULT 0,
  started_at    TIMESTAMPTZ DEFAULT NOW(),
  ended_at      TIMESTAMPTZ
);

-- Email reminders sent
CREATE TABLE IF NOT EXISTS reminders (
  id            SERIAL PRIMARY KEY,
  learner_id    INTEGER REFERENCES learners(id) ON DELETE CASCADE,
  concept_id    INTEGER REFERENCES concepts(id) ON DELETE CASCADE,
  sent_at       TIMESTAMPTZ DEFAULT NOW(),
  opened        BOOLEAN DEFAULT FALSE,
  review_done   BOOLEAN DEFAULT FALSE
);

-- Orchestrator recommendations log (for research data)
CREATE TABLE IF NOT EXISTS recommendations (
  id            SERIAL PRIMARY KEY,
  learner_id    INTEGER REFERENCES learners(id) ON DELETE CASCADE,
  recommended   TEXT NOT NULL,         -- agent recommended
  urgency       TEXT,
  rationale     TEXT,
  accepted      BOOLEAN,              -- did learner click it?
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_concepts_learner    ON concepts(learner_id);
CREATE INDEX IF NOT EXISTS idx_concepts_next_review ON concepts(next_review);
CREATE INDEX IF NOT EXISTS idx_answers_learner     ON answers(learner_id);
CREATE INDEX IF NOT EXISTS idx_sessions_learner    ON sessions(learner_id);

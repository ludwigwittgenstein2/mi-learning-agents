# MI Learning Agents v2.0 — Full Agentic System

Theory-grounded agentic AI for healthcare education.
7 agents with real tool use, persistent learner profiles, spaced repetition email reminders, and research data export.

**Rejeleene & Mehta · Cleveland Clinic · 2026**

---

## What makes this genuinely agentic

Each agent runs a tool-use loop (not just text generation):

1. **Calls `get_learner_history`** — reads your actual past answers and gaps
2. **Calls `get_learner_stats`** — checks your overall performance
3. **Reasons** about what to do based on real data
4. **Generates** a personalized question or prompt
5. **Receives** your answer
6. **Calls `save_answer`** — records the interaction to the database
7. **Calls `schedule_review`** — updates the SM-2 spaced repetition schedule
8. **Calls `flag_weak_concept`** — marks gaps for priority review

This is a perception → reasoning → action loop. Claude is not just generating text — it is reading state, deciding actions, and writing back to a database.

---

## Quick start

### 1. Clone / unzip and install
```bash
npm install
```

### 2. Add PostgreSQL database on Railway
Railway dashboard → your project → **+ New** → **Database** → **PostgreSQL**
Railway automatically sets `DATABASE_URL`.

### 3. Set environment variables on Railway
Go to your project → **Variables** → add:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | Set automatically by Railway PostgreSQL |
| `ENCRYPTION_KEY` | Any random 32-character string |
| `RESEND_API_KEY` | From resend.com (free, optional) |
| `FROM_EMAIL` | Your verified sender email |
| `BASE_URL` | Your Railway app URL |
| `RESEARCH_PASSWORD` | Password for data export |

### 4. Deploy
Push to GitHub → Railway auto-deploys.

Or run locally:
```bash
cp .env.example .env
# Fill in .env values
node server.js
```

---

## User flow

1. Learner opens the app
2. Enters name, email, and their own Anthropic API key
3. Key is AES-256 encrypted and stored in PostgreSQL
4. All 7 agents use their key — you pay nothing
5. Spaced repetition schedule builds automatically
6. Daily emails remind them when concepts are due
7. All interactions logged for research export

---

## Research data export

```
GET /api/research/export?password=your-research-password
```

Returns JSON with all learner interactions:
- Agent used
- Question asked
- Learner answer
- Score (0-100)
- Gaps identified
- Timestamp

Export to CSV for your results section.

---

## Architecture

```
Learner → index.html
    ↓ POST /api/learner (register/login)
    ↓ POST /api/agent/:name (agent session)
         ↓
    server.js → agents.js (tool-use loop)
         ↓              ↓
    db.js          Anthropic API
    (PostgreSQL)   (learner's key)
         ↓
    Daily cron → email.js → Resend SMTP
```

---

## The 7 agents and their tools

| Agent | Theory | Tools called |
|-------|--------|-------------|
| Retrieval | Testing Effect | get_learner_history, save_answer, flag_weak_concept, schedule_review |
| Spacing | Forgetting Curve / SM-2 | get_due_concepts, schedule_review, save_answer |
| Interleaving | Discrimination Learning | get_learner_history, save_answer, flag_weak_concept |
| Generation | Generation Effect | get_learner_history, get_learner_stats, save_answer, flag_weak_concept, schedule_review |
| Elaboration | Elaborative Interrogation | get_learner_history, save_answer, schedule_review |
| Reflection | Metacognition / Schön | get_learner_stats, get_learner_history, save_answer, flag_weak_concept |
| Difficulty | Desirable Difficulties / Bjork | get_learner_stats, get_learner_history, save_answer |

---

## Cost estimate (Railway)

| Component | Cost |
|-----------|------|
| Railway server | ~$0.50/month |
| Railway PostgreSQL | Free (100MB) |
| Resend email | Free (3000/month) |
| Anthropic API | Paid by each user with their own key |
| **Total to you** | **~$0.50/month** |

<<<<<<< HEAD
# mi-learning-agents
Applying Education Learning theory to AI Agents
=======
# MI Learning Agents — Agentic AI System

Theory-grounded AI learning agents for healthcare education.
7 agents, each backed by Claude claude-sonnet-4-20250514, implementing validated learning science mechanisms.

Rejeleene & Mehta · Cleveland Clinic · 2026

---

## Quick Start (3 steps)

### 1. Install dependencies
```bash
npm install
```

### 2. Set your Anthropic API key
Get your key at: https://console.anthropic.com

**Mac / Linux:**
```bash
export ANTHROPIC_API_KEY=sk-ant-your-key-here
```

**Windows (Command Prompt):**
```cmd
set ANTHROPIC_API_KEY=sk-ant-your-key-here
```

**Windows (PowerShell):**
```powershell
$env:ANTHROPIC_API_KEY="sk-ant-your-key-here"
```

### 3. Start the server
```bash
node server.js
```

Then open **http://localhost:3000** in your browser.

---

## Sharing with others on your network

Find your local IP address:
- Mac/Linux: `ifconfig` or `ip addr`
- Windows: `ipconfig`

Others on the same Wi-Fi can open:
```
http://YOUR_IP_ADDRESS:3000
```

Example: `http://192.168.1.42:3000`

---

## Deploying publicly (optional)

To share with anyone on the internet, deploy to Railway, Render, or Fly.io:

### Railway (easiest)
1. Install Railway CLI: `npm install -g @railway/cli`
2. `railway login`
3. `railway init` (in this folder)
4. Set environment variable in Railway dashboard: `ANTHROPIC_API_KEY=sk-ant-...`
5. `railway up`

### Render
1. Push this folder to a GitHub repo
2. Create a new Web Service on render.com
3. Set `ANTHROPIC_API_KEY` in environment variables
4. Build command: `npm install`
5. Start command: `node server.js`

---

## Project structure

```
mi-server/
├── server.js          ← Express proxy server
├── package.json       ← Dependencies
├── README.md          ← This file
└── public/
    └── index.html     ← Full agentic frontend (all 7 agents)
```

---

## The 7 Agents

| Agent | Theory | What the AI does |
|-------|--------|-----------------|
| Retrieval | Testing Effect | Generates questions, semantically assesses free-text answers, targets gaps |
| Spacing | Forgetting Curve / SM-2 | Reads recall quality, infers retention, sets next review interval |
| Interleaving | Discrimination Learning | Generates mixed-domain questions, assesses domain identification |
| Generation | Generation Effect | Reads your generation, compares to expert knowledge, identifies gaps |
| Elaboration | Elaborative Interrogation | Reads elaboration depth, decides to go deeper / redirect / consolidate |
| Reflection | Metacognition / Schön | Identifies blind spots and metacognitive errors in your reflection |
| Difficulty | Desirable Difficulties / Bjork | Autonomously escalates, holds, or reduces challenge based on response |

---

## Architecture note (for the paper)

What makes this genuinely agentic vs. a tool:

- **Perception**: Each agent reads free-text learner responses semantically
- **Reasoning**: Claude reasons about the quality, depth, and gaps in responses
- **Action**: Agents generate new content, adjust parameters, decide next steps
- **Memory**: Learner profile and concept mastery update across sessions
- **Goal-directed**: Each agent pursues a specific pedagogical objective
- **Orchestration**: The Recommend panel uses Claude to rank agents based on live learner state

The proxy server keeps your API key secure — it never appears in the browser.
>>>>>>> 8dd8c01 (MI Learning Agents)

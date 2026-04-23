// Uses Resend HTTP API (not SMTP) — works on all hosting platforms
// Free tier: 100 emails/day, 3000/month — resend.com

const BASE_URL = process.env.BASE_URL || 'https://mi-learning-agents-production.up.railway.app';
const FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';

async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) {
    console.log(`[EMAIL SKIPPED] No RESEND_API_KEY — would send to ${to}`);
    return false;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: `MI Learning Agents <${FROM_EMAIL}>`, to, subject, html }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.message || JSON.stringify(data));
  return data;
}

// ── Daily learning report ────────────────────────────────
async function sendDailyReport(learner, { dueConcepts, recentAnswers, stats, learnerId }) {
  const appUrl = `${BASE_URL}?learner=${learnerId}&agent=retrieval`;
  const spacingUrl = `${BASE_URL}?learner=${learnerId}&agent=spacing`;

  // Wrong answers from last 24h
  const wrongAnswers = recentAnswers.filter(a => !a.correct);
  const totalRecent = recentAnswers.length;
  const correctRecent = recentAnswers.filter(a => a.correct).length;
  const accuracy = totalRecent > 0 ? Math.round(correctRecent / totalRecent * 100) : null;

  // Weak concepts from wrong answers
  const weakConcepts = [...new Set(
    wrongAnswers.flatMap(a => a.gaps || []).filter(Boolean)
  )].slice(0, 5);

  const accuracyColor = accuracy === null ? '#5a5652' : accuracy >= 80 ? '#4a9a5a' : accuracy >= 60 ? '#b45309' : '#c0392b';
  const accuracyLabel = accuracy === null ? 'No attempts yet' : accuracy >= 80 ? 'Strong' : accuracy >= 60 ? 'Needs work' : 'Needs review';

  const wrongAnswersHtml = wrongAnswers.length === 0 ? '' : `
    <div style="background:#1e1e1e;border-radius:8px;padding:16px 18px;margin-bottom:16px">
      <div style="font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#c0392b;margin-bottom:12px">
        ✗ Questions to retake (${wrongAnswers.length})
      </div>
      ${wrongAnswers.slice(0, 5).map(a => `
        <div style="padding:8px 0;border-bottom:0.5px solid rgba(255,255,255,0.06)">
          <div style="font-size:12px;color:#e0ddd8;line-height:1.5;margin-bottom:4px">
            ${a.question ? a.question.substring(0, 100) + (a.question.length > 100 ? '…' : '') : 'Question'}
          </div>
          ${a.gaps && a.gaps.length > 0 ? `
            <div style="font-size:11px;color:#b45309">
              Gap: ${a.gaps.slice(0, 2).join(', ')}
            </div>` : ''}
        </div>`).join('')}
    </div>`;

  const weakConceptsHtml = weakConcepts.length === 0 ? '' : `
    <div style="background:#1e1e1e;border-radius:8px;padding:16px 18px;margin-bottom:16px">
      <div style="font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#b45309;margin-bottom:10px">
        Weak concepts to focus on
      </div>
      ${weakConcepts.map(c => `
        <div style="padding:5px 0;border-bottom:0.5px solid rgba(255,255,255,0.06);font-size:12px;color:#e0ddd8">
          · ${c}
        </div>`).join('')}
    </div>`;

  const dueConceptsHtml = dueConcepts.length === 0 ? '' : `
    <div style="background:#1e1e1e;border-radius:8px;padding:16px 18px;margin-bottom:16px">
      <div style="font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#5a5652;margin-bottom:10px">
        Due for spaced review (${dueConcepts.length})
      </div>
      ${dueConcepts.map(c => `
        <div style="padding:5px 0;border-bottom:0.5px solid rgba(255,255,255,0.06);font-size:12px;color:#e0ddd8">
          · ${c}
        </div>`).join('')}
    </div>`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:580px;margin:40px auto;padding:40px 36px;background:#161616;border-radius:12px;border:0.5px solid rgba(255,255,255,0.1)">

    <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#5a5652;margin-bottom:20px">
      MI Learning Agents · Daily Report · ${new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' })}
    </div>

    <div style="font-family:Georgia,serif;font-size:24px;color:#f0ede8;margin-bottom:8px;line-height:1.2">
      Your learning report, ${learner.name.split(' ')[0]}
    </div>

    <div style="font-size:13px;color:#9a9690;line-height:1.7;margin-bottom:24px">
      Topic: ${learner.topic || 'Myocardial Infarction'}
    </div>

    <!-- Performance summary -->
    <div style="display:flex;gap:12px;margin-bottom:16px">
      <div style="flex:1;background:#1e1e1e;border-radius:8px;padding:14px 16px;text-align:center">
        <div style="font-size:28px;font-weight:600;color:${accuracyColor}">${accuracy !== null ? accuracy + '%' : '—'}</div>
        <div style="font-size:10px;color:#5a5652;margin-top:4px;text-transform:uppercase;letter-spacing:.05em">Accuracy</div>
        <div style="font-size:11px;color:${accuracyColor};margin-top:2px">${accuracyLabel}</div>
      </div>
      <div style="flex:1;background:#1e1e1e;border-radius:8px;padding:14px 16px;text-align:center">
        <div style="font-size:28px;font-weight:600;color:#e0ddd8">${totalRecent}</div>
        <div style="font-size:10px;color:#5a5652;margin-top:4px;text-transform:uppercase;letter-spacing:.05em">Questions (24h)</div>
        <div style="font-size:11px;color:#5a5652;margin-top:2px">${correctRecent} correct · ${wrongAnswers.length} wrong</div>
      </div>
      <div style="flex:1;background:#1e1e1e;border-radius:8px;padding:14px 16px;text-align:center">
        <div style="font-size:28px;font-weight:600;color:${dueConcepts.length > 0 ? '#c0392b' : '#4a9a5a'}">${dueConcepts.length}</div>
        <div style="font-size:10px;color:#5a5652;margin-top:4px;text-transform:uppercase;letter-spacing:.05em">Due for review</div>
        <div style="font-size:11px;color:#5a5652;margin-top:2px">${dueConcepts.length > 0 ? 'Review now' : 'All on track'}</div>
      </div>
    </div>

    ${wrongAnswersHtml}
    ${weakConceptsHtml}
    ${dueConceptsHtml}

    <!-- CTA buttons -->
    <div style="display:flex;gap:10px;margin-bottom:24px;flex-wrap:wrap">
      ${wrongAnswers.length > 0 ? `
        <a href="${appUrl}" style="display:inline-block;padding:12px 20px;background:#c0392b;color:#fff;border-radius:8px;
          text-decoration:none;font-size:13px;font-weight:600">
          Retake missed questions →
        </a>` : ''}
      ${dueConcepts.length > 0 ? `
        <a href="${spacingUrl}" style="display:inline-block;padding:12px 20px;background:#c9b99a;color:#0f0f0f;border-radius:8px;
          text-decoration:none;font-size:13px;font-weight:600">
          Start spacing review →
        </a>` : ''}
      ${wrongAnswers.length === 0 && dueConcepts.length === 0 ? `
        <a href="${appUrl}" style="display:inline-block;padding:12px 20px;background:#c9b99a;color:#0f0f0f;border-radius:8px;
          text-decoration:none;font-size:13px;font-weight:600">
          Continue learning →
        </a>` : ''}
    </div>

    <div style="padding-top:20px;border-top:0.5px solid rgba(255,255,255,0.07);font-size:11px;color:#5a5652;line-height:1.7">
      MI Learning Agents · Rejeleene &amp; Mehta · Cleveland Clinic 2026<br>
      Spaced repetition · Testing effect · Metacognitive reflection
    </div>
  </div>
</body>
</html>`;

  try {
    const subject = wrongAnswers.length > 0
      ? `${wrongAnswers.length} question${wrongAnswers.length > 1 ? 's' : ''} to retake · ${accuracy}% accuracy · MI Learning`
      : dueConcepts.length > 0
        ? `${dueConcepts.length} concept${dueConcepts.length > 1 ? 's' : ''} due for review · MI Learning`
        : `Daily report · MI Learning Agents`;

    await sendEmail(learner.email, subject, html);
    console.log(`✓ Daily report sent to ${learner.email} (accuracy: ${accuracy}%, wrong: ${wrongAnswers.length}, due: ${dueConcepts.length})`);
    return true;
  } catch (err) {
    console.error(`✗ Daily report failed for ${learner.email}:`, err.message);
    return false;
  }
}

// ── Welcome email ────────────────────────────────────────
async function sendWelcomeEmail(learner) {
  const appUrl = `${BASE_URL}?learner=${learner.id}`;

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:560px;margin:40px auto;padding:40px 36px;background:#161616;border-radius:12px;border:0.5px solid rgba(255,255,255,0.1)">

    <div style="font-family:Georgia,serif;font-size:24px;color:#f0ede8;margin-bottom:8px">
      Welcome, ${learner.name.split(' ')[0]}
    </div>

    <div style="font-size:13px;color:#9a9690;line-height:1.7;margin-bottom:24px">
      Your learning profile has been created. You now have access to 4 theory-grounded
      AI agents for healthcare education, each implementing a validated learning science mechanism.
    </div>

    <div style="background:#1e1e1e;border-radius:8px;padding:16px 18px;margin-bottom:24px">
      <div style="font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#5a5652;margin-bottom:12px">Your 4 agents</div>
      ${[
        ['Retrieval',    'Testing Effect'],
        ['Spacing',      'Forgetting Curve'],
        ['Interleaving', 'Discrimination Learning'],
        ['Reflection',   'Metacognition'],
      ].map(([a,t]) => `<div style="padding:5px 0;border-bottom:0.5px solid rgba(255,255,255,0.06);font-size:12px;color:#e0ddd8">${a} <span style="color:#5a5652">· ${t}</span></div>`).join('')}
    </div>

    <div style="font-size:13px;color:#9a9690;line-height:1.7;margin-bottom:24px">
      Each morning you will receive a daily report showing your accuracy, questions you got wrong, weak concepts to focus on, and concepts due for spaced repetition review.
    </div>

    <a href="${appUrl}"
       style="display:inline-block;padding:12px 24px;background:#c9b99a;color:#0f0f0f;border-radius:8px;
              text-decoration:none;font-size:13px;font-weight:600">
      Open your learning dashboard →
    </a>

    <div style="margin-top:32px;padding-top:20px;border-top:0.5px solid rgba(255,255,255,0.07);
                font-size:11px;color:#5a5652">
      MI Learning Agents · Rejeleene &amp; Mehta · Cleveland Clinic 2026
    </div>
  </div>
</body>
</html>`;

  try {
    await sendEmail(learner.email, 'Welcome to MI Learning Agents', html);
    console.log(`✓ Welcome email sent to ${learner.email}`);
  } catch (err) {
    console.error(`✗ Welcome email failed:`, err.message);
  }
}

// ── Legacy spacing reminder (kept for compatibility) ─────
async function sendSpacingReminder(learner, dueConcepts, learnerId) {
  return sendDailyReport(learner, { dueConcepts, recentAnswers: [], stats: {}, learnerId });
}

module.exports = { sendSpacingReminder, sendWelcomeEmail, sendDailyReport };
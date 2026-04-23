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

  if (!response.ok) {
    throw new Error(data.message || JSON.stringify(data));
  }

  return data;
}

// ── Spaced repetition reminder ───────────────────────────
async function sendSpacingReminder(learner, dueConcepts, learnerId) {
  const conceptList = dueConcepts.map(c => `<li style="padding:4px 0;color:#e0ddd8">${c}</li>`).join('');
  const reviewUrl = `${BASE_URL}?learner=${learnerId}&agent=spacing`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:560px;margin:40px auto;padding:40px 36px;background:#161616;border-radius:12px;border:0.5px solid rgba(255,255,255,0.1)">

    <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#5a5652;margin-bottom:20px">
      MI Learning Agents · ${learner.topic || 'Healthcare Education'}
    </div>

    <div style="font-family:Georgia,serif;font-size:24px;color:#f0ede8;margin-bottom:8px;line-height:1.2">
      Time to review, ${learner.name.split(' ')[0]}
    </div>

    <div style="font-size:13px;color:#9a9690;line-height:1.7;margin-bottom:24px">
      The spacing agent has identified ${dueConcepts.length} concept${dueConcepts.length > 1 ? 's' : ''} that
      are at the optimal point on the forgetting curve for re-encoding.
      Reviewing now produces the largest memory consolidation per minute invested.
    </div>

    <div style="background:#1e1e1e;border-radius:8px;padding:16px 18px;margin-bottom:24px">
      <div style="font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#5a5652;margin-bottom:10px">Due for review</div>
      <ul style="margin:0;padding:0 0 0 16px">
        ${conceptList}
      </ul>
    </div>

    <a href="${reviewUrl}"
       style="display:inline-block;padding:12px 24px;background:#c9b99a;color:#0f0f0f;border-radius:8px;
              text-decoration:none;font-size:13px;font-weight:600;letter-spacing:.01em">
      Start review session →
    </a>

    <div style="margin-top:32px;padding-top:20px;border-top:0.5px solid rgba(255,255,255,0.07);
                font-size:11px;color:#5a5652;line-height:1.7">
      Spacing Agent · SM-2 algorithm (Wozniak 1987)<br>
      Theory: Ebbinghaus forgetting curve · reviewing at ~70% retention produces maximum consolidation<br><br>
      MI Learning Agents · Rejeleene &amp; Mehta · Cleveland Clinic 2026
    </div>
  </div>
</body>
</html>`;

  try {
    await sendEmail(
      learner.email,
      `Review due: ${dueConcepts.length} concept${dueConcepts.length > 1 ? 's' : ''} · ${learner.topic || 'Healthcare Education'}`,
      html
    );
    console.log(`✓ Reminder sent to ${learner.email}`);
    return true;
  } catch (err) {
    console.error(`✗ Reminder failed for ${learner.email}:`, err.message);
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

    <a href="${appUrl}"
       style="display:inline-block;padding:12px 24px;background:#c9b99a;color:#0f0f0f;border-radius:8px;
              text-decoration:none;font-size:13px;font-weight:600">
      Open your learning dashboard →
    </a>

    <div style="margin-top:32px;padding-top:20px;border-top:0.5px solid rgba(255,255,255,0.07);
                font-size:11px;color:#5a5652">
      MI Learning Agents · Rejeleene &amp; Mehta · Cleveland Clinic 2026<br>
      You will receive spaced repetition reminders when concepts are due for review.
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

module.exports = { sendSpacingReminder, sendWelcomeEmail };
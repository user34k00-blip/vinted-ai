const crypto = require('crypto');
const nodemailer = require('nodemailer');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
const APP_URL = process.env.APP_URL || 'https://project-ys1js.vercel.app';
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_PASS;

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'vintedai_salt_2024').digest('hex');
}
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function supabase(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SECRET,
      'Authorization': `Bearer ${SUPABASE_SECRET}`,
      'Prefer': method === 'POST' ? 'return=representation' : ''
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  if (!text || text.trim() === '') return [];
  try { return JSON.parse(text); } catch(e) { return []; }
}

function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_PASS }
  });
}

async function sendVerificationEmail(email, code) {
  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from: `"VintedAI" <${GMAIL_USER}>`,
      to: email,
      subject: 'Ton code de vérification VintedAI',
      html: `
        <div style="font-family:sans-serif;max-width:400px;margin:0 auto;background:#12121a;color:#f0f0f8;padding:40px;border-radius:16px">
          <h2 style="color:#09f9b0;margin-bottom:8px">VintedAI</h2>
          <p style="color:#6a6a8a;margin-bottom:32px">Ton code de vérification</p>
          <div style="background:#1a1a26;border:1px solid #2a2a3a;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
            <div style="font-size:2.5rem;font-weight:800;letter-spacing:0.2em;color:#f0f0f8">${code}</div>
          </div>
          <p style="color:#6a6a8a;font-size:13px">Ce code expire dans 10 minutes.<br>Si tu n'as pas demandé ce code, ignore cet email.</p>
        </div>
      `
    });
    return true;
  } catch(e) {
    console.error('Email error:', e.message);
    return false;
  }
}

async function sendResetEmail(email, token) {
  try {
    const resetUrl = `${APP_URL}?reset_token=${token}`;
    const transporter = createTransporter();
    await transporter.sendMail({
      from: `"VintedAI" <${GMAIL_USER}>`,
      to: email,
      subject: 'Réinitialisation de ton mot de passe VintedAI',
      html: `
        <div style="font-family:sans-serif;max-width:400px;margin:0 auto;background:#12121a;color:#f0f0f8;padding:40px;border-radius:16px">
          <h2 style="color:#09f9b0;margin-bottom:8px">VintedAI</h2>
          <p style="color:#6a6a8a;margin-bottom:24px">Tu as demandé à réinitialiser ton mot de passe.</p>
          <a href="${resetUrl}" style="display:block;background:linear-gradient(135deg,#09f9b0,#06d4a0);color:#0a0a0f;text-decoration:none;padding:16px 24px;border-radius:12px;text-align:center;font-weight:700;font-size:15px;margin-bottom:24px">
            Réinitialiser mon mot de passe →
          </a>
          <p style="color:#6a6a8a;font-size:12px">Ce lien expire dans 30 minutes.<br>Si tu n'as pas fait cette demande, ignore cet email.</p>
        </div>
      `
    });
    return true;
  } catch(e) {
    console.error('Reset email error:', e.message);
    return false;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, email, password, code, token } = req.body;

  // ── INSCRIPTION ────────────────────────────────────────────────
  if (action === 'register') {
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
    if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 min)' });
    const emailLower = email.toLowerCase().trim();
    const hash = hashPassword(password);
    const verifyCode = generateCode();
    const verifyExpires = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const existing = await supabase('GET', `/users?email=eq.${encodeURIComponent(emailLower)}&select=id,is_verified`);
    if (existing.length > 0 && existing[0].is_verified) return res.status(400).json({ error: 'Cet email est déjà utilisé' });

    if (existing.length > 0) {
      await supabase('PATCH', `/users?email=eq.${encodeURIComponent(emailLower)}`, { password_hash: hash, verify_code: verifyCode, verify_expires: verifyExpires, is_verified: false });
    } else {
      const newUser = await supabase('POST', '/users', { email: emailLower, password_hash: hash, daily_count: 0, last_reset: new Date().toISOString().split('T')[0], is_verified: false, verify_code: verifyCode, verify_expires: verifyExpires });
      if (!newUser || newUser.error) return res.status(500).json({ error: 'Erreur création compte' });
    }

    await sendVerificationEmail(emailLower, verifyCode);
    return res.status(200).json({ success: true, action: 'verify_required', email: emailLower });
  }

  // ── VÉRIFICATION CODE ──────────────────────────────────────────
  if (action === 'verify_email') {
    if (!email || !code) return res.status(400).json({ error: 'Email et code requis' });
    const emailLower = email.toLowerCase().trim();
    const users = await supabase('GET', `/users?email=eq.${encodeURIComponent(emailLower)}&select=*`);
    if (!users || users.length === 0) return res.status(400).json({ error: 'Compte introuvable' });

    const user = users[0];
    if (user.verify_code !== code) return res.status(400).json({ error: 'Code incorrect' });
    if (new Date(user.verify_expires) < new Date()) return res.status(400).json({ error: 'Code expiré, recommence' });

    await supabase('PATCH', `/users?email=eq.${encodeURIComponent(emailLower)}`, { is_verified: true, verify_code: null, verify_expires: null });
    return res.status(200).json({ success: true, user: { id: user.id, email: user.email, is_premium: user.is_premium, daily_count: user.daily_count } });
  }

  // ── RENVOI CODE ────────────────────────────────────────────────
  if (action === 'resend_code') {
    if (!email) return res.status(400).json({ error: 'Email requis' });
    const emailLower = email.toLowerCase().trim();
    const verifyCode = generateCode();
    const verifyExpires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await supabase('PATCH', `/users?email=eq.${encodeURIComponent(emailLower)}`, { verify_code: verifyCode, verify_expires: verifyExpires });
    await sendVerificationEmail(emailLower, verifyCode);
    return res.status(200).json({ success: true });
  }

  // ── CONNEXION ──────────────────────────────────────────────────
  if (action === 'login') {
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
    const emailLower = email.toLowerCase().trim();
    const hash = hashPassword(password);
    const users = await supabase('GET', `/users?email=eq.${encodeURIComponent(emailLower)}&select=*`);
    if (!users || users.length === 0) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

    const user = users[0];
    if (user.password_hash !== hash) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

    if (!user.is_verified) {
      const verifyCode = generateCode();
      const verifyExpires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await supabase('PATCH', `/users?email=eq.${encodeURIComponent(emailLower)}`, { verify_code: verifyCode, verify_expires: verifyExpires });
      await sendVerificationEmail(emailLower, verifyCode);
      return res.status(200).json({ success: true, action: 'verify_required', email: emailLower });
    }

    const today = new Date().toISOString().split('T')[0];
    if (user.last_reset !== today) {
      await supabase('PATCH', `/users?id=eq.${user.id}`, { daily_count: 0, last_reset: today });
      user.daily_count = 0;
    }
    return res.status(200).json({ success: true, user: { id: user.id, email: user.email, is_premium: user.is_premium, daily_count: user.daily_count } });
  }

  // ── MOT DE PASSE OUBLIÉ ────────────────────────────────────────
  if (action === 'forgot_password') {
    if (!email) return res.status(400).json({ error: 'Email requis' });
    const emailLower = email.toLowerCase().trim();
    const users = await supabase('GET', `/users?email=eq.${encodeURIComponent(emailLower)}&select=id`);
    if (!users || users.length === 0) return res.status(200).json({ success: true });

    const resetToken = generateToken();
    const resetExpires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    await supabase('PATCH', `/users?email=eq.${encodeURIComponent(emailLower)}`, { reset_token: resetToken, reset_expires: resetExpires });
    await sendResetEmail(emailLower, resetToken);
    return res.status(200).json({ success: true });
  }

  // ── RESET MOT DE PASSE ─────────────────────────────────────────
  if (action === 'reset_password') {
    if (!token || !password) return res.status(400).json({ error: 'Token et mot de passe requis' });
    if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 min)' });

    const users = await supabase('GET', `/users?reset_token=eq.${token}&select=*`);
    if (!users || users.length === 0) return res.status(400).json({ error: 'Lien invalide ou expiré' });

    const user = users[0];
    if (new Date(user.reset_expires) < new Date()) return res.status(400).json({ error: 'Lien expiré, recommence' });

    const newHash = hashPassword(password);
    await supabase('PATCH', `/users?id=eq.${user.id}`, { password_hash: newHash, reset_token: null, reset_expires: null, is_verified: true });
    return res.status(200).json({ success: true, user: { id: user.id, email: user.email, is_premium: user.is_premium, daily_count: user.daily_count || 0 } });
  }

  return res.status(400).json({ error: 'Action invalide' });
};

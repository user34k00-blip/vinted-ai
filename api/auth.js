const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'vintedai_salt_2024').digest('hex');
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
  return res.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

  const emailLower = email.toLowerCase().trim();
  const hash = hashPassword(password);

  if (action === 'register') {
    // Vérifier si email existe déjà
    const existing = await supabase('GET', `/users?email=eq.${encodeURIComponent(emailLower)}&select=id`);
    if (existing.length > 0) return res.status(400).json({ error: 'Cet email est déjà utilisé' });

    // Créer l'utilisateur
    const newUser = await supabase('POST', '/users', {
      email: emailLower,
      password_hash: hash,
      daily_count: 0,
      last_reset: new Date().toISOString().split('T')[0]
    });

    if (!newUser || newUser.error) return res.status(500).json({ error: 'Erreur lors de la création du compte' });

    const user = newUser[0];
    return res.status(200).json({
      success: true,
      user: { id: user.id, email: user.email, is_premium: user.is_premium, daily_count: user.daily_count }
    });
  }

  if (action === 'login') {
    const users = await supabase('GET', `/users?email=eq.${encodeURIComponent(emailLower)}&select=*`);
    if (!users || users.length === 0) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

    const user = users[0];
    if (user.password_hash !== hash) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

    // Réinitialiser le compteur si nouveau jour
    const today = new Date().toISOString().split('T')[0];
    if (user.last_reset !== today) {
      await supabase('PATCH', `/users?id=eq.${user.id}`, { daily_count: 0, last_reset: today });
      user.daily_count = 0;
    }

    return res.status(200).json({
      success: true,
      user: { id: user.id, email: user.email, is_premium: user.is_premium, daily_count: user.daily_count }
    });
  }

  return res.status(400).json({ error: 'Action invalide' });
};

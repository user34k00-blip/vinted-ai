const STRIPE_SECRET = process.env.STRIPE_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
const APP_URL = process.env.APP_URL || 'https://project-ys1js.vercel.app';

async function stripeRequest(path, bodyObj) {
  const params = Object.entries(bodyObj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${STRIPE_SECRET}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params
  });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch (e) { throw new Error('Stripe invalid: ' + text.slice(0, 200)); }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId requis' });

  try {
    // Récupérer le stripe_customer_id
    const supaRes = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=stripe_customer_id`, {
      headers: { 'apikey': SUPABASE_SECRET, 'Authorization': `Bearer ${SUPABASE_SECRET}` }
    });
    const users = await supaRes.json();
    const customerId = users[0]?.stripe_customer_id;

    if (!customerId) return res.status(400).json({ error: 'Aucun abonnement trouvé pour ce compte.' });

    // Créer la session du portail Stripe
    const session = await stripeRequest('/billing_portal/sessions', {
      customer: customerId,
      return_url: APP_URL
    });

    if (session.error) throw new Error(session.error.message);
    if (!session.url) throw new Error('Pas d\'URL portail retournée');

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error('Portal error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};

const STRIPE_SECRET = process.env.STRIPE_SECRET;
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID;
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
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('Stripe response invalid: ' + text.slice(0, 200));
  }
}

async function supabaseGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: {
      'apikey': SUPABASE_SECRET,
      'Authorization': `Bearer ${SUPABASE_SECRET}`
    }
  });
  return res.json();
}

async function supabasePatch(path, body) {
  await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SECRET,
      'Authorization': `Bearer ${SUPABASE_SECRET}`
    },
    body: JSON.stringify(body)
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, email } = req.body || {};
  if (!userId || !email) return res.status(400).json({ error: 'userId et email requis' });
  if (!STRIPE_SECRET) return res.status(500).json({ error: 'STRIPE_SECRET manquant' });
  if (!STRIPE_PRICE_ID) return res.status(500).json({ error: 'STRIPE_PRICE_ID manquant' });

  try {
    // Récupérer ou créer le customer Stripe
    const users = await supabaseGet(`/users?id=eq.${userId}&select=stripe_customer_id`);
    let customerId = users[0]?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripeRequest('/customers', { email });
      if (customer.error) throw new Error('Stripe customer: ' + customer.error.message);
      customerId = customer.id;
      await supabasePatch(`/users?id=eq.${userId}`, { stripe_customer_id: customerId });
    }

    // Créer la session Checkout
    const session = await stripeRequest('/checkout/sessions', {
      'customer': customerId,
      'payment_method_types[0]': 'card',
      'line_items[0][price]': STRIPE_PRICE_ID,
      'line_items[0][quantity]': '1',
      'mode': 'subscription',
      'success_url': `${APP_URL}?payment=success&userId=${userId}`,
      'cancel_url': `${APP_URL}?payment=cancelled`,
      'metadata[userId]': userId
    });

    if (session.error) throw new Error('Stripe session: ' + session.error.message);
    if (!session.url) throw new Error('Pas d\'URL Stripe retournée');

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error('Subscribe error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};

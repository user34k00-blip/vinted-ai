const STRIPE_SECRET = process.env.STRIPE_SECRET;
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
const APP_URL = process.env.APP_URL || 'https://project-ys1js.vercel.app';

async function stripeRequest(path, body) {
  const params = new URLSearchParams(body).toString();
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${STRIPE_SECRET}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params
  });
  return res.json();
}

async function supabase(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SECRET,
      'Authorization': `Bearer ${SUPABASE_SECRET}`
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

  const { userId, email } = req.body;
  if (!userId || !email) return res.status(400).json({ error: 'Données manquantes' });

  try {
    // Créer ou récupérer le customer Stripe
    const users = await supabase('GET', `/users?id=eq.${userId}&select=stripe_customer_id`);
    let customerId = users[0]?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripeRequest('/customers', { email });
      customerId = customer.id;
      await supabase('PATCH', `/users?id=eq.${userId}`, { stripe_customer_id: customerId });
    }

    // Créer la session de paiement Stripe Checkout
    const session = await stripeRequest('/checkout/sessions', {
      'customer': customerId,
      'payment_method_types[]': 'card',
      'line_items[0][price]': STRIPE_PRICE_ID,
      'line_items[0][quantity]': '1',
      'mode': 'subscription',
      'success_url': `${APP_URL}?payment=success&userId=${userId}`,
      'cancel_url': `${APP_URL}?payment=cancelled`,
      'metadata[userId]': userId
    });

    if (session.error) return res.status(500).json({ error: session.error.message });

    return res.status(200).json({ url: session.url });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

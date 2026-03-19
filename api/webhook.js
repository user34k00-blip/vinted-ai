const STRIPE_SECRET = process.env.STRIPE_SECRET;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;

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
  if (req.method !== 'POST') return res.status(405).end();

  const payload = JSON.stringify(req.body);
  const event = req.body;

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      const subscriptionId = session.subscription;

      if (userId) {
        await supabase('PATCH', `/users?id=eq.${userId}`, {
          is_premium: true,
          stripe_subscription_id: subscriptionId
        });
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      const customerId = subscription.customer;

      // Trouver l'utilisateur par customer_id
      const users = await supabase('GET', `/users?stripe_customer_id=eq.${customerId}&select=id`);
      if (users.length > 0) {
        await supabase('PATCH', `/users?id=eq.${users[0].id}`, {
          is_premium: false,
          stripe_subscription_id: null
        });
      }
    }

    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      const customerId = invoice.customer;
      const users = await supabase('GET', `/users?stripe_customer_id=eq.${customerId}&select=id`);
      if (users.length > 0) {
        await supabase('PATCH', `/users?id=eq.${users[0].id}`, { is_premium: false });
      }
    }

    return res.status(200).json({ received: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

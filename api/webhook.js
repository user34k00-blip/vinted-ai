const crypto = require('crypto');

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;

// IMPORTANT : on desactive le bodyParser de Vercel pour recuperer le corps
// brut (raw body). La signature Stripe est calculee sur les octets exacts du
// payload : si Vercel re-serialise le JSON, la signature ne correspond plus.
module.exports.config = { api: { bodyParser: false } };

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
  const text = await res.text();
  if (!text || text.trim() === '') return [];
  try { return JSON.parse(text); } catch (e) { return []; }
}

// Lit le corps brut de la requete (Buffer) depuis le stream.
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Verifie la signature Stripe (schema v1 = HMAC-SHA256) sans dependance externe.
// En-tete : "t=timestamp,v1=signature[,v1=...]"
function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false;

  let timestamp = null;
  const v1Signatures = [];
  sigHeader.split(',').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === 't') timestamp = value;
    if (key === 'v1') v1Signatures.push(value);
  });

  if (!timestamp || v1Signatures.length === 0) return false;

  // Tolerance de 5 minutes contre les attaques par rejeu (replay).
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 60 * 5) return false;

  const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  const expectedBuf = Buffer.from(expected, 'utf8');
  // Comparaison en temps constant contre l'une des signatures fournies.
  return v1Signatures.some((sig) => {
    const sigBuf = Buffer.from(sig, 'utf8');
    if (sigBuf.length !== expectedBuf.length) return false;
    try {
      return crypto.timingSafeEqual(sigBuf, expectedBuf);
    } catch (e) {
      return false;
    }
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  if (!STRIPE_WEBHOOK_SECRET) {
    console.error('Webhook: STRIPE_WEBHOOK_SECRET manquant');
    return res.status(500).json({ error: 'Webhook secret non configure' });
  }

  // 1) Recuperer le corps brut + la signature
  let rawBody;
  try {
    rawBody = await getRawBody(req);
  } catch (e) {
    return res.status(400).json({ error: 'Corps de requete illisible' });
  }
  const sigHeader = req.headers['stripe-signature'];

  // 2) VERIFIER LA SIGNATURE AVANT TOUT TRAITEMENT.
  // C'est ce qui garantit que l'evenement vient reellement de Stripe et
  // n'a pas ete falsifie. Sans cette verification, n'importe qui pouvait
  // appeler ce endpoint pour s'octroyer le premium.
  if (!verifyStripeSignature(rawBody, sigHeader, STRIPE_WEBHOOK_SECRET)) {
    console.error('Webhook: signature Stripe invalide');
    return res.status(400).json({ error: 'Signature invalide' });
  }

  // 3) Parser l'evenement authentifie
  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch (e) {
    return res.status(400).json({ error: 'Payload JSON invalide' });
  }

  try {
    // Paiement confirme par Stripe -> on debloque le premium.
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.metadata && session.metadata.userId;
      const subscriptionId = session.subscription;
      // On ne debloque que si le paiement est reellement regle.
      const paid = session.payment_status === 'paid' || session.status === 'complete';

      if (userId && paid) {
        await supabase('PATCH', `/users?id=eq.${userId}`, {
          is_premium: true,
          stripe_subscription_id: subscriptionId
        });
      }
    }

    // Renouvellement paye -> on (re)confirme le premium.
    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object;
      const customerId = invoice.customer;
      const users = await supabase('GET', `/users?stripe_customer_id=eq.${customerId}&select=id`);
      if (users.length > 0) {
        await supabase('PATCH', `/users?id=eq.${users[0].id}`, { is_premium: true });
      }
    }

    // Abonnement supprime -> on retire le premium.
    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      const customerId = subscription.customer;
      const users = await supabase('GET', `/users?stripe_customer_id=eq.${customerId}&select=id`);
      if (users.length > 0) {
        await supabase('PATCH', `/users?id=eq.${users[0].id}`, {
          is_premium: false,
          stripe_subscription_id: null
        });
      }
    }

    // Echec de paiement -> on retire le premium.
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
    console.error('Webhook handler error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};

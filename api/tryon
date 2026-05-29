// ─────────────────────────────────────────────────────────────
// api/tryon.js — Virtual Try-On (vetement porte par un mannequin)
//
// Utilise une API dediee (Replicate / IDM-VTON) car un simple prompt
// d'image ne suffit pas a garantir un rendu pro. IDM-VTON transfere le
// vetement fourni sur une photo de mannequin de reference.
//
// Variables d'environnement requises (a ajouter dans Vercel) :
//   REPLICATE_API_TOKEN          -> token API Replicate (obligatoire)
//   REPLICATE_MODEL_IMAGE_URL    -> URL d'une photo de mannequin neutre
//                                   (le "support" sur lequel poser le vetement)
//   REPLICATE_IDMVTON_VERSION    -> (optionnel) hash de version du modele
//   REPLICATE_TRYON_CATEGORY     -> (optionnel) upper_body | lower_body | dresses
//
// Tant que REPLICATE_API_TOKEN n'est pas defini, l'endpoint renvoie une
// erreur claire (code NO_TRYON_KEY) et le bouton reste inactif cote front.
// ─────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const MODEL_IMAGE_URL = process.env.REPLICATE_MODEL_IMAGE_URL;
const IDMVTON_VERSION = process.env.REPLICATE_IDMVTON_VERSION
  || '0513734a452173b8173e907e3a59d19a36266e55b48528559432bd21c7d7e985';
const CATEGORY = process.env.REPLICATE_TRYON_CATEGORY || 'upper_body';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { garment, userId } = req.body || {};

  if (!garment || !garment.data) return res.status(400).json({ error: 'Image du vêtement manquante.' });
  if (!userId) return res.status(401).json({ error: 'Non connecté', code: 'NOT_LOGGED_IN' });

  // ── Verification premium cote serveur (middleware) ──
  try {
    const userRes = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=is_premium`, {
      headers: { 'apikey': SUPABASE_SECRET, 'Authorization': `Bearer ${SUPABASE_SECRET}` }
    });
    const users = await userRes.json();
    if (!users || users.length === 0 || !users[0].is_premium) {
      return res.status(403).json({ error: 'Fonctionnalité réservée aux membres Premium.', code: 'NOT_PREMIUM' });
    }
  } catch (e) {
    return res.status(500).json({ error: 'Erreur vérification compte.' });
  }

  // ── Cle API manquante : message clair, bouton inactif cote front ──
  if (!REPLICATE_API_TOKEN) {
    return res.status(503).json({
      error: "Le Try-On n'est pas encore activé : ajoute REPLICATE_API_TOKEN (et REPLICATE_MODEL_IMAGE_URL) dans les variables Vercel.",
      code: 'NO_TRYON_KEY'
    });
  }
  if (!MODEL_IMAGE_URL) {
    return res.status(500).json({
      error: "REPLICATE_MODEL_IMAGE_URL manquant : il faut une photo de mannequin de référence sur laquelle poser le vêtement.",
      code: 'NO_TRYON_KEY'
    });
  }

  const garmentDataUri = `data:${garment.type || 'image/jpeg'};base64,${garment.data}`;

  try {
    // 1) Creer la prediction Replicate (IDM-VTON)
    const createRes = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version: IDMVTON_VERSION,
        input: {
          garm_img: garmentDataUri,
          human_img: MODEL_IMAGE_URL,
          garment_des: 'clothing item, photorealistic studio fashion photography',
          category: CATEGORY,
          // Parametres qualite
          crop: false,
          steps: 30,
          force_dc: false
        }
      })
    });

    const prediction = await createRes.json();
    if (!createRes.ok) {
      return res.status(createRes.status).json({ error: (prediction.detail || prediction.title || 'Erreur Replicate') });
    }

    // 2) Polling jusqu'a succeeded / failed (limite pour ne pas depasser le timeout)
    let result = prediction;
    const getUrl = prediction.urls && prediction.urls.get;
    const maxTries = 25; // ~50s max (25 x 2s)
    let tries = 0;
    while (result.status !== 'succeeded' && result.status !== 'failed' && result.status !== 'canceled' && tries < maxTries) {
      await sleep(2000);
      tries++;
      const pollRes = await fetch(getUrl, {
        headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}` }
      });
      result = await pollRes.json();
    }

    if (result.status !== 'succeeded') {
      if (tries >= maxTries) {
        return res.status(504).json({ error: 'Le rendu prend trop de temps, réessaie dans un instant.' });
      }
      return res.status(500).json({ error: result.error || 'La génération a échoué.' });
    }

    // 3) Recuperer l'image de sortie (URL) et la convertir en base64
    let outUrl = result.output;
    if (Array.isArray(outUrl)) outUrl = outUrl[outUrl.length - 1];
    if (!outUrl) return res.status(500).json({ error: 'Aucune image renvoyée par le modèle.' });

    const imgRes = await fetch(outUrl);
    const arrayBuf = await imgRes.arrayBuffer();
    const b64 = Buffer.from(arrayBuf).toString('base64');
    const contentType = imgRes.headers.get('content-type') || 'image/png';

    return res.status(200).json({
      mode: 'tryon',
      image: { type: contentType, data: b64 }
    });
  } catch (e) {
    console.error('Tryon error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};

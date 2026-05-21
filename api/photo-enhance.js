const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';

// ─────────────────────────────────────────────────────────────
// PROMPT 1 — ANALYSE & CONSEILS DE RETOUCHE (Anthropic)
// Mode "Améliorer la photo"
// ─────────────────────────────────────────────────────────────
const ENHANCE_SYSTEM_PROMPT = `Tu es un expert en photographie produit pour Vinted, spécialisé dans le rendu "clair, net, vendeur" qui maximise les ventes sur la plateforme.

━━━ TA MISSION ━━━
Analyser la photo fournie et donner au vendeur des conseils précis, actionnables et chiffrés pour transformer son cliché en photo qui vend. Tu parles comme un photographe pro qui prend le temps d'expliquer, pas comme un manuel technique.

━━━ STANDARDS VINTED-FRIENDLY ━━━
La photo idéale Vinted respecte ces critères :

**LUMIÈRE**
• Lumière naturelle du jour, douce, indirecte (proche d'une fenêtre, jamais en plein soleil direct)
• Pas d'ombres dures, pas de flash frontal qui écrase les matières
• Exposition légèrement claire — un article surexposé de 10-15% paraît plus propre et neuf

**COULEURS**
• Balance des blancs neutre : le blanc doit être blanc, pas jaune ni bleu
• Couleurs fidèles à la réalité — surtout ne jamais saturer artificiellement (l'acheteur est déçu à la réception)
• Si la photo tire vers le jaune (lumière artificielle), corriger vers plus froid (+10 à +15 en température)

**NETTETÉ & CADRAGE**
• Mise au point précise sur la matière de l'article (texture visible)
• Légère accentuation de la netteté autorisée, mais sans effet "HDR criard"
• Article centré, qui occupe 70-85% du cadre, marges propres

**FOND & CONTEXTE**
• Fond neutre uni de préférence (mur blanc, beige, gris clair, parquet clair)
• Pas de désordre visible, pas de linge sale en arrière-plan
• Si l'article est posé : surface propre, lisse, sans plis qui distraient

**FINITION**
• Aspect propre et net, mais réaliste — surtout pas l'effet "produit Amazon plastifié"
• L'œil doit pouvoir juger la matière et l'état réel de l'article

━━━ FORMAT DE RÉPONSE ━━━
Structure ta réponse en 4 sections claires, ton professionnel et bienveillant :

**1. Ce qui fonctionne déjà** (1-2 points positifs concrets sur la photo)

**2. Ce qui peut être amélioré** (3-5 points précis, chacun avec le problème identifié + la correction concrète à appliquer dans n'importe quel éditeur photo : exposition +0.5, températures, recadrage, etc.)

**3. Réglages techniques recommandés** (valeurs chiffrées prêtes à appliquer)
• Exposition : ...
• Contraste : ...
• Hautes lumières : ...
• Ombres : ...
• Saturation : ...
• Vibrance : ...
• Netteté : ...
• Température : ...

**4. Conseil bonus pour la prochaine photo** (1 conseil pratique pour la prise de vue suivante)

Pas d'emojis. Pas de superlatifs. Ton posé, expert, qui donne envie d'appliquer les conseils.`;

// ─────────────────────────────────────────────────────────────
// PROMPT 2 — CHANGEMENT DE FOND (OpenAI Images)
// Mode "Changer le fond"
// ─────────────────────────────────────────────────────────────
function buildBackgroundPrompt(userRequest) {
  const base = `Replace the background of this product photo with a clean, Vinted-friendly setting suitable for second-hand fashion resale.

Photography standards to apply:
- Soft, diffused natural daylight (window light style), no harsh shadows
- Neutral white balance, true-to-life colors, no oversaturation
- Sharp focus on the item with visible material texture
- The item itself must remain 100% unchanged: same shape, same colors, same texture, same condition, same details — DO NOT alter, retouch, enhance or modify the item in any way
- Clean, uncluttered background with subtle depth
- Slightly bright exposure for a fresh, clean look (+10% brightness feel)
- Professional but realistic finish — never plasticky or over-processed
- Realistic shadow under the item to keep it grounded
- Final aspect: a photo that feels honest, polished and trustworthy for a buyer browsing Vinted

User's specific request for the new background: "${userRequest || 'Clean neutral light background (off-white or light beige wall) with subtle natural shadow, minimalist Vinted-style.'}"

Output: a single clean photo, same composition and framing as the original, only the background changes.`;

  return base;
}

// ─────────────────────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { mode, image, userId, backgroundRequest } = req.body || {};

  if (!image || !image.data) {
    return res.status(400).json({ error: 'Image manquante.' });
  }
  if (!userId) {
    return res.status(401).json({ error: 'Non connecté', code: 'NOT_LOGGED_IN' });
  }

  // Vérif premium
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

  // ─── MODE 1 : AMÉLIORER LA PHOTO (Anthropic — conseils) ───
  if (mode === 'enhance' || !mode) {
    if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY manquante.' });

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1500,
          system: ENHANCE_SYSTEM_PROMPT,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: image.type || 'image/jpeg', data: image.data }
              },
              { type: 'text', text: 'Analyse cette photo Vinted et donne-moi tes conseils complets pour qu\'elle vende mieux. Suis exactement la structure en 4 sections.' }
            ]
          }]
        })
      });

      const data = await response.json();
      if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'Erreur API' });

      return res.status(200).json({ mode: 'enhance', analysis: data.content[0].text });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ─── MODE 2 : CHANGER LE FOND (OpenAI Images) ───
  if (mode === 'background') {
    if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY manquante côté serveur.' });

    try {
      const prompt = buildBackgroundPrompt(backgroundRequest);

      // Préparer l'image en multipart pour l'API OpenAI Images Edit
      const imageBuffer = Buffer.from(image.data, 'base64');
      const mediaType = image.type || 'image/png';
      const boundary = '----vintedai' + Date.now();

      const parts = [];
      // image
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="image.png"\r\nContent-Type: ${mediaType}\r\n\r\n`));
      parts.push(imageBuffer);
      parts.push(Buffer.from(`\r\n`));
      // prompt
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${prompt}\r\n`));
      // model
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${OPENAI_IMAGE_MODEL}\r\n`));
      // size
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="size"\r\n\r\n1024x1024\r\n`));
      // quality
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="quality"\r\n\r\nhigh\r\n`));
      // closing
      parts.push(Buffer.from(`--${boundary}--\r\n`));

      const body = Buffer.concat(parts);

      const openaiRes = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body
      });

      const openaiData = await openaiRes.json();
      if (!openaiRes.ok) {
        return res.status(openaiRes.status).json({ error: openaiData.error?.message || 'Erreur OpenAI' });
      }

      const b64 = openaiData.data?.[0]?.b64_json;
      if (!b64) return res.status(500).json({ error: 'Pas d\'image retournée par OpenAI.' });

      return res.status(200).json({
        mode: 'background',
        image: { type: 'image/png', data: b64 }
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: 'Mode invalide. Utilise "enhance" ou "background".' });
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;

async function supabase(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SECRET,
      'Authorization': `Bearer ${SUPABASE_SECRET}`,
      'Prefer': 'return=representation'
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

  const { category, condition, brand, size, price, keywords, notes, images, userId } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API manquante.' });

  // ── Vérification quota ──────────────────────────────────────────
  if (!userId) return res.status(401).json({ error: 'Connecte-toi pour générer une annonce.', code: 'NOT_LOGGED_IN' });

  const users = await supabase('GET', `/users?id=eq.${userId}&select=*`);
  if (!users || users.length === 0) return res.status(401).json({ error: 'Utilisateur introuvable.', code: 'NOT_FOUND' });

  const user = users[0];
  const today = new Date().toISOString().split('T')[0];

  // Réinitialiser le compteur si nouveau jour
  if (user.last_reset !== today) {
    await supabase('PATCH', `/users?id=eq.${userId}`, { daily_count: 0, last_reset: today });
    user.daily_count = 0;
  }

  // Vérifier quota : 3/jour pour les gratuits, illimité pour premium
  if (!user.is_premium && user.daily_count >= 3) {
    return res.status(403).json({
      error: 'Tu as atteint ta limite de 3 annonces gratuites aujourd\'hui.',
      code: 'QUOTA_EXCEEDED',
      daily_count: user.daily_count,
      is_premium: false
    });
  }

  // ── Génération de l'annonce ─────────────────────────────────────
  const searchTerms = [brand, keywords, category].filter(Boolean).join(' ');
  const vintedSearchUrl = `https://www.vinted.fr/catalog?search_text=${encodeURIComponent(searchTerms)}`;

  const signatureMap = {
    'Neuf avec étiquette': '✨Article Neuf Avec Etiquette Jamais Porté✨',
    'Neuf sans étiquette': '✨Article Neuf Sans Etiquette✨',
    'Très bon état': '✨Article en Très Bon État✨',
    'Bon état': '✨Article en Bon État✨',
    'Satisfaisant': '✨Article en État Satisfaisant✨'
  };
  const firstLine = signatureMap[condition] || '✨Article en Très Bon État✨';
  const signature = `${firstLine}\n📦Emballage du colis soigné📦\n⌛Envoi du colis en 24H max⌛\n✅Article Authentique✅\n❗La procédure d'envoi du colis sera filmé du début à la fin pour éviter tout type d'arnaque❗`;

  const prompt = `Tu es un vendeur Vinted expert en France avec des centaines de ventes réussies. Ta mission : générer une annonce qui se démarque et vend vite.

ARTICLE À ANALYSER :
- Catégorie : ${category}
- État : ${condition}
${brand ? `- Marque : ${brand}` : '- Marque : inconnue (détecte-la sur les photos si possible)'}
${size ? `- Taille : ${size}` : '- Taille : non fournie (détecte-la sur l\'étiquette en photo si possible)'}
- Prix vendeur : ${price}€
${keywords ? `- Détails : ${keywords}` : ''}
${notes ? `- Notes vendeur : ${notes}` : ''}
${images && images.length > 0 ? `- ${images.length} photo(s) — ANALYSE-LES : couleur exacte, matière, logo, étiquette, modèle précis, état réel.` : ''}

━━━ TITRE ━━━
• 50-60 caractères max
• Format : [Marque] [type] [couleur si visible] [taille si pertinente]
• Marque premium en PREMIER (Nike, Adidas, Stone Island, Supreme...)
• INTERDIT : "beau", "super", "nickel", "top", "parfait", majuscules excessives

━━━ DESCRIPTION ━━━
4 lignes exactes :
Ligne 1 : [emoji catégorie] description factuelle (modèle, couleur, matière, coupe)
Ligne 2 : 🏷️ état honnête (jamais porté / porté X fois / étiquette encore attachée)
Ligne 3 : 💎 valeur ajoutée objective (sold out, coloris rare, taille difficile...)
Ligne 4 : 📮 pratique (Mondial Relay / Colissimo, échange non, prix ferme/négo)

Emojis ligne 1 : 👕t-shirt | 👗robe | 🧥veste | 👖pantalon | 🧢casquette | 👟sneakers | 👠chaussures | 👜sac | 📱smartphone | 💻ordi | 🎮gaming | 🏋️sport | 🏠déco

INTERDIT : superbe, magnifique, nickel, top, parfait, n'hésitez pas, à saisir, pépite
Max 2 emojis dans ces 4 lignes.

Après les 4 lignes, ligne vide puis EXACTEMENT :
${signature}

━━━ PRIX ━━━
Neuf étiquette: 45-65% | Neuf sans: 35-50% | TBE: 25-40% | BE: 15-25% | Satisfaisant: 10-15%
Garde ${price}€ si dans fourchette. Ajuste si >20% au-dessus. Chiffre entier uniquement.

━━━ HASHTAGS (12-15) ━━━
2-3 marque | 3-4 catégorie | 3-4 style | 2-3 populaires Vinted | 1-2 niche
Sans # dans le JSON.

JSON strict sans markdown :
{"titre":"...","prix_recommande":"...","description":"...","hashtags":[...],"vinted_search_url":"${vintedSearchUrl}"}`;

  const content = [];
  if (images && images.length > 0) {
    images.slice(0, 4).forEach(img => {
      content.push({ type: 'image', source: { type: 'base64', media_type: img.type, data: img.data } });
    });
  }
  content.push({ type: 'text', text: prompt });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1500, messages: [{ role: 'user', content }] })
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'Erreur API' });

    const rawText = data.content[0].text.trim().replace(/```json|```/g, '').trim();
    const result = JSON.parse(rawText);
    if (!result.vinted_search_url) result.vinted_search_url = vintedSearchUrl;

    // Incrémenter le compteur quotidien
    const newCount = (user.daily_count || 0) + 1;
    await supabase('PATCH', `/users?id=eq.${userId}`, { daily_count: newCount });
    result.daily_count = newCount;
    result.is_premium = user.is_premium;
    result.remaining = user.is_premium ? 999 : Math.max(0, 3 - newCount);

    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

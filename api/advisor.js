const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message, history, userId } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API manquante.' });
  if (!userId) return res.status(401).json({ error: 'Non connecté', code: 'NOT_LOGGED_IN' });

  // Vérifier premium
  const userRes = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=is_premium`, {
    headers: { 'apikey': SUPABASE_SECRET, 'Authorization': `Bearer ${SUPABASE_SECRET}` }
  });
  const users = await userRes.json();
  if (!users || users.length === 0 || !users[0].is_premium) {
    return res.status(403).json({ error: 'Fonctionnalité réservée aux membres Premium.', code: 'NOT_PREMIUM' });
  }

  const systemPrompt = `Tu es un expert vendeur Vinted France avec plus de 500 ventes réussies et un taux de conversion de 95%. Tu es le conseiller personnel de ce vendeur et tu l'aides à maximiser ses ventes.

Ton expertise couvre :
- Stratégie de prix et négociation sur Vinted
- Optimisation des annonces (titre, description, photos, hashtags)
- Connaissance approfondie des marques et de leur valeur sur le marché secondaire
- Timing optimal pour publier/republier des annonces
- Gestion des acheteurs et négociations
- Identification des articles qui se vendent bien vs ceux qui stagnent
- Tendances du marché de la mode secondaire en France
- Astuces pour augmenter sa visibilité sur Vinted
- Conseils sur les photos (fond, lumière, angles)
- Stratégies pour vendre rapidement vs maximiser le prix

Tu réponds de façon directe, pratique et personnalisée. Tu donnes des conseils concrets avec des exemples chiffrés quand c'est pertinent. Tu es comme un ami expert, pas un robot. Tu poses des questions pour mieux comprendre la situation si nécessaire.`;

  const messages = [
    ...(history || []),
    { role: 'user', content: message }
  ];

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: systemPrompt,
        messages
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message });

    return res.status(200).json({ reply: data.content[0].text });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

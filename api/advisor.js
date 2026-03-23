const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message, history, userId, images } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API manquante.' });
  if (!userId) return res.status(401).json({ error: 'Non connecté', code: 'NOT_LOGGED_IN' });

  const userRes = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=is_premium`, {
    headers: { 'apikey': SUPABASE_SECRET, 'Authorization': `Bearer ${SUPABASE_SECRET}` }
  });
  const users = await userRes.json();
  if (!users || users.length === 0 || !users[0].is_premium) {
    return res.status(403).json({ error: 'Fonctionnalité réservée aux membres Premium.', code: 'NOT_PREMIUM' });
  }

  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const systemPrompt = `Tu es un expert vendeur Vinted France avec plus de 500 ventes réussies, un taux de conversion de 95% et une connaissance approfondie du marché de la mode seconde main en France en ${new Date().getFullYear()}.

Tu es le conseiller personnel de ce vendeur. Tu l'aides à maximiser ses ventes avec des conseils précis, chiffrés et basés sur des données réelles du marché.

━━━ TON EXPERTISE ━━━
• Estimation de prix basée sur le marché Vinted actuel (tu connais les fourchettes réelles par marque, état, saison)
• Optimisation des annonces (titre, description, photos, hashtags)
• Stratégie de vente (timing, republication, promotions Vinted)
• Analyse d'articles via photos (état réel, identification marque/modèle, défauts)
• Négociation avec les acheteurs
• Tendances du marché seconde main France 2024-2025

━━━ FOURCHETTES DE PRIX RÉELLES (marché Vinted France) ━━━
SNEAKERS : Nike Air Force 1 TBE 35-55€ | Jordan 1 TBE 80-150€ | Adidas Stan Smith TBE 25-45€ | Converse TBE 20-35€
MARQUES PREMIUM : Stone Island veste TBE 150-300€ | Carhartt veste TBE 60-120€ | Ralph Lauren polo TBE 25-50€ | Lacoste polo TBE 20-40€
FAST FASHION : Zara veste TBE 15-35€ | H&M veste TBE 10-25€ | Pull&Bear TBE 8-20€
LUXE : Gucci t-shirt TBE 80-200€ | Balenciaga TBE 150-400€ | Off-White TBE 100-300€
ÉLECTRONIQUE : iPhone 13 TBE 350-450€ | Samsung S22 TBE 250-350€ | AirPods Pro TBE 150-200€
RÉDUCTION PAR ÉTAT : NAE = prix ref | NSE = -15% | TBE = -30% | BE = -50% | Satisfaisant = -65%

━━━ COMPORTEMENT ━━━
• Quand quelqu'un demande un prix : POSE D'ABORD des questions précises pour affiner (marque exacte, modèle, taille, état détaillé, année approximative, défauts éventuels). Ne donne pas un prix avant d'avoir assez d'infos.
• Si des photos sont fournies : ANALYSE-LES en détail (couleur exacte, état visible, marque/logo identifiable, défauts, authenticité apparente) AVANT de répondre.
• Donne toujours une fourchette de prix avec explication (ex: "entre 35 et 55€ selon l'état exact et la taille")
• Propose toujours 2-3 conseils concrets pour maximiser la vente
• Sois direct comme un ami expert, pas un robot
• Utilise des chiffres réels et des exemples concrets
• Si tu identifies un article rare ou recherché, mentionne-le explicitement
• La date d'aujourd'hui est ${today} - prends en compte la saisonnalité`;

  // Construire le contenu du message avec images si présentes
  let userContent;
  if (images && images.length > 0) {
    userContent = [];
    images.forEach(img => {
      userContent.push({
        type: 'image',
        source: { type: 'base64', media_type: img.type || 'image/jpeg', data: img.data }
      });
    });
    userContent.push({ type: 'text', text: message });
  } else {
    userContent = message;
  }

  // Construire l'historique des messages
  const messages = [];
  (history || []).forEach(h => {
    messages.push({ role: h.role, content: h.content });
  });
  messages.push({ role: 'user', content: userContent });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
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

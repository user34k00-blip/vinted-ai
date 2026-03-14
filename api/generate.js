module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { category, condition, brand, size, price, keywords, notes, images } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API manquante côté serveur.' });

  const prompt = `Tu es un expert en vente sur Vinted en France. Crée une annonce ultra-optimisée.
Catégorie: ${category}, État: ${condition}${brand ? ', Marque: '+brand : ''}${size ? ', Taille: '+size : ''}, Prix: ${price}€${keywords ? ', Détails: '+keywords : ''}${notes ? ', Notes: '+notes : ''}

Réponds UNIQUEMENT en JSON valide sans markdown:
{"titre":"titre max 60 chars","prix_recommande":"prix","description":"5-8 lignes avec emojis","hashtags":["tag1","tag2","tag3","tag4","tag5","tag6","tag7","tag8"]}`;

  const content = [];
  if (images?.length > 0) {
    images.slice(0, 4).forEach(img => {
      content.push({ type: 'image', source: { type: 'base64', media_type: img.type, data: img.data } });
    });
  }
  content.push({ type: 'text', text: prompt });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, messages: [{ role: 'user', content }] })
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'Erreur API' });

    const text = data.content[0].text.trim().replace(/```json|```/g, '').trim();
    const result = JSON.parse(text);
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

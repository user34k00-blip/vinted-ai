module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { category, condition, brand, size, price, keywords, notes, images } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API manquante côté serveur.' });

  const prompt = `Tu es un expert en vente sur Vinted France avec des années d'expérience. Tu connais parfaitement ce qui fait vendre : des titres percutants, des descriptions humaines et sincères, et des prix compétitifs.

ARTICLE À VENDRE :
- Catégorie : ${category}
- État : ${condition}
${brand ? `- Marque : ${brand}` : ''}
${size ? `- Taille/Format : ${size}` : ''}
- Prix vendeur : ${price}€
${keywords ? `- Détails : ${keywords}` : ''}
${notes ? `- Notes du vendeur : ${notes}` : ''}
${images && images.length > 0 ? `- ${images.length} photo(s) jointe(s) — analyse-les pour enrichir la description.` : ''}

INSTRUCTIONS STRICTES :

TITRE (max 60 caractères) :
- Commence par la marque si connue et prestigieuse
- Mentionne l'article exact + caractéristique clé (couleur, matière, style)
- Évite les mots génériques comme "Beau", "Super", "Magnifique"
- Exemples de bons titres : "Nike Air Force 1 blanc taille 42 neuf", "Robe fleurie Zara taille M été", "iPhone 13 128Go noir excellent état"

PRIX :
- Analyse le marché Vinted réel pour cet article
- Pour du neuf avec étiquette : 40-60% du prix boutique
- Pour très bon état : 25-40% du prix boutique  
- Pour bon état : 15-25% du prix boutique
- Sois compétitif mais pas bradé — ajuste le prix du vendeur si nécessaire
- Retourne uniquement le chiffre, sans symbole €

DESCRIPTION (5-8 lignes) :
- Ton naturel, chaleureux, comme si tu parlais à un ami
- Commence par décrire l'article concrètement (couleur, matière, coupe, style)
- Mentionne l'état honnêtement avec des détails précis
- Ajoute 1-2 arguments vendeurs (rare, tendance, polyvalent, etc.)
- Termine par une phrase sympa sur l'envoi/échange
- Utilise des emojis pertinents mais pas excessifs (3-5 max)
- JAMAIS de phrases robotiques comme "N'hésitez pas à me contacter"
- JAMAIS de fautes d'orthographe

HASHTAGS (exactement 8) :
- Mix de hashtags génériques populaires ET spécifiques à l'article
- Inclus toujours : la marque (si connue), la catégorie, l'état, le style
- Exemples : #nike #streetwear #sneakers #vintage #zara #robe #tendance #mode
- Sans le # dans le JSON, juste le mot

Réponds UNIQUEMENT en JSON valide, sans markdown, sans commentaires :
{
  "titre": "...",
  "prix_recommande": "...",
  "description": "...",
  "hashtags": ["...", "...", "...", "...", "...", "...", "...", "..."]
}`;

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
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1200,
        messages: [{ role: 'user', content }]
      })
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

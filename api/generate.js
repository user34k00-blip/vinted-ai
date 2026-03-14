module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { category, condition, brand, size, price, keywords, notes, images } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API manquante côté serveur.' });

  // Construction de la requête de recherche Vinted
  const searchTerms = [brand, keywords, category].filter(Boolean).join(' ');
  const vintedSearchUrl = `https://www.vinted.fr/catalog?search_text=${encodeURIComponent(searchTerms)}`;

  const prompt = `Tu es un vendeur Vinted expérimenté en France. Tu génères des annonces authentiques, directes et efficaces.

ARTICLE :
- Catégorie : ${category}
- État : ${condition}
${brand ? `- Marque : ${brand}` : ''}
${size ? `- Taille : ${size}` : ''}
- Prix vendeur : ${price}€
${keywords ? `- Détails : ${keywords}` : ''}
${notes ? `- Notes : ${notes}` : ''}
${images && images.length > 0 ? `- ${images.length} photo(s) — analyse-les avec précision.` : ''}

---

RÈGLES STRICTES POUR LE TITRE :
- 50-60 caractères max
- Format : [Marque] + [article précis] + [détail clé] + [taille si pertinent]
- Exemples corrects : "Veste The North Face noire taille L imperméable", "Robe Sandro Paris fleurie taille 36", "AirPods Pro 2 boitier MagSafe état neuf"
- Interdit : adjectifs subjectifs ("beau", "super", "nickel"), majuscules excessives, points d'exclamation

---

RÈGLES STRICTES POUR LA DESCRIPTION :
Écris comme un vrai vendeur Vinted — pas comme un robot ou un publicitaire.

Structure exacte à respecter :
Ligne 1 : Description factuelle de l'article (couleur précise, matière si visible, coupe, modèle exact si connu)
Ligne 2 : État réel avec des détails honnêtes (porté X fois, lavé en machine, petite marque à tel endroit ou rien à signaler)
Ligne 3 : Ce qui justifie le prix ou rend l'article intéressant (modèle discontinued, coloris rare, taille difficile à trouver...)
Ligne 4 : Infos pratiques (envoi via Mondial Relay ou Colissimo, échange possible ou non, négociation ok/non)

Emojis : 2-3 maximum, placés naturellement, jamais en début de ligne
Longueur : 4-5 lignes, pas plus
Ton : factuel, honnête, humain — comme si tu textos à quelqu'un

INTERDIT dans la description :
- "Superbe", "magnifique", "beau", "nickel", "top", "parfait", "incroyable"
- "N'hésitez pas", "Envoi soigné", "À saisir", "Rare", "Pépite"
- Phrases en majuscules
- Plus de 3 emojis
- Répéter les infos du titre

---

RÈGLES POUR LE PRIX :
Analyse le marché réel pour cet article exact sur Vinted France.
Fourchettes typiques selon l'état :
- Neuf avec étiquette : 45-65% du prix boutique neuf
- Neuf sans étiquette : 35-50% du prix boutique
- Très bon état : 25-40% du prix boutique
- Bon état : 15-25% du prix boutique
- Satisfaisant : 10-15% du prix boutique

Si le prix vendeur (${price}€) est dans la bonne fourchette, conserve-le.
Si il est trop haut ou trop bas de plus de 15%, ajuste-le.
Retourne uniquement le chiffre entier.

---

RÈGLES POUR LES HASHTAGS (exactement 8) :
- Pertinents et spécifiques à CET article précis
- Mix : 2-3 hashtags très populaires + 3-4 hashtags ciblés + 1-2 hashtags de niche
- Inclure : marque (si connue), catégorie précise, style vestimentaire, occasion/usage
- Exemples pour une veste : northface, outdoor, randonnee, veste, imperméable, trekking, montagne, sportswear
- Exemples pour téléphone : iphone, apple, smartphone, reconditionné, hightech, ios, telephone, apple
- Sans # dans le JSON

---

Réponds UNIQUEMENT en JSON valide strict, sans markdown, sans texte avant ou après :
{
  "titre": "...",
  "prix_recommande": "...",
  "description": "...",
  "hashtags": ["...", "...", "...", "...", "...", "...", "...", "..."],
  "vinted_search_url": "${vintedSearchUrl}"
}`;

  const content = [];
  if (images && images.length > 0) {
    images.slice(0, 4).forEach(img => {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: img.type, data: img.data }
      });
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
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Erreur API Anthropic' });
    }

    const rawText = data.content[0].text.trim().replace(/```json|```/g, '').trim();
    const result = JSON.parse(rawText);

    // Toujours inclure l'URL de recherche Vinted
    if (!result.vinted_search_url) {
      result.vinted_search_url = vintedSearchUrl;
    }

    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

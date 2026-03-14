module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { category, condition, brand, size, price, keywords, notes, images } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API manquante côté serveur.' });

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

  const prompt = `Tu es un vendeur Vinted sérieux et expérimenté en France. Tu génères des annonces authentiques, directes et efficaces.

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
- Exemples : "Veste The North Face noire taille L imperméable", "AirPods Pro 2 boitier MagSafe état neuf"
- Interdit : adjectifs subjectifs ("beau", "super", "nickel"), majuscules excessives, points d'exclamation

---

RÈGLES STRICTES POUR LA DESCRIPTION :
Écris 4 lignes factuelles et humaines, avec des emojis pertinents au début de chaque ligne.

Ligne 1 : 👕 (ou emoji adapté à l'article) + Description factuelle (couleur précise, matière, coupe, modèle exact)
Ligne 2 : 🏷️ + État réel honnête (jamais porté, porté X fois, rien à signaler...)
Ligne 3 : 💎 + Ce qui justifie le prix (modèle rare, coloris difficile à trouver, taille rare...)
Ligne 4 : 📮 + Infos pratiques (Mondial Relay ou Colissimo, échange possible ou non, prix ferme/négociable)

Choix des emojis pour la ligne 1 selon la catégorie :
- Vêtements : 👕 👗 🧥 👖 🧢 selon le type exact
- Chaussures : 👟 👠 👞 👢
- Sacs/accessoires : 👜 🎒 ⌚
- Électronique : 📱 💻 🎮 🎧
- Maison/déco : 🏠 🛋️ 🪴
- Sport : ⚽ 🎾 🏋️ 🚴
- Autre : ✨

INTERDIT dans ces 4 lignes : "Superbe", "magnifique", "nickel", "top", "parfait", "N'hésitez pas", "À saisir", "Pépite"

Après ces 4 lignes, ajoute EXACTEMENT cette signature sans rien modifier :
${signature}

---

RÈGLES POUR LE PRIX :
- Neuf avec étiquette : 45-65% du prix boutique
- Neuf sans étiquette : 35-50%
- Très bon état : 25-40%
- Bon état : 15-25%
- Satisfaisant : 10-15%
Conserve ${price}€ si dans la fourchette. Sinon ajuste. Retourne uniquement le chiffre entier.

---

RÈGLES POUR LES HASHTAGS (12 à 15 hashtags) :
- 2-3 hashtags de marque
- 3-4 hashtags de catégorie précise
- 3-4 hashtags de style/usage (streetwear, casual, sport, vintage...)
- 2-3 hashtags populaires Vinted (mode, tendance, vinted, vintedmode...)
- 1-2 hashtags très spécifiques (coloris, modèle, collection...)
- Sans # dans le JSON

---

Réponds UNIQUEMENT en JSON valide strict, sans markdown :
{
  "titre": "...",
  "prix_recommande": "...",
  "description": "...",
  "hashtags": ["...", "...", "..."],
  "vinted_search_url": "${vintedSearchUrl}"
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
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1500, messages: [{ role: 'user', content }] })
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'Erreur API Anthropic' });

    const rawText = data.content[0].text.trim().replace(/```json|```/g, '').trim();
    const result = JSON.parse(rawText);
    if (!result.vinted_search_url) result.vinted_search_url = vintedSearchUrl;

    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

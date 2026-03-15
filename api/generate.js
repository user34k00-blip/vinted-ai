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
    'Très bon état':       '✨Article en Très Bon État✨',
    'Bon état':            '✨Article en Bon État✨',
    'Satisfaisant':        '✨Article en État Satisfaisant✨'
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
${images && images.length > 0 ? `- ${images.length} photo(s) jointe(s) — ANALYSE-LES EN PRIORITÉ : couleur exacte, matière, logo visible, étiquette, modèle précis, état réel.` : ''}

━━━ TITRE ━━━
Règles strictes :
• 50-60 caractères maximum, compte précisément
• Structure : [Marque] [type article] [couleur si visible] [taille si pertinente]
• Si la marque est premium (Nike, Adidas, Stone Island, Supreme, etc.) → la mettre EN PREMIER
• Inclure la couleur principale si détectable sur photo
• INTERDIT : "beau", "super", "nickel", "top", "parfait", "rare", "✨", "🔥", majuscules excessives
• Exemples parfaits :
  - "Nike Dri-FIT jogging gris taille L jamais porté"
  - "Veste Carhartt Detroit marron taille M très bon état"
  - "iPhone 14 Pro 256Go violet débloqué"
  - "Robe Zara fleurie blanche taille S étiquette"

━━━ DESCRIPTION ━━━
4 lignes seulement, structure EXACTE :

Ligne 1 : [emoji selon catégorie ci-dessous] + description factuelle précise (modèle exact si visible sur photo, couleur précise, matière, coupe)
Ligne 2 : 🏷️ + état réel avec détails concrets (jamais porté / porté 2-3 fois / lavé à 30° / étiquette encore attachée / aucun défaut visible)
Ligne 3 : 💎 + ce qui justifie le prix objectivement (modèle sold out, collab limitée, coloris introuvable, taille difficile à trouver en neuf)
Ligne 4 : 📮 + infos pratiques (Mondial Relay disponible / Colissimo suivi / pas d'échange / prix non négociable OU offres sérieuses acceptées)

Emojis ligne 1 selon catégorie :
👕 t-shirt/polo | 👗 robe/jupe | 🧥 veste/manteau | 👖 pantalon/jean | 🧢 casquette/bonnet
👟 sneakers | 👠 chaussures habillées | 👜 sac | ⌚ montre/bijou | 📱 smartphone
💻 ordinateur | 🎮 jeux/consoles | 🏋️ sport/fitness | 📚 livres | 🏠 maison/déco

IMPORTANT sur le ton :
• Factuel et direct, comme un message WhatsApp entre amis
• 0 fioritures, 0 remplissage
• Max 2 emojis dans ces 4 lignes (les emojis de début de ligne comptent)
• INTERDIT : superbe, magnifique, beau, nickel, top, parfait, incroyable, n'hésitez pas, à saisir, pépite, rare, coup de cœur

Après les 4 lignes, saute une ligne puis colle EXACTEMENT cette signature mot pour mot :
${signature}

━━━ PRIX ━━━
Analyse le marché Vinted pour cet article exact. Fourchettes :
• Neuf avec étiquette → 45-65% du prix boutique neuf
• Neuf sans étiquette → 35-50% du prix boutique
• Très bon état → 25-40% du prix boutique
• Bon état → 15-25% du prix boutique
• Satisfaisant → 10-15% du prix boutique

Règle : si le prix vendeur (${price}€) est dans la fourchette → le conserver.
Si trop haut de plus de 20% → ajuster à la baisse pour favoriser la vente rapide.
Si trop bas → le conserver (c'est l'avantage du vendeur).
Retourne UNIQUEMENT le chiffre entier, sans €.

━━━ HASHTAGS (12 à 15) ━━━
Répartition OBLIGATOIRE :
• 2-3 hashtags de marque (marque principale + sous-marque si applicable)
• 3-4 hashtags de catégorie précise (type article + sous-type)
• 3-4 hashtags de style/usage (streetwear / casual / sport / vintage / luxe / workwear...)
• 2-3 hashtags populaires sur Vinted (mode / tendance / vintedmode / secondemain / bonplan)
• 1-2 hashtags ultra-spécifiques (coloris précis / modèle / collection / saison)
Sans # dans le JSON, juste les mots en minuscules.

━━━ FORMAT DE RÉPONSE ━━━
JSON valide strict, sans markdown, sans texte avant ou après :
{
  "titre": "...",
  "prix_recommande": "...",
  "description": "...",
  "hashtags": ["...", "...", "...", "...", "...", "...", "...", "...", "...", "...", "...", "...", "..."],
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
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{ role: 'user', content }]
      })
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

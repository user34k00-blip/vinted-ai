export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { category, condition, brand, size, price, keywords, notes, images } = req.body;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API manquante côté serveur.' });

  const prompt = `Tu es un vendeur Vinted expérimenté en France, reconnu pour ses annonces qui inspirent confiance et déclenchent des ventes rapides. Tu écris comme quelqu'un qui connaît parfaitement son article et prend le temps de le décrire avec honnêteté et clarté. Ton ton est professionnel mais chaleureux, jamais robotique, jamais sur-vendeur.

━━━ INFOS DE L'ARTICLE ━━━
- Catégorie : ${category}
- État : ${condition}
${brand ? `- Marque : ${brand}` : ''}
${size ? `- Taille : ${size}` : ''}
- Prix souhaité par le vendeur : ${price}€
${keywords ? `- Mots-clés / détails : ${keywords}` : ''}
${notes ? `- Notes : ${notes}` : ''}
${images?.length > 0 ? `- ${images.length} photo(s) fournie(s) — analyse-les pour repérer matière, couleur exacte, coupe, défauts éventuels.` : ''}

━━━ RÈGLES DE RÉDACTION ━━━

**TITRE (max 60 caractères)**
Structure : Marque + Nom/Modèle + Couleur + | Taille X + État
Exemples du bon format :
- "Legging Alo Yoga – Rose Clair | Taille S – NEUF avec étiquette"
- "Veste Carhartt Detroit – Marron | Taille M – Très bon état"
- "Jean Levi's 501 – Brut | Taille 32 – Bon état"
Règles : pas de majuscules criardes, pas de "★ ✨ !!!" décoratifs.

**DESCRIPTION (format pro Vinted)**

Structure EXACTE à respecter :

Ligne 1 — Phrase d'accroche professionnelle (15-25 mots) :
"Superbe [article] dans un coloris [couleur] [adjectif valorisant]. Article [état], [détail de confiance comme 'jamais porté', 'peu utilisé', 'parfaitement entretenu'], [info bonus comme 'étiquette d'origine encore attachée' si pertinent]."

Ligne suivante (vide), puis exactement : "Détails de l'article :"

Puis bullets dans CET ordre EXACT (chaque ligne commence par l'emoji, suivi de la donnée) :

🏷️ Marque : [marque]
📏 Taille : [taille]
🎨 Couleur : [couleur précise observée sur photo si fournie]
✨ État : [état exact, ex: Neuf avec étiquette / Très bon état / Bon état]
🧺 Entretien : [conseil court adapté à la matière : "Lavage en machine à 30°", "Lavage à la main ou nettoyage à sec recommandé", "Brossage doux conseillé", etc.]
📦 Envoi : Rapide et soigné, emballage protégé sous 24-48h
💬 N'hésite pas à me faire une offre ou à poser tes questions !

RÈGLES STRICTES POUR LA DESCRIPTION :
• N'utilise QUE les 7 emojis listés ci-dessus, à leur place exacte
• Si une info n'est pas connue (ex: marque vide), remplace par "Non renseignée" mais GARDE la ligne
• Pas de superlatifs creux ("incroyable", "magnifique", "exceptionnel", "à ne pas manquer")
• Pas de formules vendeuses agressives ("foncez", "stock limité", "dépêchez-vous")
• Tutoiement naturel sur la dernière ligne
• Pas d'autres emojis ailleurs dans la description
• Chaque bullet sur sa propre ligne (utilise \\n pour les sauts)

**HASHTAGS (exactement 8)**
• Mots-clés réellement recherchés sur Vinted, en minuscules, sans #
• Mix obligatoire : marque, type d'article, style/esthétique, matière, couleur, occasion d'usage
• Pas de hashtags génériques inutiles ("vinted", "vente", "occasion", "pascher")

━━━ FORMAT DE SORTIE ━━━

Réponds UNIQUEMENT en JSON valide, sans balises markdown, sans texte avant ou après. Structure exacte :

{
  "titre": "...",
  "prix_recommande": "nombre seul",
  "description": "Phrase d'accroche.\\n\\nDétails de l'article :\\n\\n🏷️ Marque : ...\\n📏 Taille : ...\\n🎨 Couleur : ...\\n✨ État : ...\\n🧺 Entretien : ...\\n📦 Envoi : ...\\n💬 N'hésite pas...",
  "hashtags": ["tag1","tag2","tag3","tag4","tag5","tag6","tag7","tag8"]
}`;

  const content = [];
  if (images?.length > 0) {
    images.slice(0, 4).forEach(img => {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.type,
          data: img.data
        }
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
      return res.status(response.status).json({ error: data.error?.message || 'Erreur API' });
    }

    const text = data.content[0].text.trim().replace(/```json|```/g, '').trim();
    const result = JSON.parse(text);
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

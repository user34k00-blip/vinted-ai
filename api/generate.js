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

  if (!userId) return res.status(401).json({ error: 'Connecte-toi pour générer une annonce.', code: 'NOT_LOGGED_IN' });

  const users = await supabase('GET', `/users?id=eq.${userId}&select=*`);
  if (!users || users.length === 0) return res.status(401).json({ error: 'Utilisateur introuvable.', code: 'NOT_FOUND' });

  const user = users[0];
  const today = new Date().toISOString().split('T')[0];

  if (user.last_reset !== today) {
    await supabase('PATCH', `/users?id=eq.${userId}`, { daily_count: 0, last_reset: today });
    user.daily_count = 0;
  }

  if (!user.is_premium && user.daily_count >= 3) {
    return res.status(403).json({
      error: 'Tu as atteint ta limite de 3 annonces gratuites aujourd\'hui.',
      code: 'QUOTA_EXCEEDED',
      daily_count: user.daily_count,
      is_premium: false
    });
  }

  const isPremium = user.is_premium;
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

  // ── PROMPT STANDARD (gratuit) ──────────────────────────────────
  const standardPrompt = `Tu es un vendeur Vinted expert en France. Génère une annonce qui vend vite.

ARTICLE :
- Catégorie : ${category}
- État : ${condition}
${brand ? `- Marque : ${brand}` : '- Marque : inconnue (détecte sur photos)'}
${size ? `- Taille : ${size}` : '- Taille : non fournie (détecte sur étiquette)'}
- Prix vendeur : ${price}€
${keywords ? `- Détails : ${keywords}` : ''}
${notes ? `- Notes : ${notes}` : ''}
${images && images.length > 0 ? `- ${images.length} photo(s) — analyse couleur, matière, logo, état.` : ''}

━━━ TITRE (50-60 chars) ━━━
[Marque] [type] [couleur] [taille] — marque premium en PREMIER
INTERDIT : beau, super, nickel, top, parfait

━━━ DESCRIPTION (4 lignes) ━━━
Ligne 1 : [emoji] description factuelle
Ligne 2 : 🏷️ état honnête
Ligne 3 : 💎 valeur ajoutée objective
Ligne 4 : 📮 infos pratiques envoi
Max 2 emojis. INTERDIT : superbe, magnifique, n'hésitez pas, à saisir, pépite

Après les 4 lignes, ligne vide puis exactement :
${signature}

━━━ PRIX ━━━
Neuf étiquette: 45-65% | TBE: 25-40% | BE: 15-25%
Garde ${price}€ si fourchette ok. Chiffre entier.

━━━ HASHTAGS (12-15) ━━━
2-3 marque | 3-4 catégorie | 3-4 style | 2-3 Vinted | 1-2 niche. Sans #.

JSON strict : {"titre":"...","prix_recommande":"...","description":"...","hashtags":[...],"vinted_search_url":"${vintedSearchUrl}"}`;

  // ── PROMPT PREMIUM (boosté) ────────────────────────────────────
  const premiumPrompt = `Tu es un expert en vente Vinted France avec un taux de conversion de 95%. Tu connais parfaitement la psychologie des acheteurs Vinted, les tendances du marché secondaire, et les techniques pour maximiser les ventes. Ton analyse est précise, data-driven et stratégique.

ARTICLE À ANALYSER EN PROFONDEUR :
- Catégorie : ${category}
- État : ${condition}
${brand ? `- Marque : ${brand}` : '- Marque : inconnue — IDENTIFIE-LA sur les photos (logo, étiquette, style)'}
${size ? `- Taille : ${size}` : '- Taille : non fournie — DÉTECTE sur l\'étiquette visible en photo'}
- Prix vendeur : ${price}€
${keywords ? `- Détails : ${keywords}` : ''}
${notes ? `- Notes vendeur : ${notes}` : ''}
${images && images.length > 0 ? `- ${images.length} photo(s) — ANALYSE COMPLÈTE : couleur exacte (nuance précise), matière, texture visible, coupe, modèle exact, numéro de série si visible, état réel (micro-défauts éventuels), étiquettes visibles.` : ''}

━━━ TITRE PREMIUM ━━━
• 50-60 caractères MAXIMUM — compte précisément
• Format optimal : [Marque] + [modèle exact si connu] + [couleur précise] + [taille] + [état si pertinent]
• Inclure le nom du modèle exact si identifiable (ex: "Nike Air Force 1" pas juste "Nike")
• Couleur précise : "bleu marine" pas "bleu", "beige sable" pas "beige"
• Marques premium TOUJOURS en premier : Nike, Adidas, Supreme, Stone Island, Off-White, Balenciaga, Gucci, Zara, H&M, etc.
• INTERDIT : beau, super, nickel, top, parfait, rare, pépite, incroyable

━━━ DESCRIPTION PREMIUM ━━━
4 lignes percutantes qui convertissent :

Ligne 1 : [emoji précis] + description ultra-factuelle (modèle exact, coloris précis, matière, coupe, détails distinctifs visibles sur photos)
Ligne 2 : 🏷️ + état avec détails concrets et rassurants (jamais porté / porté X fois / lavé X fois à X°C / étiquette encore attachée / 0 défaut visible après inspection minutieuse)
Ligne 3 : 💎 + argument de vente stratégique basé sur des faits (modèle sold out sur le site officiel, coloris exclusif à cette saison, taille rare dans cet état, rapport qualité/prix imbattable au vu du prix neuf)
Ligne 4 : 📮 + infos pratiques complètes (Mondial Relay disponible / Colissimo suivi / remise en main propre région X si possible / échange non / offres sérieuses bienvenues OU prix ferme)

Emojis ligne 1 précis selon article :
👕 t-shirt/polo | 👗 robe/jupe | 🧥 veste/manteau/blouson | 👖 pantalon/jean | 🧢 casquette/bonnet/chapeau | 👟 sneakers/baskets | 👠 escarpins/talons | 👞 derbies/mocassins | 👢 bottes | 👜 sac à main | 🎒 sac à dos | ⌚ montre | 💍 bijou | 📱 smartphone | 💻 ordinateur | 🎮 console/jeu | 🎧 audio | 🏋️ sport/fitness | 🧘 yoga/bien-être | 🏠 déco/maison | 📚 livre

INTERDITS dans ces 4 lignes : superbe, magnifique, beau, nickel, top, parfait, incroyable, n'hésitez pas, à saisir, pépite, rare, coup de cœur, opportunité

Après les 4 lignes, ligne vide puis EXACTEMENT cette signature :
${signature}

━━━ ANALYSE PRIX MARCHÉ ━━━
Analyse fine basée sur l'état ET la demande actuelle :
• Neuf avec étiquette : 45-65% du prix boutique neuf
• Neuf sans étiquette : 35-55% du prix boutique
• Très bon état : 28-42% du prix boutique
• Bon état : 18-28% du prix boutique
• Satisfaisant : 10-18% du prix boutique

Facteurs qui augmentent le prix : marque premium, modèle discontinued, collab limitée, taille rare, saison en cours
Facteurs qui baissent le prix : marque générique, modèle classique toujours dispo, taille commune, hors saison

Si le prix vendeur (${price}€) est dans la fourchette optimale → conserve-le.
Si >20% au-dessus → ajuste pour vendre dans les 48h.
Si trop bas → conserve (avantage vendeur).
Retourne UNIQUEMENT le chiffre entier.

━━━ HASHTAGS PREMIUM (14-16) ━━━
Sélection stratégique pour maximiser la visibilité :
• 2-3 hashtags de marque (marque + sous-marque/ligne si applicable)
• 3-4 hashtags de produit précis (type exact + sous-catégorie)
• 3-4 hashtags de style/univers (streetwear, workwear, casual, luxury, vintage, y2k, gorpcore...)
• 2-3 hashtags tendance Vinted (vintedmode, secondemain, mode, tendance, bonplan)
• 1-2 hashtags ultra-ciblés (coloris précis, modèle, collaboration, saison)
Sans # dans le JSON.

━━━ CONSEILS VENDEUR PREMIUM ━━━
Ajoute un champ "conseils" avec 2-3 conseils personnalisés pour maximiser les chances de vente de CET article spécifique (ex: meilleure heure pour republier, suggestion de prix négo, conseil photo, timing saisonnier).

JSON strict sans markdown :
{"titre":"...","prix_recommande":"...","description":"...","hashtags":[...],"vinted_search_url":"${vintedSearchUrl}","conseils":"..."}`;

  const prompt = isPremium ? premiumPrompt : standardPrompt;
  const maxTokens = isPremium ? 2000 : 1500;

  const content = [];
  if (images && images.length > 0) {
    // Premium analyse jusqu'à 6 photos, gratuit 4
    const maxImages = isPremium ? 6 : 4;
    images.slice(0, maxImages).forEach(img => {
      content.push({ type: 'image', source: { type: 'base64', media_type: img.type, data: img.data } });
    });
  }
  content.push({ type: 'text', text: prompt });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: maxTokens, messages: [{ role: 'user', content }] })
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'Erreur API' });

    const rawText = data.content[0].text.trim().replace(/```json|```/g, '').trim();
    const result = JSON.parse(rawText);
    if (!result.vinted_search_url) result.vinted_search_url = vintedSearchUrl;

    const newCount = (user.daily_count || 0) + 1;
    await supabase('PATCH', `/users?id=eq.${userId}`, { daily_count: newCount });
    result.daily_count = newCount;
    result.is_premium = isPremium;
    result.remaining = isPremium ? 999 : Math.max(0, 3 - newCount);

    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

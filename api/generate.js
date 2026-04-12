const Anthropic = require("@anthropic-ai/sdk");

// ── Rate limiting en mémoire (IP + jour Paris) ────────────────────────────────
const dailyUsage = new Map();

function getClientIP(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function getParisDateString() {
  return new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
}

function getMidnightParisTimestamp() {
  const now = new Date();
  const parisStr = now.toLocaleString("en-US", { timeZone: "Europe/Paris" });
  const parisNow = new Date(parisStr);
  const midnight = new Date(parisNow);
  midnight.setHours(24, 0, 0, 0);
  const diffMs = midnight - parisNow;
  return Date.now() + diffMs;
}

// ── Handler principal ─────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Methode non autorisee" });

  if (!process.env.ANTHROPIC_API_KEY)
    return res.status(500).json({ error: "ANTHROPIC_API_KEY manquante" });

  // ── Vérification limite quotidienne ──────────────────────────────────────
  const ip = getClientIP(req);
  const today = getParisDateString();
  const key = `${ip}__${today}`;
  const usage = dailyUsage.get(key) || { count: 0 };

  if (usage.count >= 1) {
    return res.status(429).json({
      error: "DAILY_LIMIT_REACHED",
      resetTime: getMidnightParisTimestamp(),
      message: "Tu as deja genere une annonce aujourd'hui.",
    });
  }

  // Incrémenter AVANT l'appel API (bloque les doubles-clics)
  dailyUsage.set(key, { count: usage.count + 1 });

  // Nettoyage des vieilles clés
  for (const [k] of dailyUsage) {
    if (!k.includes(`__${today}`)) dailyUsage.delete(k);
  }

  // ── Corps de la requête ───────────────────────────────────────────────────
  const { category, condition, brand, size, price, keywords, notes, images } =
    req.body || {};

  if (!category || !price) {
    dailyUsage.set(key, { count: 0 });
    return res.status(400).json({ error: "Champs manquants : category et price requis" });
  }

  // ── Préparation images ────────────────────────────────────────────────────
  const imageContent = [];
  if (Array.isArray(images) && images.length > 0) {
    for (const img of images.slice(0, 4)) {
      if (img?.data && img?.type) {
        imageContent.push({
          type: "image",
          source: { type: "base64", media_type: img.type, data: img.data },
        });
      }
    }
  }

  // ── Fourchette de prix ────────────────────────────────────────────────────
  const fourchettes = {
    "Neuf avec etiquette": [0.45, 0.65],
    "Neuf sans etiquette": [0.35, 0.5],
    "Tres bon etat": [0.25, 0.4],
    "Bon etat": [0.15, 0.25],
    Satisfaisant: [0.1, 0.15],
  };
  const conditionKey = (condition || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const [minR, maxR] = fourchettes[conditionKey] || [0.2, 0.35];
  const prixNum = parseFloat(price) || 0;
  const prixMin = Math.round(prixNum * minR);
  const prixMax = Math.round(prixNum * maxR);

  // ── Signature ─────────────────────────────────────────────────────────────
  const signatureMap = {
    "Neuf avec \u00e9tiquette": "\u2728Article Neuf Avec Etiquette Jamais Port\u00e9\u2728",
    "Neuf sans \u00e9tiquette": "\u2728Article Neuf Sans Etiquette\u2728",
    "Tr\u00e8s bon \u00e9tat": "\u2728Article en Tr\u00e8s Bon \u00c9tat\u2728",
    "Bon \u00e9tat": "\u2728Article en Bon \u00c9tat\u2728",
    Satisfaisant: "\u2728Article en \u00c9tat Satisfaisant\u2728",
  };
  const signature = signatureMap[condition] || "\u2728Article Vinted\u2728";
  const signatureBlock = `${signature}
\uD83D\uDCE6Emballage du colis soign\u00e9\uD83D\uDCE6
\u231BEnvoi du colis en 24H max\u231B
\u2705Article Authentique\u2705
\u2757La proc\u00e9dure d'envoi sera film\u00e9e du d\u00e9but \u00e0 la fin\u2757`;

  // ── Prompt système ────────────────────────────────────────────────────────
  const systemPrompt = `Tu es un expert en vente sur Vinted. Tu generes des annonces professionnelles, honnetes et percutantes.

MOTS INTERDITS dans la description (hors signature) : superbe, magnifique, beau, nickel, top, parfait, incroyable, n'hesitez pas, envoi soigne, a saisir, pepite, rare

STRUCTURE OBLIGATOIRE de la description :
Ligne 1 : [emoji categorie] Description factuelle (couleur, matiere, coupe, modele)
Ligne 2 : 🏷️ Etat honnete (jamais porte / porte X fois / rien a signaler)
Ligne 3 : 💎 Valeur ajoutee (modele precis, coloris, taille...)
Ligne 4 : 📮 Pratique (Mondial Relay / Colissimo, echange oui/non, prix ferme/nego)
[ligne vide]
${signatureBlock}

HASHTAGS : 12 a 15 hashtags en 5 categories :
1. Marque (2-3) · 2. Categorie precise (3-4) · 3. Style/usage (3-4) · 4. Populaires Vinted (2-3) · 5. Niche (1-2)

PRIX RECOMMANDE : entre ${prixMin}€ et ${prixMax}€ (base sur l'etat "${condition}")

Reponds UNIQUEMENT en JSON valide, sans markdown, sans backticks :
{
  "titre": "...",
  "prix_recommande": "...",
  "description": "...",
  "hashtags": ["...", "..."],
  "vinted_search_url": "https://www.vinted.fr/catalog?search_text=..."
}`;

  const userMessage = [
    ...imageContent,
    {
      type: "text",
      text: `Categorie : ${category}
Etat : ${condition}
${brand ? "Marque : " + brand : ""}
${size ? "Taille : " + size : ""}
Prix souhaite : ${price}\u20ac
${keywords ? "Mots-cles : " + keywords : ""}
${notes ? "Notes : " + notes : ""}

Genere l'annonce Vinted optimisee.`,
    },
  ];

  // ── Appel Anthropic ───────────────────────────────────────────────────────
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const rawText = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    let parsed;
    try {
      parsed = JSON.parse(rawText.replace(/```json|```/g, "").trim());
    } catch {
      dailyUsage.set(key, { count: 0 });
      return res.status(500).json({ error: "Reponse IA invalide", raw: rawText });
    }

    return res.status(200).json(parsed);
  } catch (err) {
    // Rembourser le quota si l'API plante
    dailyUsage.set(key, { count: 0 });
    console.error("Anthropic error:", err);
    return res.status(500).json({ error: err.message || "Erreur serveur" });
  }
};

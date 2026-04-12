const Anthropic = require("@anthropic-ai/sdk");

// ── Rate limiting en memoire (IP + jour Paris) ────────────────────────────────
const dailyUsage = new Map();

function getClientIP(req) {
  var forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers["x-real-ip"] || "unknown";
}

function getParisDateString() {
  return new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
}

function getMidnightParisMs() {
  var parisStr = new Date().toLocaleString("en-US", { timeZone: "Europe/Paris" });
  var parisNow = new Date(parisStr);
  var midnight = new Date(parisNow);
  midnight.setHours(24, 0, 0, 0);
  return Date.now() + (midnight - parisNow);
}

// ── Handler ───────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY manquante" });
  }

  // ── Rate limiting ────────────────────────────────────────────────────────
  try {
    var ip = getClientIP(req);
    var today = getParisDateString();
    var key = ip + "__" + today;
    var usage = dailyUsage.get(key) || { count: 0 };

    if (usage.count >= 1) {
      return res.status(429).json({
        error: "DAILY_LIMIT_REACHED",
        resetTime: getMidnightParisMs(),
        message: "Tu as deja genere une annonce aujourd'hui."
      });
    }

    dailyUsage.set(key, { count: usage.count + 1 });

    // Nettoyage des vieilles entrees
    dailyUsage.forEach(function(val, k) {
      if (k.indexOf("__" + today) === -1) dailyUsage.delete(k);
    });
  } catch (e) {
    // Si rate limiting plante, on laisse passer (fail open)
    console.error("Rate limit error:", e);
  }

  // ── Lecture du body ──────────────────────────────────────────────────────
  var body = req.body || {};
  var category = body.category || "";
  var condition = body.condition || "Tres bon etat";
  var brand = body.brand || "";
  var size = body.size || "";
  var price = body.price || "";
  var keywords = body.keywords || "";
  var notes = body.notes || "";
  var images = body.images || [];

  if (!category || !price) {
    return res.status(400).json({ error: "Champs manquants : category et price requis" });
  }

  // ── Fourchette prix ──────────────────────────────────────────────────────
  var prixNum = parseFloat(price) || 0;
  var minR = 0.2, maxR = 0.35;
  var cond = condition.toLowerCase();
  if (cond.indexOf("neuf") !== -1 && cond.indexOf("tiquette") !== -1 && cond.indexOf("sans") === -1) {
    minR = 0.45; maxR = 0.65;
  } else if (cond.indexOf("sans") !== -1 && cond.indexOf("tiquette") !== -1) {
    minR = 0.35; maxR = 0.50;
  } else if (cond.indexOf("tres") !== -1 || cond.indexOf("très") !== -1) {
    minR = 0.25; maxR = 0.40;
  } else if (cond.indexOf("bon") !== -1) {
    minR = 0.15; maxR = 0.25;
  } else if (cond.indexOf("satisfaisant") !== -1) {
    minR = 0.10; maxR = 0.15;
  }
  var prixMin = Math.round(prixNum * minR);
  var prixMax = Math.round(prixNum * maxR);

  // ── Signature ────────────────────────────────────────────────────────────
  var signatureLabel = "Article Vinted";
  if (cond.indexOf("neuf") !== -1 && cond.indexOf("sans") === -1 && cond.indexOf("tiquette") !== -1) {
    signatureLabel = "Article Neuf Avec Etiquette Jamais Porte";
  } else if (cond.indexOf("sans") !== -1 && cond.indexOf("tiquette") !== -1) {
    signatureLabel = "Article Neuf Sans Etiquette";
  } else if (cond.indexOf("tres") !== -1 || cond.indexOf("très") !== -1) {
    signatureLabel = "Article en Tres Bon Etat";
  } else if (cond.indexOf("bon") !== -1) {
    signatureLabel = "Article en Bon Etat";
  } else if (cond.indexOf("satisfaisant") !== -1) {
    signatureLabel = "Article en Etat Satisfaisant";
  }

  var signatureBlock = [
    "\u2728" + signatureLabel + "\u2728",
    "\uD83D\uDCE6Emballage du colis soign\u00e9\uD83D\uDCE6",
    "\u231BEnvoi du colis en 24H max\u231B",
    "\u2705Article Authentique\u2705",
    "\u2757La proc\u00e9dure d'envoi sera film\u00e9e du d\u00e9but \u00e0 la fin\u2757"
  ].join("\n");

  // ── Prompt ───────────────────────────────────────────────────────────────
  var systemPrompt = "Tu es un expert en vente sur Vinted. Tu generes des annonces professionnelles et percutantes.\n\n"
    + "MOTS INTERDITS dans la description (hors signature) : superbe, magnifique, beau, nickel, top, parfait, incroyable, n'hesitez pas, envoi soigne, a saisir, pepite, rare\n\n"
    + "STRUCTURE OBLIGATOIRE de la description :\n"
    + "Ligne 1 : [emoji] Description factuelle (couleur, matiere, coupe, modele)\n"
    + "Ligne 2 : \uD83C\uDFF7\uFE0F Etat honnte (jamais porte / porte X fois)\n"
    + "Ligne 3 : \uD83D\uDC8E Valeur ajoutee (modele precis, coloris, taille)\n"
    + "Ligne 4 : \uD83D\uDCEE Pratique (Mondial Relay / Colissimo, echange oui/non)\n"
    + "[ligne vide]\n"
    + signatureBlock + "\n\n"
    + "HASHTAGS : 12 a 15 hashtags en 5 categories : Marque (2-3), Categorie (3-4), Style (3-4), Populaires Vinted (2-3), Niche (1-2)\n\n"
    + "PRIX RECOMMANDE : entre " + prixMin + "\u20ac et " + prixMax + "\u20ac\n\n"
    + "Reponds UNIQUEMENT en JSON valide, sans markdown, sans backticks :\n"
    + '{"titre":"...","prix_recommande":"...","description":"...","hashtags":["..."],"vinted_search_url":"https://www.vinted.fr/catalog?search_text=..."}';

  // ── Images ───────────────────────────────────────────────────────────────
  var messageContent = [];
  if (Array.isArray(images)) {
    images.slice(0, 4).forEach(function(img) {
      if (img && img.data && img.type) {
        messageContent.push({
          type: "image",
          source: { type: "base64", media_type: img.type, data: img.data }
        });
      }
    });
  }
  messageContent.push({
    type: "text",
    text: "Categorie : " + category + "\n"
      + "Etat : " + condition + "\n"
      + (brand ? "Marque : " + brand + "\n" : "")
      + (size ? "Taille : " + size + "\n" : "")
      + "Prix souhaite : " + price + "\u20ac\n"
      + (keywords ? "Mots-cles : " + keywords + "\n" : "")
      + (notes ? "Notes : " + notes + "\n" : "")
      + "\nGenere l'annonce Vinted optimisee."
  });

  // ── Appel Anthropic ──────────────────────────────────────────────────────
  try {
    var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    var response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: messageContent }]
    });

    var rawText = "";
    response.content.forEach(function(block) {
      if (block.type === "text") rawText += block.text;
    });

    var clean = rawText.replace(/```json/g, "").replace(/```/g, "").trim();

    var parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (parseErr) {
      // Rembourser le quota
      var k2 = getClientIP(req) + "__" + getParisDateString();
      dailyUsage.set(k2, { count: 0 });
      return res.status(500).json({ error: "Reponse IA invalide - reessaie", raw: clean.substring(0, 200) });
    }

    return res.status(200).json(parsed);

  } catch (err) {
    // Rembourser le quota si l'API plante
    try {
      var k3 = getClientIP(req) + "__" + getParisDateString();
      dailyUsage.set(k3, { count: 0 });
    } catch(e2) {}
    console.error("Anthropic API error:", err.message);
    return res.status(500).json({ error: err.message || "Erreur serveur" });
  }
};

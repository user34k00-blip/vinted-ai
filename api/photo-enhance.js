const Anthropic = require("@anthropic-ai/sdk");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY manquante" });
  }

  var body = req.body || {};
  var userId = body.userId;
  var image = body.image; // { data: base64, type: mime }
  var mode = body.mode || "enhance"; // "enhance" | "background"
  var backgroundDesc = body.backgroundDesc || "";

  if (!userId) return res.status(401).json({ code: "NOT_LOGGED_IN", error: "Non connecté" });
  if (!image || !image.data || !image.type) return res.status(400).json({ error: "Image manquante" });

  // ── Vérification premium via Supabase ────────────────────────────────────
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    try {
      var checkRes = await fetch(
        process.env.SUPABASE_URL + "/rest/v1/users?id=eq." + userId + "&select=is_premium",
        {
          headers: {
            apikey: process.env.SUPABASE_SERVICE_KEY,
            Authorization: "Bearer " + process.env.SUPABASE_SERVICE_KEY
          }
        }
      );
      var users = await checkRes.json();
      if (!users || !users[0] || !users[0].is_premium) {
        return res.status(403).json({ code: "NOT_PREMIUM", error: "Fonctionnalité Premium uniquement" });
      }
    } catch (e) {
      console.error("Supabase check error:", e.message);
      // Fail open si Supabase down
    }
  }

  // ── Prompt selon le mode ─────────────────────────────────────────────────
  var analysisPrompt = "";

  if (mode === "enhance") {
    analysisPrompt = "Tu es un expert en retouche photo pour la vente en ligne sur Vinted.\n\n"
      + "Analyse cette photo de vêtement/article et génère des instructions ULTRA PRÉCISES et DÉTAILLÉES "
      + "pour retoucher cette image avec un logiciel (ou décris ce qu'une IA image devrait faire).\n\n"
      + "Objectif : rendre la photo plus vendeuse sans modifier l'article lui-même.\n"
      + "Actions autorisées :\n"
      + "- Supprimer ou lisser les plis du vêtement\n"
      + "- Améliorer la luminosité et le contraste\n"
      + "- Corriger la balance des blancs\n"
      + "- Supprimer les petits défauts visuels (poussières, peluches visibles)\n"
      + "- Redresser l'image si nécessaire\n"
      + "- Améliorer la netteté\n"
      + "Actions INTERDITES :\n"
      + "- Ne JAMAIS changer la couleur de l'article\n"
      + "- Ne JAMAIS modifier le décor ou l'arrière-plan (sauf si mode background)\n"
      + "- Ne JAMAIS changer la taille ou la forme de l'article\n"
      + "- Ne JAMAIS ajouter ou supprimer des éléments de l'article\n\n"
      + "Réponds UNIQUEMENT en JSON valide, sans markdown :\n"
      + '{"analyse":"Description courte de ce qui a été détecté sur la photo","ameliorations":["action 1 précise","action 2 précise",...],"prompt_retouche":"Un prompt détaillé en anglais pour générer une version retouchée via Stable Diffusion / DALL-E","score_avant":7,"score_apres_estime":9,"conseils_photo":["conseil 1","conseil 2"]}';
  } else {
    // mode === "background"
    var bgDesc = backgroundDesc || "fond blanc uni épuré";
    analysisPrompt = "Tu es un expert en retouche photo pour la vente en ligne sur Vinted.\n\n"
      + "Analyse cette photo et génère des instructions précises pour changer l'arrière-plan.\n\n"
      + "Fond souhaité par l'utilisateur : " + bgDesc + "\n\n"
      + "L'article principal (vêtement/objet) doit rester EXACTEMENT identique.\n"
      + "Seul l'arrière-plan change.\n\n"
      + "Réponds UNIQUEMENT en JSON valide, sans markdown :\n"
      + '{"analyse":"Description de l\'article détecté","nouveau_fond":"' + bgDesc + '","prompt_retouche":"Prompt détaillé en anglais pour Stable Diffusion / DALL-E pour changer le fond en : ' + bgDesc + ', garder l\'article identique, photo professionnelle de vente","conseils":["conseil 1","conseil 2"],"compatibilite":"Pourquoi ce fond est bien ou pas pour cet article"}';
  }

  // ── Appel Anthropic ──────────────────────────────────────────────────────
  try {
    var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    var response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: image.type, data: image.data }
          },
          {
            type: "text",
            text: analysisPrompt
          }
        ]
      }]
    });

    var rawText = "";
    response.content.forEach(function(block) {
      if (block.type === "text") rawText += block.text;
    });

    var clean = rawText.replace(/```json/g, "").replace(/```/g, "").trim();

    var parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      return res.status(500).json({ error: "Réponse IA invalide", raw: clean.substring(0, 200) });
    }

    return res.status(200).json({ mode: mode, result: parsed });

  } catch (err) {
    console.error("Anthropic API error:", err.message);
    return res.status(500).json({ error: err.message || "Erreur serveur" });
  }
};

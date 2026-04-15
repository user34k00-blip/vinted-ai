const { Blob } = require("buffer");
const Anthropic = require("@anthropic-ai/sdk");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body || {};
  const userId = body.userId;
  const image = body.image;
  const mode = body.mode === "background" ? "background" : "enhance";
  const backgroundDesc = sanitizeBackgroundDescription(body.backgroundDesc);

  if (!userId) {
    return res.status(401).json({ code: "NOT_LOGGED_IN", error: "Non connecte" });
  }

  if (!image || !image.data || !image.type) {
    return res.status(400).json({ error: "Image manquante" });
  }

  const premiumStatus = await ensurePremiumAccess(userId);
  if (!premiumStatus.ok) {
    return res.status(403).json({
      code: "NOT_PREMIUM",
      error: "Fonctionnalite Premium uniquement"
    });
  }

  try {
    if (mode === "background") {
      const result = await replaceBackgroundWithOpenAI(image, backgroundDesc);
      return res.status(200).json({ mode, result });
    }

    const result = await analyzePhotoWithAnthropic(image);
    return res.status(200).json({ mode, result });
  } catch (error) {
    console.error("photo-enhance error:", error.message);
    return res.status(500).json({ error: error.message || "Erreur serveur" });
  }
};

async function ensurePremiumAccess(userId) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return { ok: true };
  }

  try {
    const response = await fetch(
      process.env.SUPABASE_URL + "/rest/v1/users?id=eq." + encodeURIComponent(userId) + "&select=is_premium",
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Authorization: "Bearer " + process.env.SUPABASE_SERVICE_KEY
        }
      }
    );

    const users = await response.json();
    return { ok: !!(users && users[0] && users[0].is_premium) };
  } catch (error) {
    console.error("Supabase check error:", error.message);
    return { ok: true };
  }
}

function sanitizeBackgroundDescription(value) {
  if (typeof value !== "string") return "fond blanc studio epure";
  const clean = value.trim().replace(/\s+/g, " ");
  return clean ? clean.slice(0, 180) : "fond blanc studio epure";
}

function normalizeMimeType(mimeType) {
  if (mimeType === "image/png" || mimeType === "image/webp") return mimeType;
  return "image/jpeg";
}

function getFileExtension(mimeType) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

function buildBackgroundEditPrompt(backgroundDesc) {
  return [
    "Edit this marketplace product photo.",
    "Replace only the background with:",
    backgroundDesc + ".",
    "Keep the product exactly the same.",
    "Do not change the item shape, color, texture, logo, labels, stitching, proportions, or framing.",
    "Preserve the original pose and camera angle.",
    "Create a clean, realistic ecommerce result with natural shadows and professional lighting.",
    "Do not add extra objects, hands, mannequins, text, or decorations unless explicitly requested in the new background."
  ].join(" ");
}

async function replaceBackgroundWithOpenAI(image, backgroundDesc) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY manquante. ChatGPT Business ne peut pas servir directement de cle API pour ce site."
    );
  }

  const mimeType = normalizeMimeType(image.type);
  const extension = getFileExtension(mimeType);
  const bytes = Buffer.from(image.data, "base64");
  const form = new FormData();

  form.append("model", process.env.OPENAI_IMAGE_MODEL || "gpt-image-1");
  form.append("prompt", buildBackgroundEditPrompt(backgroundDesc));
  form.append("image", new Blob([bytes], { type: mimeType }), "product." + extension);
  form.append("quality", "medium");
  form.append("size", "auto");
  form.append("output_format", "png");
  form.append("background", "opaque");

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey
    },
    body: form
  });

  const data = await response.json();
  if (!response.ok) {
    const message =
      data &&
      data.error &&
      (data.error.message || data.error.code || data.error.type);
    throw new Error(message || "Erreur OpenAI Images");
  }

  const editedImage = data && data.data && data.data[0] && data.data[0].b64_json;
  if (!editedImage) {
    throw new Error("Aucune image modifiee n'a ete retournee par OpenAI.");
  }

  return {
    edited_image: "data:image/png;base64," + editedImage,
    nouveau_fond: backgroundDesc,
    note: "Fond remplace cote serveur via OpenAI. Le prompt interne n'est pas affiche a l'utilisateur.",
    provider: "openai"
  };
}

async function analyzePhotoWithAnthropic(image) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY manquante");
  }

  const prompt = [
    "Tu es un expert en retouche photo pour la vente en ligne sur Vinted.",
    "",
    "Analyse cette photo de vetement/article et genere des instructions ultra precises et detaillees",
    "pour retoucher cette image avec un logiciel ou decrire ce qu'une IA image devrait faire.",
    "",
    "Objectif : rendre la photo plus vendeuse sans modifier l'article lui-meme.",
    "Actions autorisees :",
    "- Supprimer ou lisser les plis du vetement",
    "- Ameliorer la luminosite et le contraste",
    "- Corriger la balance des blancs",
    "- Supprimer les petits defauts visuels (poussieres, peluches visibles)",
    "- Redresser l'image si necessaire",
    "- Ameliorer la nettete",
    "Actions interdites :",
    "- Ne jamais changer la couleur de l'article",
    "- Ne jamais modifier le decor ou l'arriere-plan",
    "- Ne jamais changer la taille ou la forme de l'article",
    "- Ne jamais ajouter ou supprimer des elements de l'article",
    "",
    "Reponds uniquement en JSON valide, sans markdown :",
    '{"analyse":"Description courte de ce qui a ete detecte sur la photo","ameliorations":["action 1 precise","action 2 precise"],"prompt_retouche":"Un prompt detaille en anglais pour generer une version retouchee via Stable Diffusion / DALL-E","score_avant":7,"score_apres_estime":9,"conseils_photo":["conseil 1","conseil 2"]}'
  ].join("\n");

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1500,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: image.type,
              data: image.data
            }
          },
          {
            type: "text",
            text: prompt
          }
        ]
      }
    ]
  });

  let rawText = "";
  response.content.forEach(function(block) {
    if (block.type === "text") rawText += block.text;
  });

  const clean = rawText.replace(/```json/g, "").replace(/```/g, "").trim();

  try {
    return JSON.parse(clean);
  } catch (error) {
    throw new Error("Reponse IA invalide");
  }
}

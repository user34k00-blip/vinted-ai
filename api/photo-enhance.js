const { Blob } = require("buffer");
const zlib = require("zlib");
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
    "Replace only the background of this ecommerce product photo with:",
    backgroundDesc + ".",
    "The product must remain exactly the same as the input image.",
    "Do not redraw, restyle, reshape, clean, smooth, relight, recolor, or enhance the product itself.",
    "Preserve the exact garment silhouette, folds, seams, logos, labels, strings, tags, proportions, camera angle, crop, and texture.",
    "Only generate a professional marketplace background with realistic shadows around the preserved item."
  ].join(" ");
}

async function replaceBackgroundWithOpenAI(image, backgroundDesc) {
  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (!openAiApiKey) {
    throw new Error(
      "OPENAI_API_KEY manquante. ChatGPT Business ne peut pas servir directement de cle API pour ce site."
    );
  }

  const mimeType = normalizeMimeType(image.type);
  const extension = getFileExtension(mimeType);
  const bytes = Buffer.from(image.data, "base64");
  const dimensions = getImageDimensions(bytes, mimeType);
  const subjectBox = await detectSubjectBounds(image, dimensions.width, dimensions.height);
  const protectedBox = expandBounds(subjectBox, dimensions.width, dimensions.height);
  const maskBuffer = createMaskPng(dimensions.width, dimensions.height, protectedBox);

  const form = new FormData();
  form.append("model", "gpt-image-1");
  form.append("prompt", buildBackgroundEditPrompt(backgroundDesc));
  form.append("image", new Blob([bytes], { type: mimeType }), "product." + extension);
  form.append("mask", new Blob([maskBuffer], { type: "image/png" }), "mask.png");
  form.append("input_fidelity", "high");
  form.append("quality", "medium");
  form.append("size", "auto");
  form.append("output_format", "png");
  form.append("background", "opaque");

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + openAiApiKey
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
    note: "Fond remplace avec masque serveur et fidelite elevee pour proteger l'article.",
    provider: "openai"
  };
}

async function detectSubjectBounds(image, width, height) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return fallbackBounds(width, height);
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = [
      "You are detecting the main sellable product in an ecommerce photo.",
      "Return one JSON object only, without markdown.",
      "Detect a single bounding rectangle that contains the entire sellable item.",
      "If the item is a set with multiple pieces, include all pieces in one rectangle.",
      "Include labels and tags attached to the product.",
      "Exclude chair, floor, wall, table, and other background elements.",
      "Use the original image pixel coordinates.",
      "Image width:", String(width),
      "Image height:", String(height),
      'Format: {"x":123,"y":45,"width":678,"height":910}'
    ].join("\n");

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: image.type, data: image.data }
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

    const parsed = safeJsonParse(rawText);
    if (!parsed) return fallbackBounds(width, height);

    const box = {
      x: clamp(Math.round(Number(parsed.x) || 0), 0, width - 1),
      y: clamp(Math.round(Number(parsed.y) || 0), 0, height - 1),
      width: clamp(Math.round(Number(parsed.width) || 0), 1, width),
      height: clamp(Math.round(Number(parsed.height) || 0), 1, height)
    };

    if (box.x + box.width > width) box.width = width - box.x;
    if (box.y + box.height > height) box.height = height - box.y;

    if (box.width < Math.round(width * 0.2) || box.height < Math.round(height * 0.2)) {
      return fallbackBounds(width, height);
    }

    return box;
  } catch (error) {
    console.error("detectSubjectBounds error:", error.message);
    return fallbackBounds(width, height);
  }
}

function safeJsonParse(text) {
  const clean = String(text || "").replace(/```json/g, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(clean);
  } catch (_) {
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(clean.slice(start, end + 1));
    } catch (_) {
      return null;
    }
  }
}

function fallbackBounds(width, height) {
  return {
    x: Math.round(width * 0.18),
    y: Math.round(height * 0.08),
    width: Math.round(width * 0.64),
    height: Math.round(height * 0.82)
  };
}

function expandBounds(box, width, height) {
  const padX = Math.max(24, Math.round(box.width * 0.12));
  const padY = Math.max(24, Math.round(box.height * 0.12));

  const x = clamp(box.x - padX, 0, width - 1);
  const y = clamp(box.y - padY, 0, height - 1);
  const right = clamp(box.x + box.width + padX, 1, width);
  const bottom = clamp(box.y + box.height + padY, 1, height);

  return {
    x: x,
    y: y,
    width: right - x,
    height: bottom - y
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getImageDimensions(buffer, mimeType) {
  if (mimeType === "image/png") return getPngDimensions(buffer);
  if (mimeType === "image/webp") return getWebpDimensions(buffer);
  return getJpegDimensions(buffer);
}

function getPngDimensions(buffer) {
  if (buffer.length < 24) throw new Error("PNG invalide");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function getJpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error("JPEG invalide");
  }

  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    offset += 2;

    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;

    const length = buffer.readUInt16BE(offset);
    if (length < 2) break;

    const isSOF =
      marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3 ||
      marker === 0xc5 || marker === 0xc6 || marker === 0xc7 ||
      marker === 0xc9 || marker === 0xca || marker === 0xcb ||
      marker === 0xcd || marker === 0xce || marker === 0xcf;

    if (isSOF) {
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5)
      };
    }

    offset += length;
  }

  throw new Error("Dimensions JPEG introuvables");
}

function getWebpDimensions(buffer) {
  const riff = buffer.toString("ascii", 0, 4);
  const webp = buffer.toString("ascii", 8, 12);
  if (riff !== "RIFF" || webp !== "WEBP") {
    throw new Error("WEBP invalide");
  }

  const chunkType = buffer.toString("ascii", 12, 16);

  if (chunkType === "VP8 ") {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff
    };
  }

  if (chunkType === "VP8L") {
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))
    };
  }

  if (chunkType === "VP8X") {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3)
    };
  }

  throw new Error("Format WEBP non supporte");
}

function createMaskPng(width, height, box) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * stride;
    raw[rowOffset] = 0;

    for (let x = 0; x < width; x += 1) {
      const pixelOffset = rowOffset + 1 + x * 4;
      const inside =
        x >= box.x &&
        x < box.x + box.width &&
        y >= box.y &&
        y < box.y + box.height;

      raw[pixelOffset] = 0;
      raw[pixelOffset + 1] = 0;
      raw[pixelOffset + 2] = 0;
      raw[pixelOffset + 3] = inside ? 255 : 0;
    }
  }

  return encodePng(width, height, raw);
}

function encodePng(width, height, rawData) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(rawData);

  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])) >>> 0, 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

let crcTable = null;
function crc32(buffer) {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      crcTable[n] = c >>> 0;
    }
  }

  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = crcTable[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
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

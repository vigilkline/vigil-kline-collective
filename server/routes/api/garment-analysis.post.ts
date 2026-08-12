import { defineHandler } from "nitro";

type GarmentSuggestion = {
  brand?: string;
  description?: string;
  tagPrice?: number | null;
};

function responseText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const value = payload as { output_text?: unknown; output?: unknown[] };
  if (typeof value.output_text === "string") return value.output_text;
  if (!Array.isArray(value.output)) return "";
  return value.output
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const content = (entry as { content?: unknown }).content;
      return Array.isArray(content) ? content : [];
    })
    .map((part) => part && typeof part === "object" ? (part as { text?: unknown }).text : "")
    .filter((text): text is string => typeof text === "string")
    .join("\n");
}

function parseSuggestion(text: string): GarmentSuggestion | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const data = JSON.parse(match[0]) as Record<string, unknown>;
    return {
      brand: typeof data.brand === "string" ? data.brand.trim() : undefined,
      description: typeof data.description === "string" ? data.description.trim() : undefined,
      tagPrice: typeof data.tagPrice === "number" && Number.isFinite(data.tagPrice) && data.tagPrice >= 0 ? data.tagPrice : null,
    };
  } catch {
    return null;
  }
}

export default defineHandler(async (event) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    event.res.status = 503;
    return { error: "AI is not configured on this server yet." };
  }

  let body: { imageDataUrl?: unknown };
  try {
    body = await event.req.json();
  } catch {
    event.res.status = 400;
    return { error: "A garment image is required." };
  }

  const imageDataUrl = typeof body.imageDataUrl === "string" ? body.imageDataUrl : "";
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(imageDataUrl)) {
    event.res.status = 400;
    return { error: "Use a JPG, PNG, or WebP garment photo." };
  }
  if (imageDataUrl.length > 7_000_000) {
    event.res.status = 413;
    return { error: "That photo is too large to analyze. Retake it at a smaller size." };
  }

  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      max_output_tokens: 220,
      input: [{
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Inspect this resale garment photo. Return ONLY valid JSON with exactly these keys: brand (string or empty string), description (short factual clothing description including visible color/style/condition/size if legible), tagPrice (number if a readable price tag is visible, otherwise null). Never invent a brand, size, condition, or price. These are suggestions the seller must verify.",
          },
          { type: "input_image", image_url: imageDataUrl, detail: "low" },
        ],
      }],
    }),
  });

  if (!upstream.ok) {
    console.error("OpenAI garment analysis failed", upstream.status);
    event.res.status = 502;
    return { error: "AI check could not finish. Verify your API billing, model access, and connection, then try again." };
  }

  const suggestion = parseSuggestion(responseText(await upstream.json()));
  if (!suggestion) {
    event.res.status = 502;
    return { error: "AI returned an unreadable suggestion. Try another photo." };
  }
  return { suggestion };
});

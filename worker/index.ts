/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  /** Stored as a Worker secret or local .dev.vars value. Never expose this to the client. */
  OPENAI_API_KEY?: string;
  /** Optional override; VIGILKLINE defaults to the model selected for garment analysis. */
  OPENAI_MODEL?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

type GarmentSuggestion = {
  brand?: string;
  description?: string;
  tagPrice?: number | null;
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

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

async function analyzeGarment(request: Request, env: Env): Promise<Response> {
  if (!env.OPENAI_API_KEY) {
    return jsonError("AI is not configured on this server yet.", 503);
  }

  let body: { imageDataUrl?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("A garment image is required.", 400);
  }
  const imageDataUrl = typeof body.imageDataUrl === "string" ? body.imageDataUrl : "";
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(imageDataUrl)) {
    return jsonError("Use a JPG, PNG, or WebP garment photo.", 400);
  }
  if (imageDataUrl.length > 7_000_000) {
    return jsonError("That photo is too large to analyze. Retake it at a smaller size.", 413);
  }

  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-5.6-luna",
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
    const detail = await upstream.text();
    console.error("OpenAI garment analysis failed", upstream.status, detail.slice(0, 400));
    return jsonError("AI check could not finish. Verify your API billing, model access, and connection, then try again.", 502);
  }
  const suggestion = parseSuggestion(responseText(await upstream.json()));
  if (!suggestion) return jsonError("AI returned an unreadable suggestion. Try another photo.", 502);
  return Response.json({ suggestion });
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/garment-analysis") {
      if (request.method !== "POST") return jsonError("Method not allowed.", 405);
      return analyzeGarment(request, env);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;

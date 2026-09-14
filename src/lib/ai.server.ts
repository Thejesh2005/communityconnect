/**
 * Stage 1-3 of the analysis pipeline (server only).
 *
 * Stage 1 — visual detection: a vision model returns the issue class, its
 *           confidence, and the fraction of the frame the issue occupies.
 * Stage 2 — severity is COMPUTED in code from those numbers plus hazard
 *           factors, not guessed by the model.
 * Stage 3 — the model turns the structured findings into a department-ready
 *           description and recommended action, under a strict JSON schema.
 */

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.8-flash";

export type Detection = {
  detected: boolean;
  category: "pothole" | "garbage" | "water_leak" | "other";
  confidence: number;
  area_fraction: number;
  traffic_exposure: number;
  spread_or_depth: number;
  public_health_risk: number;
  description: string;
  recommended_action: string;
  visible_hazards: string[];
};

const schema = {
  type: "object",
  additionalProperties: false,
  required: [
    "detected",
    "category",
    "confidence",
    "area_fraction",
    "traffic_exposure",
    "spread_or_depth",
    "public_health_risk",
    "description",
    "recommended_action",
    "visible_hazards",
  ],
  properties: {
    detected: { type: "boolean" },
    category: { type: "string", enum: ["pothole", "garbage", "water_leak", "other"] },
    confidence: { type: "number" },
    area_fraction: { type: "number" },
    traffic_exposure: { type: "number" },
    spread_or_depth: { type: "number" },
    public_health_risk: { type: "number" },
    description: { type: "string" },
    recommended_action: { type: "string" },
    visible_hazards: { type: "array", items: { type: "string" } },
  },
} as const;

const SYSTEM = `You inspect citizen-submitted photos of municipal problems.
Classify the dominant issue as pothole, garbage, water_leak, or other.
Report measurements, do not editorialise:
- confidence: 0-1, how sure you are of the class.
- area_fraction: 0-1, share of the image occupied by the damaged/affected area.
- spread_or_depth: 0-1 proxy for pothole depth, garbage pile volume, or water spread, judged against nearby reference objects (kerb height, tiles, vehicles).
- traffic_exposure: 0-1, how much pedestrian/vehicle traffic is exposed to it.
- public_health_risk: 0-1, standing water, sewage, waste decay, contamination.
If the photo shows no municipal issue, set detected false, category other, and low scores.
description: one factual paragraph for a works department. recommended_action: one concrete crew instruction.`;

export async function detectIssue(input: {
  imageBase64: string;
  mimeType: string;
  note?: string | null;
  lat: number;
  lng: number;
}): Promise<Detection> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("AI service is not configured");

  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Location: ${input.lat.toFixed(5)}, ${input.lng.toFixed(5)}.\nCitizen note: ${
                input.note?.trim() || "(none)"
              }`,
            },
            {
              type: "image_url",
              image_url: { url: `data:${input.mimeType};base64,${input.imageBase64}` },
            },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "issue_detection", strict: true, schema },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) throw new Error("Analysis is busy right now — try again in a moment.");
    if (res.status === 402)
      throw new Error("AI credits for this app are exhausted. The app owner needs to top up.");
    throw new Error(`Analysis failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("Analysis returned no result");
  return JSON.parse(content) as Detection;
}

const clamp01 = (n: unknown) => {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.min(1, Math.max(0, v));
};

/** Stage 2: deterministic severity score (0-100) from the measured signals. */
export function computeSeverity(d: Detection): { score: number; priority: string } {
  const area = clamp01(d.area_fraction);
  const depth = clamp01(d.spread_or_depth);
  const traffic = clamp01(d.traffic_exposure);
  const health = clamp01(d.public_health_risk);

  const score = Math.round(
    Math.min(
      100,
      area * 22 + depth * 30 + traffic * 26 + health * 18 + Math.min(d.visible_hazards.length, 3) * 1.5,
    ),
  );

  const priority = score >= 75 ? "critical" : score >= 50 ? "high" : score >= 28 ? "medium" : "low";
  return { score, priority };
}

export const CONFIDENCE_THRESHOLD = 0.6;

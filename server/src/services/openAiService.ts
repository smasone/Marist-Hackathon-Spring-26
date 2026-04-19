/**
 * Optional OpenAI helper: rephrases already-grounded parking answers using
 * structured facts only (backend remains the source of truth).
 */

import { env } from "../config/env";

/** Intents that use DB-backed facts before any model call. */
export type ParkingAskFormatIntent =
  | "recommendation"
  | "busy_before_nine"
  | "lots_list";

export interface FormatParkingAnswerInput {
  userQuestion: string;
  intent: ParkingAskFormatIntent;
  /** JSON-serializable object built from query results (never raw hallucination). */
  facts: Record<string, unknown>;
}

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

/** Short one-line preview for logs (never log full prompts in production volumes). */
function logPreview(text: string, max = 96): string {
  const s = text.replace(/\s+/g, " ").trim();
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

const SYSTEM_PROMPT = `You are a campus parking assistant. You receive a user question, an intent label, and a JSON object called FACTS from an authoritative database.

Rules:
- Use ONLY information present in FACTS. Do not invent lot names, codes, occupancy values, availability, rules, policies, or predictions.
- If FACTS do not support a detail, do not mention it.
- Reply in one or two short sentences, plain text, no markdown, no bullet lists.
- Be helpful and natural, but never contradict FACTS.`;

/**
 * Asks OpenAI to phrase a short answer from structured backend facts.
 *
 * @returns Trimmed answer text, or null when the API key is missing, the HTTP
 * call fails, or the model returns nothing usable (caller should use a
 * deterministic fallback).
 */
export async function formatParkingAnswer(
  input: FormatParkingAnswerInput
): Promise<string | null> {
  const apiKey = env.openaiApiKey;
  if (!apiKey) {
    console.log("[openai] formatParkingAnswer skipped (no OPENAI_API_KEY)", {
      intent: input.intent,
    });
    return null;
  }

  const body = {
    model: env.openaiModel,
    temperature: 0.2,
    max_tokens: 220,
    messages: [
      { role: "system" as const, content: SYSTEM_PROMPT },
      {
        role: "user" as const,
        content: `Question:\n${input.userQuestion}\n\nIntent:\n${input.intent}\n\nFACTS (authoritative JSON):\n${JSON.stringify(input.facts)}`,
      },
    ],
  };

  const t0 = performance.now();
  console.log("[openai] formatParkingAnswer -> POST /v1/chat/completions", {
    intent: input.intent,
    model: env.openaiModel,
    questionPreview: logPreview(input.userQuestion),
    factsJsonChars: JSON.stringify(input.facts).length,
    requestBodyChars: JSON.stringify(body).length,
  });

  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const raw: unknown = await res.json();
    const ms = Math.round(performance.now() - t0);

    if (!res.ok) {
      const errMsg =
        raw &&
        typeof raw === "object" &&
        "error" in raw &&
        raw.error &&
        typeof raw.error === "object" &&
        "message" in raw.error
          ? String((raw.error as { message?: unknown }).message)
          : res.statusText;
      console.error("[openai] formatParkingAnswer HTTP error", {
        status: res.status,
        ms,
        message: logPreview(errMsg, 200),
      });
      return null;
    }

    const text = extractChatCompletionText(raw);
    if (!text) {
      console.error("[openai] formatParkingAnswer: empty or unexpected response shape", {
        ms,
      });
      return null;
    }
    console.log("[openai] formatParkingAnswer <- ok", {
      intent: input.intent,
      status: res.status,
      ms,
      answerChars: text.length,
    });
    return text;
  } catch (error) {
    console.error("[openai] formatParkingAnswer network/parse error", {
      ms: Math.round(performance.now() - t0),
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function extractChatCompletionText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const first = choices[0];
  if (!first || typeof first !== "object") {
    return null;
  }
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== "object") {
    return null;
  }
  const content = (message as { content?: unknown }).content;
  if (typeof content !== "string") {
    return null;
  }
  const trimmed = content.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const RULES_FAQ_SYSTEM_PROMPT = `You are a campus parking assistant. You receive EXCERPTS copied from Marist University's official public Parking FAQ web page.

Rules:
- Use ONLY information that appears in the EXCERPTS. Do not invent fees, times, policies, lot names, URLs, or shuttle details.
- If the EXCERPTS do not clearly answer the user's question, reply with exactly this sentence and nothing else:
I couldn't verify that from the official parking FAQ.
- Keep the reply to one or two short sentences, plain text, no markdown.`;

export interface FormatParkingRulesFaqAnswerInput {
  userQuestion: string;
  /** Paragraphs taken from the cached official FAQ plain text. */
  faqExcerpts: string[];
  sourceUrl: string;
}

/**
 * Optional natural phrasing for rules answers; excerpts remain authoritative.
 * Returns null when no API key, HTTP failure, or empty model output.
 */
export async function formatParkingRulesFaqAnswer(
  input: FormatParkingRulesFaqAnswerInput
): Promise<string | null> {
  const apiKey = env.openaiApiKey;
  if (!apiKey) {
    console.log("[openai] formatParkingRulesFaqAnswer skipped (no OPENAI_API_KEY)");
    return null;
  }
  if (input.faqExcerpts.length === 0) {
    console.log("[openai] formatParkingRulesFaqAnswer skipped (no excerpts)");
    return null;
  }

  const body = {
    model: env.openaiModel,
    temperature: 0.1,
    max_tokens: 280,
    messages: [
      { role: "system" as const, content: RULES_FAQ_SYSTEM_PROMPT },
      {
        role: "user" as const,
        content: `Official FAQ page (for attribution only; do not invent beyond excerpts): ${input.sourceUrl}\n\nUser question:\n${input.userQuestion}\n\nEXCERPTS (only trusted content):\n${input.faqExcerpts.join("\n\n---\n\n")}`,
      },
    ],
  };

  const excerptChars = input.faqExcerpts.reduce((n, s) => n + s.length, 0);
  const t0 = performance.now();
  console.log("[openai] formatParkingRulesFaqAnswer -> POST /v1/chat/completions", {
    model: env.openaiModel,
    questionPreview: logPreview(input.userQuestion),
    excerptCount: input.faqExcerpts.length,
    excerptChars,
    requestBodyChars: JSON.stringify(body).length,
  });

  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const raw: unknown = await res.json();
    const ms = Math.round(performance.now() - t0);

    if (!res.ok) {
      const errMsg =
        raw &&
        typeof raw === "object" &&
        "error" in raw &&
        raw.error &&
        typeof raw.error === "object" &&
        "message" in raw.error
          ? String((raw.error as { message?: unknown }).message)
          : res.statusText;
      console.error("[openai] formatParkingRulesFaqAnswer HTTP error", {
        status: res.status,
        ms,
        message: logPreview(errMsg, 200),
      });
      return null;
    }

    const text = extractChatCompletionText(raw);
    if (!text) {
      console.error("[openai] formatParkingRulesFaqAnswer: empty or unexpected response shape", {
        ms,
      });
      return null;
    }
    console.log("[openai] formatParkingRulesFaqAnswer <- ok", {
      status: res.status,
      ms,
      answerChars: text.length,
    });
    return text;
  } catch (error) {
    console.error("[openai] formatParkingRulesFaqAnswer network/parse error", {
      ms: Math.round(performance.now() - t0),
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

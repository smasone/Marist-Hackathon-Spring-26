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
      console.error("OpenAI formatParkingAnswer HTTP error:", res.status, errMsg);
      return null;
    }

    const text = extractChatCompletionText(raw);
    if (!text) {
      console.error("OpenAI formatParkingAnswer: empty or unexpected response shape");
      return null;
    }
    return text;
  } catch (error) {
    console.error("OpenAI formatParkingAnswer failed:", error);
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

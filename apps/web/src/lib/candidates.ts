// M3 candidate rules. Pure functions, unit-tested.
import type { Platform } from "@prisma/client";

/**
 * Known-writing thresholds. 1,000 words matches the engine's
 * min_candidate_words default: below it the engine caps the confidence grade.
 * Around 5,000 words is where Delta-based attribution becomes reasonably stable
 * (Eder 2015). Both values need calibration against client data (M9).
 */
export const CORPUS_THRESHOLDS = { minimum: 1000, recommended: 5000 } as const;

export type SufficiencyLevel = "none" | "insufficient" | "limited" | "good";

export type Sufficiency = {
  level: SufficiencyLevel;
  words: number;
  documents: number;
  /** 0-100, progress towards the recommended amount */
  percent: number;
  message: string;
};

const nf = new Intl.NumberFormat("en-GB");

export function corpusSufficiency(words: number, documents: number): Sufficiency {
  const { minimum, recommended } = CORPUS_THRESHOLDS;
  const percent = Math.min(100, Math.round((words / recommended) * 100));
  const base = { words, documents, percent };
  if (words === 0) return { ...base, level: "none", message: "No known writing yet." };
  if (words < minimum) {
    return { ...base, level: "insufficient", message: `${nf.format(minimum - words)} more words needed before analysis.` };
  }
  if (words < recommended) {
    return { ...base, level: "limited", message: `Usable, but results will be less reliable below ${nf.format(recommended)} words.` };
  }
  return { ...base, level: "good", message: "Enough known writing for reliable comparison." };
}

export const SUFFICIENCY_LABEL: Record<SufficiencyLevel, string> = {
  none: "No writing",
  insufficient: "Insufficient",
  limited: "Limited",
  good: "Good",
};

export const SUFFICIENCY_TONE: Record<SufficiencyLevel, "neutral" | "red" | "amber" | "green"> = {
  none: "neutral",
  insufficient: "red",
  limited: "amber",
  good: "green",
};

/** Excel-style letters: 0 -> A, 25 -> Z, 26 -> AA. */
function letters(n: number): string {
  let s = "";
  for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

/** The first free "Candidate X" pseudonym in a case. */
export function nextPseudonym(existing: string[]): string {
  const taken = new Set(existing.map((p) => p.trim().toLowerCase()));
  for (let i = 0; ; i++) {
    const p = `Candidate ${letters(i)}`;
    if (!taken.has(p.toLowerCase())) return p;
  }
}

/** Normalise a social handle for storage and duplicate checks. */
export function normaliseHandle(platform: string, handle: string): string {
  const h = handle.trim();
  if (platform === "EMAIL") return h.toLowerCase();
  if (platform === "PHONE") return h.replace(/[^\d+]/g, "");
  return h.replace(/^@/, "");
}

/** Every platform must have a label (typed against the enum, so a new platform fails to compile). */
export const PLATFORM_LABEL: Record<Platform, string> = {
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  TIKTOK: "TikTok",
  X: "X (Twitter)",
  WHATSAPP: "WhatsApp",
  EMAIL: "E-mail",
  PHONE: "Phone",
  OTHER: "Other",
};

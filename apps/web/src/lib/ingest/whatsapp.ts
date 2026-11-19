// WhatsApp "Export chat" parser (Android and iOS formats).
//   Android: 19/11/2026, 10:15 - Marie: Bonzour
//   iOS:     [19/11/2026, 10:15:22] Marie: Bonzour
// Continuation lines belong to the previous message. System lines (no
// "Name: ") and placeholders (media omitted, deleted messages) are skipped.
import type { Unit } from "./types";

const ANDROID = /^\u200e?(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),?[\s\u202f]+(\d{1,2}):(\d{2})(?::(\d{2}))?[\s\u202f]*([AaPp]\.?[Mm]\.?)?[\s\u202f]+[-\u2013][\s\u202f]+(.*)$/;
const IOS = /^\u200e?\[(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),?[\s\u202f]+(\d{1,2}):(\d{2})(?::(\d{2}))?[\s\u202f]*([AaPp]\.?[Mm]\.?)?\][\s\u202f]+(.*)$/;

const PLACEHOLDERS = [
  /^<media omitted>$/i,
  /^\u200e?(image|video|audio|sticker|gif|document) omitted$/i,
  /^this message was deleted\.?$/i,
  /^you deleted this message\.?$/i,
  /^null$/,
  /^<attached: .*>$/i,
  /^\u200e?location: https?:\/\/\S+$/i,
];
const EDITED = /\s*<this message was edited>$/i;

type Raw = { a: number; b: number; y: number; h: number; m: number; s: number; ampm?: string; rest: string; line: number };

/** True if the text looks like a WhatsApp export (most early lines start with a timestamp). */
export function looksLikeWhatsApp(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim()).slice(0, 30);
  if (lines.length === 0) return false;
  const hits = lines.filter((l) => ANDROID.test(l) || IOS.test(l)).length;
  return hits >= Math.max(1, Math.ceil(lines.length * 0.5));
}

export function parseWhatsApp(text: string, tzOffsetMinutes = 240): { units: Unit[]; skipped: number; dateOrder: "DMY" | "MDY" } {
  const raws: Raw[] = [];
  let skipped = 0;
  text.split("\n").forEach((line, i) => {
    const m = ANDROID.exec(line) ?? IOS.exec(line);
    if (m) {
      raws.push({ a: +m[1], b: +m[2], y: +m[3], h: +m[4], m: +m[5], s: m[6] ? +m[6] : 0, ampm: m[7], rest: m[8], line: i + 1 });
    } else if (raws.length) {
      raws[raws.length - 1].rest += "\n" + line;
    }
  });

  // Day/month order: a first field above 12 proves DMY, a second above 12 proves MDY.
  // Otherwise DMY, as used in Seychelles.
  const dateOrder = raws.some((r) => r.a > 12) ? "DMY" : raws.some((r) => r.b > 12) ? "MDY" : "DMY";

  const units: Unit[] = [];
  for (const r of raws) {
    const sep = r.rest.indexOf(": ");
    if (sep <= 0) {
      skipped++; // system message: "Marie added Jean", encryption notice, etc.
      continue;
    }
    const author = r.rest.slice(0, sep).replace(/^\u200e/, "").trim();
    const body = r.rest.slice(sep + 2).replace(EDITED, "").replace(/\u200e/g, "").trim();
    if (!body || PLACEHOLDERS.some((p) => p.test(body))) {
      skipped++;
      continue;
    }
    const [day, month] = dateOrder === "DMY" ? [r.a, r.b] : [r.b, r.a];
    const year = r.y < 100 ? 2000 + r.y : r.y;
    let hour = r.h;
    const pm = r.ampm?.toLowerCase().startsWith("p");
    if (r.ampm) hour = (hour % 12) + (pm ? 12 : 0);
    const utc = Date.UTC(year, month - 1, day, hour, r.m, r.s) - tzOffsetMinutes * 60_000;
    units.push({ text: body, authorLabel: author, authoredAt: new Date(utc), position: r.line });
  }
  return { units, skipped, dateOrder };
}

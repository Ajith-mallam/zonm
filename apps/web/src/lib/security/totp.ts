// RFC 6238 TOTP (HMAC-SHA1, 30-second steps, 6 digits): the parameters every
// authenticator app supports. Implemented on node:crypto to avoid a dependency.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const STEP_SECONDS = 30;
const DIGITS = 6;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("Invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32-encoded (RFC 4226 recommends 160 bits). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function timeStep(at: Date = new Date()): number {
  return Math.floor(at.getTime() / 1000 / STEP_SECONDS);
}

export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return bin.toString().padStart(digits, "0");
}

export function totp(secretB32: string, at: Date = new Date()): string {
  return hotp(base32Decode(secretB32), timeStep(at));
}

/**
 * Check a code against the current step and one step either side (clock
 * drift). Returns the matched step so the caller can store it and reject any
 * code for that step or an earlier one (replay protection), or null.
 */
export function verifyTotp(
  secretB32: string,
  code: string,
  opts: { at?: Date; lastUsedStep?: number | bigint | null; window?: number } = {},
): number | null {
  const normalised = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalised)) return null;
  const secret = base32Decode(secretB32);
  const now = timeStep(opts.at);
  const window = opts.window ?? 1;
  const last = opts.lastUsedStep == null ? -Infinity : Number(opts.lastUsedStep);
  for (let d = -window; d <= window; d++) {
    const step = now + d;
    if (step <= last) continue;
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, Buffer.from(normalised))) return step;
  }
  return null;
}

export function otpauthUri(secretB32: string, account: string, issuer = "ZONM NET"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret: secretB32, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${params}`;
}

// Password policy, hashing (Argon2id) and lockout rules for M1.
// Policy values are defaults pending the client's security policy.
import { hash, verify } from "@node-rs/argon2";
import { createHash, randomBytes } from "node:crypto";

export const PASSWORD_POLICY = {
  minLength: 12,
  maxLength: 128,
  minCharClasses: 3, // of: lower, upper, digit, symbol
  historyCount: 5, // cannot reuse the last N passwords
  maxAgeDays: 90,
} as const;

export const LOCKOUT_POLICY = {
  maxFailures: 5,
  lockMinutes: 15,
} as const;

// A short deny-list of the most common passwords that otherwise meet the rules.
const COMMON = new Set([
  "password1234", "password123!", "passw0rd1234", "p@ssw0rd1234", "qwerty123456", "qwertyuiop12",
  "123456789abc", "iloveyou1234", "welcome12345", "welcome123!", "admin1234567", "letmein12345",
  "seychelles123", "seychelles2026", "mahe12345678", "victoria1234",
]);

export type PolicyResult = { ok: true } | { ok: false; errors: string[] };

export function checkPasswordPolicy(password: string, ctx: { email?: string; name?: string } = {}): PolicyResult {
  const errors: string[] = [];
  const p = PASSWORD_POLICY;
  if (password.length < p.minLength) errors.push(`Use at least ${p.minLength} characters.`);
  if (password.length > p.maxLength) errors.push(`Use at most ${p.maxLength} characters.`);
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  if (classes < p.minCharClasses) {
    errors.push(`Use at least ${p.minCharClasses} of: lower-case, upper-case, digits, symbols.`);
  }
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) errors.push("This password is too common.");
  const personal = [ctx.email?.split("@")[0], ...(ctx.name?.split(/\s+/) ?? [])]
    .filter((s): s is string => !!s && s.length >= 3)
    .map((s) => s.toLowerCase());
  if (personal.some((s) => lower.includes(s))) errors.push("Do not include your name or e-mail address.");
  if (/(.)\1{3,}/.test(password)) errors.push("Do not repeat a character four or more times.");
  return errors.length ? { ok: false, errors } : { ok: true };
}

// OWASP-recommended Argon2id parameters (19 MiB, 2 iterations, 1 lane).
const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON_OPTS);
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}

/** True if ``password`` matches any of the recent hashes (reuse check). */
export async function isReused(password: string, recentHashes: string[]): Promise<boolean> {
  for (const h of recentHashes.slice(0, PASSWORD_POLICY.historyCount)) {
    if (await verifyPassword(h, password)) return true;
  }
  return false;
}

// A fixed hash to verify against when the e-mail is unknown, so response time
// does not reveal whether an account exists.
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyHash;
}

export type LockoutState = { failedLoginCount: number; lockedUntil: Date | null };

export function isLocked(state: LockoutState, now = new Date()): boolean {
  return !!state.lockedUntil && state.lockedUntil > now;
}

/** The state after a failed attempt: lock once the threshold is reached. */
export function afterFailure(state: LockoutState, now = new Date()): LockoutState {
  const failures = state.failedLoginCount + 1;
  if (failures >= LOCKOUT_POLICY.maxFailures) {
    return { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOCKOUT_POLICY.lockMinutes * 60_000) };
  }
  return { failedLoginCount: failures, lockedUntil: state.lockedUntil };
}

export function isPasswordExpired(changedAt: Date, now = new Date()): boolean {
  return now.getTime() - changedAt.getTime() > PASSWORD_POLICY.maxAgeDays * 86_400_000;
}

/** Ten single-use recovery codes. Store only the SHA-256 (they are high-entropy). */
export function generateRecoveryCodes(n = 10): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: n }, () => {
    const s = randomBytes(8).toString("hex");
    return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12)}`;
  });
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code.trim().toLowerCase().replace(/[\s-]/g, "")).digest("hex");
}

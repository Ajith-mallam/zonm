import { describe, expect, it } from "vitest";
import {
  afterFailure,
  checkPasswordPolicy,
  generateRecoveryCodes,
  hashPassword,
  hashRecoveryCode,
  isLocked,
  isPasswordExpired,
  isReused,
  LOCKOUT_POLICY,
  verifyPassword,
} from "./password";

const who = { email: "jdoe@police.sc", name: "Jane Doe" };

describe("password policy", () => {
  it("accepts a strong password", () => {
    expect(checkPasswordPolicy("Takamaka-Bay-2026", who)).toEqual({ ok: true });
  });

  it.each([
    ["Short1!", /at least 12/],
    ["alllowercaseletters", /at least 3 of/],
    ["Password1234", /too common/],
    ["Jdoe-Secure-2026", /name or e-mail/],
    ["Aaaaa-Secure-2026", /repeat/],
  ])("rejects %s", (pw, msg) => {
    const r = checkPasswordPolicy(pw, who);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(msg);
  });
});

describe("hashing", () => {
  it("hashes with Argon2id and verifies", async () => {
    const h = await hashPassword("Takamaka-Bay-2026");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, "Takamaka-Bay-2026")).toBe(true);
    expect(await verifyPassword(h, "takamaka-bay-2026")).toBe(false);
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
  });

  it("detects reuse of a recent password", async () => {
    const old = [await hashPassword("Old-Password-2025"), await hashPassword("Older-Password-2024")];
    expect(await isReused("Older-Password-2024", old)).toBe(true);
    expect(await isReused("Brand-New-Pass-2026", old)).toBe(false);
  });
});

describe("lockout", () => {
  it("locks after the maximum number of failures, then unlocks", () => {
    const now = new Date("2026-11-19T10:00:00Z");
    let s: { failedLoginCount: number; lockedUntil: Date | null } = { failedLoginCount: 0, lockedUntil: null };
    for (let i = 0; i < LOCKOUT_POLICY.maxFailures - 1; i++) s = afterFailure(s, now);
    expect(isLocked(s, now)).toBe(false);
    s = afterFailure(s, now);
    expect(isLocked(s, now)).toBe(true);
    expect(isLocked(s, new Date(now.getTime() + LOCKOUT_POLICY.lockMinutes * 60_000 + 1))).toBe(false);
  });

  it("expires passwords after the maximum age", () => {
    const now = new Date("2026-11-19T00:00:00Z");
    expect(isPasswordExpired(new Date("2026-08-01T00:00:00Z"), now)).toBe(true);
    expect(isPasswordExpired(new Date("2026-11-01T00:00:00Z"), now)).toBe(false);
  });
});

describe("recovery codes", () => {
  it("generates unique codes and hashes them regardless of case or separators", () => {
    const { codes, hashes } = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(hashRecoveryCode(codes[0].toUpperCase().replace(/-/g, " "))).toBe(hashes[0]);
  });
});

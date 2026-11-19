import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateTotpSecret, hotp, otpauthUri, totp, verifyTotp } from "./totp";

// RFC 6238 Appendix B test secret (ASCII "12345678901234567890") for SHA-1.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("totp", () => {
  it("matches the RFC 6238 SHA-1 test vectors (last 6 of the 8-digit values)", () => {
    expect(totp(RFC_SECRET, new Date(59_000))).toBe("287082"); // 94287082
    expect(totp(RFC_SECRET, new Date(1111111109_000))).toBe("081804"); // 07081804
    expect(totp(RFC_SECRET, new Date(2000000000_000))).toBe("279037"); // 69279037
  });

  it("matches the RFC 4226 HOTP vectors", () => {
    const key = Buffer.from("12345678901234567890");
    expect([0, 1, 2, 9].map((c) => hotp(key, c))).toEqual(["755224", "287082", "359152", "520489"]);
  });

  it("round-trips base32", () => {
    const buf = Buffer.from([0, 1, 2, 250, 255, 7, 8]);
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
    expect(base32Decode(generateTotpSecret())).toHaveLength(20);
  });

  it("accepts the current and adjacent steps, rejects further drift", () => {
    const at = new Date(1_700_000_000_000);
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, totp(secret, at), { at })).not.toBeNull();
    expect(verifyTotp(secret, totp(secret, new Date(at.getTime() - 30_000)), { at })).not.toBeNull();
    expect(verifyTotp(secret, totp(secret, new Date(at.getTime() - 90_000)), { at })).toBeNull();
  });

  it("rejects a replayed code", () => {
    const at = new Date(1_700_000_000_000);
    const secret = generateTotpSecret();
    const code = totp(secret, at);
    const step = verifyTotp(secret, code, { at });
    expect(step).not.toBeNull();
    expect(verifyTotp(secret, code, { at, lastUsedStep: step })).toBeNull();
  });

  it("rejects malformed codes", () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, "12345")).toBeNull();
    expect(verifyTotp(secret, "abcdef")).toBeNull();
  });

  it("builds an otpauth URI", () => {
    expect(otpauthUri("ABC", "a@b.sc")).toBe(
      "otpauth://totp/ZONM%20NET%3Aa%40b.sc?secret=ABC&issuer=ZONM+NET&algorithm=SHA1&digits=6&period=30",
    );
  });
});

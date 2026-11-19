import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto";

const key = randomBytes(32);

describe("secret encryption", () => {
  it("round-trips", () => {
    const sealed = encryptSecret("JBSWY3DPEHPK3PXP", "user-1", key);
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(decryptSecret(sealed, "user-1", key)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("uses a fresh IV each time", () => {
    expect(encryptSecret("x", "u", key)).not.toBe(encryptSecret("x", "u", key));
  });

  it("fails for another user's row (AAD binding)", () => {
    expect(() => decryptSecret(encryptSecret("s", "user-1", key), "user-2", key)).toThrow();
  });

  it("fails on tampering or the wrong key", () => {
    const [v, iv, tag, ct] = encryptSecret("secret", "u", key).split(".");
    const flipped = Buffer.from(ct, "base64url");
    flipped[0] ^= 1;
    expect(() => decryptSecret([v, iv, tag, flipped.toString("base64url")].join("."), "u", key)).toThrow();
    expect(() => decryptSecret([v, iv, tag, ct].join("."), "u", randomBytes(32))).toThrow();
  });

  it("validates the configured key", () => {
    const prev = process.env.MFA_ENCRYPTION_KEY;
    process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(16).toString("base64");
    try {
      expect(() => encryptSecret("x", "u")).toThrow(/32 bytes/);
    } finally {
      process.env.MFA_ENCRYPTION_KEY = prev;
    }
  });
});

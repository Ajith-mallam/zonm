import { describe, expect, it } from "vitest";
import { requestContextFrom, trustedProxyHops } from "./request-context";

const h = (xff?: string) => new Headers({ ...(xff !== undefined && { "x-forwarded-for": xff }), "user-agent": "test-agent" });

describe("client IP for audit records", () => {
  it("ignores forwarding headers when no proxy is trusted", () => {
    expect(requestContextFrom(h("10.0.0.5"), 0)).toEqual({ ip: null, userAgent: "test-agent" });
  });

  it("behind one proxy, takes the address the proxy appended, not the client's forgery", () => {
    // Client sent "X-Forwarded-For: 10.0.0.5"; Nginx appended the real address.
    expect(requestContextFrom(h("10.0.0.5, 203.0.113.7"), 1).ip).toBe("203.0.113.7");
    expect(requestContextFrom(h("203.0.113.7"), 1).ip).toBe("203.0.113.7");
  });

  it("behind two proxies, takes the second entry from the right", () => {
    expect(requestContextFrom(h("10.0.0.5, 203.0.113.7, 172.16.0.2"), 2).ip).toBe("203.0.113.7");
  });

  it("returns no IP when the chain is shorter than the proxies or not an address", () => {
    expect(requestContextFrom(h(""), 1).ip).toBeNull();
    expect(requestContextFrom(h("evil<script>"), 1).ip).toBeNull();
  });

  it("reads the hop count safely", () => {
    expect(trustedProxyHops("1")).toBe(1);
    expect(trustedProxyHops(undefined)).toBe(0);
    expect(trustedProxyHops("abc")).toBe(0);
    expect(trustedProxyHops("99")).toBe(0);
  });
});

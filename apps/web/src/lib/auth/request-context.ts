export type RequestContext = { ip: string | null; userAgent: string | null };

/**
 * Number of reverse proxies in front of the app that append to
 * X-Forwarded-For (Nginx with $proxy_add_x_forwarded_for = 1). 0 means no
 * trusted proxy: forwarding headers are then ignored, because the client can
 * write anything into them.
 */
export function trustedProxyHops(raw = process.env.TRUSTED_PROXY_HOPS): number {
  const n = Number(raw ?? 0);
  return Number.isInteger(n) && n >= 0 && n <= 5 ? n : 0;
}

/**
 * Client IP and user agent for audit records. Each trusted proxy appends the
 * address it saw to X-Forwarded-For, so with N trusted proxies the client is
 * the N-th entry from the right. Entries further left were written by the
 * client and are never trusted.
 */
export function requestContextFrom(h: Headers, hops = trustedProxyHops()): RequestContext {
  let ip: string | null = null;
  if (hops > 0) {
    const chain = (h.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const candidate = chain.length >= hops ? chain[chain.length - hops] : null;
    ip = candidate && /^[0-9a-fA-F:.]{2,45}$/.test(candidate) ? candidate : null;
  }
  return { ip, userAgent: h.get("user-agent")?.slice(0, 500) ?? null };
}

/** For server components and server actions. */
export async function currentRequestContext(): Promise<RequestContext> {
  const { headers } = await import("next/headers");
  return requestContextFrom(await headers());
}

export type RequestContext = { ip: string | null; userAgent: string | null };

/** Client IP and user agent for audit records. Behind Nginx, X-Forwarded-For
 * is set by the proxy; take the first (client) address. */
export function requestContextFrom(h: Headers): RequestContext {
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ip: fwd || h.get("x-real-ip") || null,
    userAgent: h.get("user-agent")?.slice(0, 500) ?? null,
  };
}

/** For server components and server actions. */
export async function currentRequestContext(): Promise<RequestContext> {
  const { headers } = await import("next/headers");
  return requestContextFrom(await headers());
}

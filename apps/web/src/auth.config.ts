// Edge-safe Auth.js configuration, shared by middleware and the full config in
// auth.ts. No database access here: middleware only checks that a token
// exists. The server-side session checks are in lib/auth/session.ts.
import type { NextAuthConfig } from "next-auth";
import { SESSION_POLICY } from "@/lib/auth/policy";

const PUBLIC_PATHS = ["/login"];

export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: SESSION_POLICY.absoluteHours * 3600 },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const path = request.nextUrl.pathname;
      // API routes authenticate themselves and answer 401/403 as JSON.
      if (path.startsWith("/api/") || PUBLIC_PATHS.some((p) => path.startsWith(p))) return true;
      return !!auth?.user;
    },
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.sid = user.sessionId;
      }
      return token;
    },
    session({ session, token }) {
      session.sid = token.sid;
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
} satisfies NextAuthConfig;

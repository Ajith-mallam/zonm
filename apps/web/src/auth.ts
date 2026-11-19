import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { authenticate } from "./lib/auth/login";
import { requestContextFrom } from "./lib/auth/request-context";

const credentialsSchema = z.object({
  email: z.string().trim().min(3).max(320),
  password: z.string().min(1).max(256),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const user = await authenticate(parsed.data.email, parsed.data.password, requestContextFrom(request.headers));
        return user ? { id: user.id, email: user.email, name: user.name, sessionId: user.sessionId } : null;
      },
    }),
  ],
});

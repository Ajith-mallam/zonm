import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// Redirects requests without a token to /login. Session validity, MFA and
// permissions are checked server-side in every page and action.
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};

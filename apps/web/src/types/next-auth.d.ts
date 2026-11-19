import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface User {
    sessionId?: string;
  }
  interface Session {
    sid?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    sid?: string;
  }
}

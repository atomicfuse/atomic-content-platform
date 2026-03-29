import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import type { NextAuthConfig } from "next-auth";

const ALLOWED_DOMAIN = "atomiclabs.io";

export const authConfig: NextAuthConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    signIn({ profile }): boolean {
      const email = profile?.email;
      if (!email) return false;
      return email.endsWith(`@${ALLOWED_DOMAIN}`);
    },
    session({ session }): typeof session {
      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

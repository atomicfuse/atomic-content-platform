export { auth as middleware } from "@/lib/auth";

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - api/auth (NextAuth routes)
     * - _next (Next.js internals)
     * - static files (favicon, images, etc.)
     */
    "/((?!api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};

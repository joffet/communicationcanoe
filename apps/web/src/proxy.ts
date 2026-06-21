import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export async function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  const { pathname } = request.nextUrl;

  const isProtected =
    pathname.startsWith("/inbox") || pathname.startsWith("/settings");

  // Only gate protected routes on cookie presence. Auth pages validate the
  // session server-side so stale cookies don't cause a redirect loop.
  if (!sessionCookie && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/inbox/:path*", "/settings/:path*"],
};

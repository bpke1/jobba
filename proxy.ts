import { NextResponse, type NextRequest } from "next/server";
import { isValidSession, SESSION_COOKIE } from "@/lib/session";

// Single-user app: everything except the login page and the cron endpoints
// (which check CRON_SECRET themselves) needs the session cookie.
export async function proxy(req: NextRequest) {
  const loggedIn = await isValidSession(req.cookies.get(SESSION_COOKIE)?.value);
  const onLogin = req.nextUrl.pathname === "/login";

  if (!loggedIn && !onLogin) {
    const url = new URL("/login", req.nextUrl.origin);
    if (req.nextUrl.pathname !== "/") url.searchParams.set("neste", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  if (loggedIn && onLogin) return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/cron|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { REFRESH_COOKIE, clearSessionCookies, refreshSession, safeReturnPath, setSessionCookies } from "../../../lib/auth/session";

export async function GET(request: NextRequest) {
  const returnTo = safeReturnPath(request.nextUrl.searchParams.get("return_to"));
  const token = (await cookies()).get(REFRESH_COOKIE)?.value;
  if (token) {
    try {
      const response = NextResponse.redirect(new URL(returnTo, request.url));
      setSessionCookies(response, await refreshSession(token));
      return response;
    } catch { /* clear the unusable session below */ }
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("return_to", returnTo);
  const response = NextResponse.redirect(login);
  clearSessionCookies(response);
  return response;
}

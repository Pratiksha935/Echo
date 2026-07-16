import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { OAUTH_STATE_COOKIE, PKCE_COOKIE, RETURN_TO_COOKIE, exchangePkceCode, safeReturnPath, setSessionCookies } from "../../../lib/auth/session";
import { isFounderAccessEmail } from "../../../lib/auth/config";

export async function GET(request: NextRequest) {
  const store = await cookies();
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const verifier = store.get(PKCE_COOKIE)?.value;
  const expectedState = store.get(OAUTH_STATE_COOKIE)?.value;
  const returnTo = safeReturnPath(store.get(RETURN_TO_COOKIE)?.value);

  if (!code || !verifier || !state || state !== expectedState) return failure(request, returnTo);
  try {
    const session = await exchangePkceCode(code, verifier);
    if (!isFounderAccessEmail(session.user?.email)) return failure(request, returnTo, "access_denied");
    const response = NextResponse.redirect(new URL(returnTo, request.url));
    setSessionCookies(response, session);
    for (const name of [PKCE_COOKIE, OAUTH_STATE_COOKIE, RETURN_TO_COOKIE]) {
      response.cookies.set(name, "", { httpOnly: true, maxAge: 0, path: "/", sameSite: "lax" });
    }
    return response;
  } catch {
    return failure(request, returnTo);
  }
}

function failure(request: NextRequest, returnTo: string, error = "oauth_failed") {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", error);
  url.searchParams.set("return_to", returnTo);
  return NextResponse.redirect(url);
}

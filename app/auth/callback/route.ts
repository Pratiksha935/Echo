import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { PKCE_COOKIE, RETURN_TO_COOKIE, exchangePkceCode, safeReturnPath, setSessionCookies } from "../../../lib/auth/session";
import { publicRequestOrigin } from "../../../lib/auth/origin";

export async function GET(request: NextRequest) {
  const store = await cookies();
  const code = request.nextUrl.searchParams.get("code");
  const verifier = store.get(PKCE_COOKIE)?.value;
  const returnTo = safeReturnPath(store.get(RETURN_TO_COOKIE)?.value);

  if (!code || !verifier) return failure(request, returnTo);
  try {
    const session = await exchangePkceCode(code, verifier);
    const response = NextResponse.redirect(new URL(returnTo, publicRequestOrigin(request)));
    setSessionCookies(response, session);
    for (const name of [PKCE_COOKIE, RETURN_TO_COOKIE]) {
      response.cookies.set(name, "", { httpOnly: true, maxAge: 0, path: "/", sameSite: "lax" });
    }
    return response;
  } catch {
    return failure(request, returnTo);
  }
}

function failure(request: NextRequest, returnTo: string, error = "oauth_failed") {
  const url = new URL("/login", publicRequestOrigin(request));
  url.searchParams.set("error", error);
  url.searchParams.set("return_to", returnTo);
  return NextResponse.redirect(url);
}

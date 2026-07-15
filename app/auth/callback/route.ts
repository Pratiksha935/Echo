import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { OAUTH_STATE_COOKIE, PKCE_COOKIE, RETURN_TO_COOKIE, exchangePkceCode, safeReturnPath, setSessionCookies } from "../../../lib/auth/session";

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
    await setSessionCookies(session);
    store.delete(PKCE_COOKIE);
    store.delete(OAUTH_STATE_COOKIE);
    store.delete(RETURN_TO_COOKIE);
    return NextResponse.redirect(new URL(returnTo, request.url));
  } catch {
    return failure(request, returnTo);
  }
}

function failure(request: NextRequest, returnTo: string) {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", "oauth_failed");
  url.searchParams.set("return_to", returnTo);
  return NextResponse.redirect(url);
}


import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { requireSupabasePublicConfig } from "../../../lib/auth/config";
import { PKCE_COOKIE, RETURN_TO_COOKIE, randomBase64Url, safeReturnPath, sha256Base64Url } from "../../../lib/auth/session";

export async function GET(request: NextRequest) {
  const config = requireSupabasePublicConfig();
  const verifier = randomBase64Url(48);
  const challenge = await sha256Base64Url(verifier);
  const returnTo = safeReturnPath(request.nextUrl.searchParams.get("return_to"));
  const store = await cookies();
  const cookieOptions = { httpOnly: true, maxAge: 600, path: "/", sameSite: "lax" as const, secure: process.env.NODE_ENV === "production" };
  store.set(PKCE_COOKIE, verifier, cookieOptions);
  store.set(RETURN_TO_COOKIE, returnTo, cookieOptions);

  const redirectTo = new URL("/auth/callback", request.url).toString();
  const url = new URL(`${config.url}/auth/v1/authorize`);
  url.searchParams.set("provider", "google");
  url.searchParams.set("redirect_to", redirectTo);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "s256");
  return NextResponse.redirect(url);
}

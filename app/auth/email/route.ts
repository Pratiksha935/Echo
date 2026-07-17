import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { requireSupabasePublicConfig } from "../../../lib/auth/config";
import { OAUTH_STATE_COOKIE, PKCE_COOKIE, RETURN_TO_COOKIE, randomBase64Url, safeReturnPath, sha256Base64Url } from "../../../lib/auth/session";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const returnTo = safeReturnPath(String(form.get("return_to") ?? ""));
  if (!sameOrigin(request) || !/^\S+@\S+\.\S+$/.test(email)) return loginRedirect(request, "email_failed", returnTo);
  const config = requireSupabasePublicConfig();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? request.nextUrl.origin;
  const verifier = randomBase64Url(48);
  const state = randomBase64Url(24);
  const challenge = await sha256Base64Url(verifier);
  const callback = new URL("/auth/callback", appUrl);
  callback.searchParams.set("state", state);
  const otpUrl = new URL(`${config.url}/auth/v1/otp`);
  otpUrl.searchParams.set("redirect_to", callback.toString());
  const response = await fetch(otpUrl, {
    body: JSON.stringify({ email, create_user: true, code_challenge: challenge, code_challenge_method: "s256" }),
    cache: "no-store",
    headers: { apikey: config.anonKey, "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) return loginRedirect(request, "email_failed", returnTo);

  const store = await cookies();
  const cookieOptions = { httpOnly: true, maxAge: 600, path: "/", sameSite: "lax" as const, secure: process.env.NODE_ENV === "production" };
  store.set(PKCE_COOKIE, verifier, cookieOptions);
  store.set(OAUTH_STATE_COOKIE, state, cookieOptions);
  store.set(RETURN_TO_COOKIE, returnTo, cookieOptions);

  const url = new URL("/login", request.url);
  url.searchParams.set("sent", "true");
  url.searchParams.set("email", email);
  url.searchParams.set("return_to", returnTo);
  return NextResponse.redirect(url, 303);
}

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === request.nextUrl.origin);
}

function loginRedirect(request: NextRequest, error: string, returnTo: string) {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", error);
  url.searchParams.set("return_to", returnTo);
  return NextResponse.redirect(url, 303);
}

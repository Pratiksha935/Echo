import { NextRequest, NextResponse } from "next/server";
import { requireSupabasePublicConfig } from "../../../lib/auth/config";
import { safeReturnPath } from "../../../lib/auth/session";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const returnTo = safeReturnPath(String(form.get("return_to") ?? ""));
  if (!/^\S+@\S+\.\S+$/.test(email)) return loginRedirect(request, "email_failed", returnTo);
  const config = requireSupabasePublicConfig();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? request.nextUrl.origin;
  const callback = new URL("/auth/magic", appUrl);
  callback.searchParams.set("return_to", returnTo);
  const otpUrl = new URL(`${config.url}/auth/v1/otp`);
  otpUrl.searchParams.set("redirect_to", callback.toString());
  const response = await fetch(otpUrl, {
    body: JSON.stringify({ email, create_user: true }),
    cache: "no-store",
    headers: { apikey: config.anonKey, "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) return loginRedirect(request, "email_failed", returnTo);

  const url = new URL("/login", request.url);
  url.searchParams.set("sent", "true");
  url.searchParams.set("email", email);
  url.searchParams.set("return_to", returnTo);
  return NextResponse.redirect(url, 303);
}

function loginRedirect(request: NextRequest, error: string, returnTo: string) {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", error);
  url.searchParams.set("return_to", returnTo);
  return NextResponse.redirect(url, 303);
}

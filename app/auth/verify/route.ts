import { NextRequest, NextResponse } from "next/server";
import { exchangeOtp, safeReturnPath, setSessionCookies } from "../../../lib/auth/session";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const token = String(form.get("token") ?? "").trim();
  const returnTo = safeReturnPath(String(form.get("return_to") ?? ""));
  try {
    const session = await exchangeOtp(email, token);
    await setSessionCookies(session);
    return NextResponse.redirect(new URL(returnTo, request.url), 303);
  } catch {
    const url = new URL("/login", request.url);
    url.searchParams.set("step", "verify");
    url.searchParams.set("email", email);
    url.searchParams.set("return_to", returnTo);
    url.searchParams.set("error", "invalid_code");
    return NextResponse.redirect(url, 303);
  }
}


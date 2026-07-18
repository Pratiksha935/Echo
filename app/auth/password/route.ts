import { NextRequest, NextResponse } from "next/server";
import { safeReturnPath, setSessionCookies, signInWithPassword } from "../../../lib/auth/session";
import { hasSamePublicOrigin, publicRequestOrigin } from "../../../lib/auth/origin";

const INVALID_CREDENTIALS = "invalid_credentials";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const returnTo = safeReturnPath(String(form.get("return_to") ?? ""), "/workspace");

  if (!hasSamePublicOrigin(request) || !validCredentials(email, password)) {
    return loginRedirect(request, returnTo);
  }

  try {
    const session = await signInWithPassword(email, password);
    const response = NextResponse.redirect(new URL(returnTo, publicRequestOrigin(request)), 303);
    setSessionCookies(response, session);
    return response;
  } catch {
    return loginRedirect(request, returnTo);
  }
}

function validCredentials(email: string, password: string): boolean {
  return /^\S+@\S+\.\S+$/.test(email) && email.length <= 254 && password.length > 0 && password.length <= 1024;
}

function loginRedirect(request: NextRequest, returnTo: string) {
  const url = new URL("/login", publicRequestOrigin(request));
  url.searchParams.set("error", INVALID_CREDENTIALS);
  url.searchParams.set("return_to", returnTo);
  return NextResponse.redirect(url, 303);
}

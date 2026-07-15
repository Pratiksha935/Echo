import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { safeReturnPath, setDemoAccessCookie } from "../../../lib/auth/session";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const submittedCode = String(form.get("code") ?? "").trim();
  const returnTo = safeReturnPath(String(form.get("return_to") ?? ""));
  const email = process.env.DEMO_ACCESS_EMAIL?.trim().toLowerCase();
  const configuredCode = process.env.DEMO_ACCESS_CODE?.trim();

  if (!email || !configuredCode || !matchesSecret(submittedCode, configuredCode)) {
    return failure(request, returnTo);
  }

  const response = NextResponse.redirect(new URL(returnTo, appOrigin(request)), 303);
  setDemoAccessCookie(response, email, configuredCode);
  return response;
}

function matchesSecret(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function failure(request: NextRequest, returnTo: string) {
  const url = new URL("/login", appOrigin(request));
  url.searchParams.set("error", "demo_failed");
  url.searchParams.set("return_to", returnTo);
  return NextResponse.redirect(url, 303);
}

function appOrigin(request: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? request.url;
}

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireSupabaseServiceConfig } from "../../../lib/auth/config";
import { safeReturnPath, setSessionCookies, type SupabaseSession } from "../../../lib/auth/session";

type AdminUser = { email?: string; id: string };
type AdminUsersResponse = { users?: AdminUser[] };
type GeneratedLink = { hashed_token?: string; verification_type?: string };

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const submittedCode = String(form.get("code") ?? "");
  const returnTo = safeReturnPath(String(form.get("return_to") ?? ""));
  const email = process.env.DEMO_ACCESS_EMAIL?.trim().toLowerCase();
  const configuredCode = process.env.DEMO_ACCESS_CODE;

  if (!email || !configuredCode || !matchesSecret(submittedCode, configuredCode)) {
    return failure(request, returnTo);
  }

  try {
    const config = requireSupabaseServiceConfig();
    const user = await findDemoUser(config.url, config.serviceRoleKey, email);
    if (!user) throw new Error("Demo user does not exist.");

    const linkResponse = await adminRequest(config.url, config.serviceRoleKey, "/auth/v1/admin/generate_link", {
      method: "POST",
      body: JSON.stringify({ email, type: "magiclink" }),
    });
    const link = (await linkResponse.json()) as GeneratedLink;
    if (!link.hashed_token) throw new Error("Supabase did not return a demo sign-in token.");

    const tokenResponse = await fetch(`${config.url}/auth/v1/verify`, {
      method: "POST",
      cache: "no-store",
      headers: { apikey: config.anonKey, "content-type": "application/json" },
      body: JSON.stringify({ token: link.hashed_token, type: link.verification_type ?? "magiclink" }),
    });
    if (!tokenResponse.ok) throw new Error(`Demo session could not be created (${tokenResponse.status}).`);

    const response = NextResponse.redirect(new URL(returnTo, appOrigin(request)), 303);
    setSessionCookies(response, (await tokenResponse.json()) as SupabaseSession);
    return response;
  } catch (error) {
    console.error("[demo-auth]", error instanceof Error ? error.message : "Unknown authentication failure.");
    return failure(request, returnTo);
  }
}

async function findDemoUser(url: string, serviceRoleKey: string, email: string): Promise<AdminUser | null> {
  const response = await adminRequest(url, serviceRoleKey, "/auth/v1/admin/users?page=1&per_page=100", { method: "GET" });
  const payload = (await response.json()) as AdminUsersResponse;
  return payload.users?.find(user => user.email?.toLowerCase() === email) ?? null;
}

async function adminRequest(url: string, serviceRoleKey: string, path: string, init: RequestInit): Promise<Response> {
  const response = await fetch(`${url}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
    },
  });
  if (!response.ok) throw new Error(`Supabase admin request failed (${response.status}).`);
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

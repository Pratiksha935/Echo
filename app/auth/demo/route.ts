import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireSupabaseServiceConfig } from "../../../lib/auth/config";
import { safeReturnPath, setSessionCookies, type SupabaseSession } from "../../../lib/auth/session";
import { seedDemoWorkspace } from "../../../lib/demo/workspace-seed";

type AdminUser = { email?: string; id: string };
type AdminUsersResponse = { users?: AdminUser[] };

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

    await seedDemoWorkspace(config, user.id);

    await adminRequest(config.url, config.serviceRoleKey, `/auth/v1/admin/users/${user.id}`, {
      method: "PUT",
      body: JSON.stringify({ password: configuredCode }),
    });

    const tokenResponse = await fetch(`${config.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      cache: "no-store",
      headers: { apikey: config.anonKey, "content-type": "application/json" },
      body: JSON.stringify({ email, password: configuredCode }),
    });
    if (!tokenResponse.ok) throw new Error("Demo session could not be created.");

    const response = NextResponse.redirect(new URL(returnTo, request.url), 303);
    setSessionCookies(response, (await tokenResponse.json()) as SupabaseSession);
    return response;
  } catch {
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
  if (!response.ok) throw new Error("Supabase admin request failed.");
  return response;
}

function matchesSecret(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function failure(request: NextRequest, returnTo: string) {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", "demo_failed");
  url.searchParams.set("return_to", returnTo);
  return NextResponse.redirect(url, 303);
}

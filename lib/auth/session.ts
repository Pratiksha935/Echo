import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { getSupabasePublicConfig, requireSupabasePublicConfig } from "./config";

export const ACCESS_COOKIE = "found_access_token";
export const REFRESH_COOKIE = "found_refresh_token";
export const PKCE_COOKIE = "found_pkce_verifier";
export const OAUTH_STATE_COOKIE = "found_oauth_state";
export const RETURN_TO_COOKIE = "found_return_to";

export type FoundUser = {
  displayName: string;
  email: string;
  fullName: string | null;
  id: string;
};

export type SupabaseAuthContext = {
  accessToken: string;
  user: FoundUser;
};

export type SupabaseSession = {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  user?: SupabaseUser;
};

type SupabaseUser = {
  email?: string;
  id: string;
  user_metadata?: { full_name?: string; name?: string };
};

export async function getSupabaseUser(): Promise<FoundUser | null> {
  return (await getSupabaseAuthContext())?.user ?? null;
}

export async function getSupabaseAuthContext(): Promise<SupabaseAuthContext | null> {
  const config = getSupabasePublicConfig();
  if (!config) return null;

  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return null;

  const response = await fetch(`${config.url}/auth/v1/user`, {
    cache: "no-store",
    headers: { apikey: config.anonKey, authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;

  const user = normaliseUser((await response.json()) as SupabaseUser);
  return user ? { accessToken: token, user } : null;
}

export async function hasRefreshToken(): Promise<boolean> {
  return Boolean((await cookies()).get(REFRESH_COOKIE)?.value);
}

export function setSessionCookies(response: NextResponse, session: SupabaseSession): void {
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set(ACCESS_COOKIE, session.access_token, {
    httpOnly: true,
    maxAge: Math.max(60, session.expires_in - 30),
    path: "/",
    sameSite: "lax",
    secure,
  });
  response.cookies.set(REFRESH_COOKIE, session.refresh_token, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
    sameSite: "lax",
    secure,
  });
}

export function clearSessionCookies(response: NextResponse): void {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, PKCE_COOKIE, OAUTH_STATE_COOKIE, RETURN_TO_COOKIE]) {
    response.cookies.set(name, "", { httpOnly: true, maxAge: 0, path: "/", sameSite: "lax" });
  }
}

export async function exchangeOtp(email: string, token: string): Promise<SupabaseSession> {
  return authRequest("/auth/v1/verify", { email, token, type: "email" });
}

export async function exchangePkceCode(code: string, verifier: string): Promise<SupabaseSession> {
  return authRequest("/auth/v1/token?grant_type=pkce", { auth_code: code, code_verifier: verifier });
}

export async function refreshSession(refreshToken: string): Promise<SupabaseSession> {
  return authRequest("/auth/v1/token?grant_type=refresh_token", { refresh_token: refreshToken });
}

async function authRequest(path: string, body: Record<string, string>): Promise<SupabaseSession> {
  const config = requireSupabasePublicConfig();
  const response = await fetch(`${config.url}${path}`, {
    body: JSON.stringify(body),
    cache: "no-store",
    headers: { apikey: config.anonKey, "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { msg?: string; message?: string } | null;
    throw new Error(error?.msg ?? error?.message ?? "Authentication failed.");
  }
  return (await response.json()) as SupabaseSession;
}

function normaliseUser(user: SupabaseUser): FoundUser | null {
  if (!user.email) return null;
  const fullName = user.user_metadata?.full_name ?? user.user_metadata?.name ?? null;
  return { displayName: fullName ?? user.email, email: user.email, fullName, id: user.id };
}

export function safeReturnPath(value: string | null | undefined, fallback = "/workspace"): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const url = new URL(value, "https://found.local");
    return url.origin === "https://found.local" ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}

export function randomBase64Url(bytes = 32): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Buffer.from(values).toString("base64url");
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(digest).toString("base64url");
}

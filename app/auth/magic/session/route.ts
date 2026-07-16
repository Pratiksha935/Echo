import { NextRequest, NextResponse } from "next/server";
import { requireSupabasePublicConfig } from "../../../../lib/auth/config";
import { safeReturnPath, setSessionCookies } from "../../../../lib/auth/session";

type MagicSessionRequest = {
  accessToken?: string;
  expiresIn?: string;
  refreshToken?: string;
  returnTo?: string;
};

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error:"invalid_origin" }, { status:403 });
  const body = await request.json().catch(() => null) as MagicSessionRequest | null;
  if (!body?.accessToken || !body.refreshToken) return NextResponse.json({ error:"invalid_session" }, { status:400 });

  const config = requireSupabasePublicConfig();
  const userResponse = await fetch(`${config.url}/auth/v1/user`, {
    cache: "no-store",
    headers: { apikey:config.anonKey, authorization:`Bearer ${body.accessToken}` },
  });
  if (!userResponse.ok) return NextResponse.json({ error:"invalid_session" }, { status:401 });

  const response = NextResponse.json({ returnTo:safeReturnPath(body.returnTo, "/integrations") });
  setSessionCookies(response, {
    access_token: body.accessToken,
    expires_in: normaliseExpiry(body.expiresIn),
    refresh_token: body.refreshToken,
  });
  return response;
}

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === request.nextUrl.origin);
}

function normaliseExpiry(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 60 && parsed <= 86_400 ? parsed : 3600;
}

import type { NextRequest } from "next/server";

export function publicRequestOrigin(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;

  const forwardedHost = firstForwardedValue(request.headers.get("x-forwarded-host"));
  const host = forwardedHost ?? request.headers.get("host");
  const forwardedProto = firstForwardedValue(request.headers.get("x-forwarded-proto"));
  const protocol = forwardedProto ?? request.nextUrl.protocol.replace(/:$/, "") ?? "https";

  return host ? protocol + "://" + host : request.nextUrl.origin;
}

export function hasSamePublicOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    return new URL(origin).origin === new URL(publicRequestOrigin(request)).origin;
  } catch {
    return false;
  }
}

function firstForwardedValue(value: string | null): string | null {
  return value?.split(",", 1)[0]?.trim() || null;
}

import type { NextRequest } from "next/server";

export function publicAppOriginFromEnvironment(): string | null {
  // Netlify exposes URL as the stable production site URL. Prefer it over a
  // branch/deploy alias that may have been supplied as NEXT_PUBLIC_APP_URL;
  // OAuth cookies cannot cross between those hostnames.
  for (const candidate of [process.env.URL, process.env.NEXT_PUBLIC_APP_URL]) {
    const origin = normaliseOrigin(candidate);
    if (origin) return origin;
  }
  return null;
}

export function publicRequestOrigin(request: NextRequest): string {
  const configured = publicAppOriginFromEnvironment();
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

function normaliseOrigin(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!/^https?:$/.test(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

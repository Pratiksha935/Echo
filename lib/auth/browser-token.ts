import { createHmac, timingSafeEqual } from "node:crypto";

export type BrowserToken = {
  email: string;
  exp: number;
  iat: number;
  organisationId: string;
  organisationName: string;
  userId: string;
  version: 1;
};

export function issueBrowserToken(input: Omit<BrowserToken, "exp" | "iat" | "version">): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ ...input, exp: now + 60 * 60 * 24 * 30, iat: now, version: 1 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyBrowserToken(value: string): BrowserToken | null {
  const separator = value.lastIndexOf(".");
  if (separator < 1) return null;
  const payload = value.slice(0, separator);
  const actual = Buffer.from(value.slice(separator + 1));
  const expected = Buffer.from(sign(payload));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<BrowserToken>;
    if (!parsed.email || !parsed.organisationId || !parsed.organisationName || !parsed.userId || parsed.version !== 1 || typeof parsed.exp !== "number" || parsed.exp <= Date.now() / 1000) return null;
    return parsed as BrowserToken;
  } catch { return null; }
}

function sign(payload: string): string {
  const secret = process.env.BROWSER_SESSION_SECRET ?? process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!secret) throw new Error("Browser session signing is not configured.");
  return createHmac("sha256", secret).update(`found-browser:${payload}`).digest("base64url");
}

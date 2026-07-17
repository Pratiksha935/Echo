import { NextRequest, NextResponse } from "next/server";
import { getFoundUser } from "../../../auth";
import { getFoundWorkspace } from "../../../../lib/auth/workspace";
import { issueBrowserToken } from "../../../../lib/auth/browser-token";
import { hasSamePublicOrigin } from "../../../../lib/auth/origin";

export async function POST(request: NextRequest) {
  if (!hasSamePublicOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const redirectUri = String((await request.formData()).get("redirect_uri") ?? "");
  if (!/^https:\/\/[a-p]{32}\.chromiumapp\.org\/found\/?$/.test(redirectUri)) return NextResponse.json({ error: "invalid_redirect" }, { status: 400 });
  const user = await getFoundUser();
  const workspace = user ? await getFoundWorkspace() : null;
  if (!user || !workspace) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const profile = { email: user.email, organisationId: workspace.organisationId, organisationName: workspace.organisationName };
  const callback = new URL(redirectUri);
  callback.searchParams.set("token", issueBrowserToken({ ...profile, userId: user.id }));
  callback.searchParams.set("profile", Buffer.from(JSON.stringify(profile)).toString("base64url"));
  return NextResponse.redirect(callback, { headers: { "cache-control": "no-store" } });
}

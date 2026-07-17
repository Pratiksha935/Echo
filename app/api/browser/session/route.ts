import { NextResponse } from "next/server";
import { getFoundUser } from "../../../auth";
import { getFoundWorkspace } from "../../../../lib/auth/workspace";
import { issueBrowserToken } from "../../../../lib/auth/browser-token";

export async function GET() {
  const user = await getFoundUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const workspace = await getFoundWorkspace();
  if (!workspace) return NextResponse.json({ error: "workspace_forbidden" }, { status: 403 });
  const profile = { email: user.email, organisationId: workspace.organisationId, organisationName: workspace.organisationName };
  return NextResponse.json({
    profile,
    token: issueBrowserToken({ ...profile, userId: user.id }),
  }, { headers: { "cache-control": "no-store" } });
}

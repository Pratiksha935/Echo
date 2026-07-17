import { NextResponse } from "next/server";
import { getFoundUser } from "../../../auth";
import { getFoundWorkspace } from "../../../../lib/auth/workspace";
import { issueBrowserToken } from "../../../../lib/auth/browser-token";

export async function GET() {
  const user = await getFoundUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const workspace = await getFoundWorkspace();
  if (!workspace) return NextResponse.json({ error: "workspace_forbidden" }, { status: 403 });
  return NextResponse.json({ token: issueBrowserToken({ organisationId: workspace.organisationId, userId: user.id }) }, { headers: { "cache-control": "no-store" } });
}

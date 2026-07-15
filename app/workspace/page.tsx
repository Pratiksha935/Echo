import { requireFoundUser } from "../auth";
import WorkspaceDashboard from "./workspace-dashboard";
import { getSupabasePublicConfig } from "../../lib/auth/config";
import { getFoundWorkspace, listIntegrationConnections, listWorkspaceKnowledgeRecords } from "../../lib/auth/workspace";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const user = await requireFoundUser("/workspace");
  const demoMode = !getSupabasePublicConfig();
  const workspace = await getFoundWorkspace();
  const [connections, knowledgeRecords] = workspace
    ? await Promise.all([
      listIntegrationConnections(workspace.organisationId),
      listWorkspaceKnowledgeRecords(workspace.organisationId),
    ])
    : [[], []];
  return <WorkspaceDashboard
    connectedCount={connections.filter(item => item.status === "connected").length}
    demoMode={demoMode}
    displayName={user.displayName}
    records={knowledgeRecords}
    workspaceName={workspace?.organisationName ?? "ReLoop demo"}
  />;
}

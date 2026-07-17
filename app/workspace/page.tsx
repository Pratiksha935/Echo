import { requireFoundUser } from "../auth";
import { redirect } from "next/navigation";
import WorkspaceDashboard from "./workspace-dashboard";
import { getDemoMemoryCorrections } from "../../lib/auth/session";
import { getFoundWorkspace, listIntegrationConnections, listMemoryUpdates, listWorkspaceKnowledgeRecords, type MemoryUpdate } from "../../lib/auth/workspace";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const user = await requireFoundUser("/workspace");
  const demoMode = user.id.startsWith("demo:");
  const workspace = demoMode ? null : await getFoundWorkspace();
  const [connections, knowledgeRecords, storedUpdates] = workspace
    ? await Promise.all([
      listIntegrationConnections(workspace.organisationId),
      listWorkspaceKnowledgeRecords(workspace.organisationId),
      listMemoryUpdates(workspace.organisationId).catch(() => []),
    ])
    : [[], [], []];
  if (!demoMode && workspace && !["google", "slack"].every(provider => connections.some(item => item.provider === provider))) {
    redirect("/integrations");
  }
  const demoUpdates: MemoryUpdate[] = demoMode ? (await getDemoMemoryCorrections()).map(item => ({
    actorUserId: user.id,
    createdAt: item.createdAt,
    currentTitle: item.title,
    hermesReview: null,
    origin: "user",
    sourceRecordId: item.recordId,
    sourceUrl: item.sourceUrl,
    updateText: item.correction,
  })) : [];
  return <WorkspaceDashboard
    connectedCount={connections.filter(item => item.status === "connected").length}
    demoMode={demoMode}
    displayName={user.displayName}
    memoryUpdates={demoMode ? demoUpdates : storedUpdates}
    records={knowledgeRecords}
    workspaceName={workspace?.organisationName ?? "ReLoop demo"}
  />;
}

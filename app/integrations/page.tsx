import { requireFoundUser } from "../auth";
import IntegrationSetup from "./integration-setup";
import { getFoundWorkspace, listIntegrationConnections } from "../../lib/auth/workspace";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const user = await requireFoundUser("/integrations");
  const workspace = await getFoundWorkspace();
  const connections = workspace ? await listIntegrationConnections(workspace.organisationId) : [];
  return <IntegrationSetup connections={connections} displayName={user.displayName} workspaceName={workspace?.organisationName ?? "Demo workspace"} />;
}

import { requireFoundUser } from "../auth";
import IntegrationSetup from "./integration-setup";
import { getFoundWorkspace, listIntegrationConnections } from "../../lib/auth/workspace";
import { configuredIntegrationProviders } from "../../lib/integrations/readiness";

export const dynamic = "force-dynamic";

type IntegrationsPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function IntegrationsPage({ searchParams }: IntegrationsPageProps) {
  const params = await searchParams;
  const user = await requireFoundUser("/integrations");
  const workspace = await getFoundWorkspace();
  const connections = workspace ? await listIntegrationConnections(workspace.organisationId) : [];
  return <IntegrationSetup
    connections={connections}
    configuredProviders={configuredIntegrationProviders()}
    displayName={user.displayName}
    workspaceName={workspace?.organisationName ?? "Demo workspace"}
    connectedProvider={single(params.connected)}
    errorCode={single(params.error)}
  />;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

import { requireFoundUser } from "../auth";
import IntegrationSetup from "./integration-setup";
import { getFoundWorkspace, listIntegrationConnections } from "../../lib/auth/workspace";
import { configuredIntegrationProviders, configuredRuntimeReadiness } from "../../lib/integrations/readiness";

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
    runtimeReadiness={configuredRuntimeReadiness()}
    displayName={user.displayName}
    email={user.email}
    extensionInstallUrl={chromeExtensionInstallUrl()}
    workspaceName={workspace?.organisationName ?? "Workspace setup"}
    connectedProvider={single(params.connected)}
    errorCode={single(params.error)}
  />;
}

function chromeExtensionInstallUrl(): string | undefined {
  const configured = process.env.NEXT_PUBLIC_FOUND_EXTENSION_INSTALL_URL;
  if (!configured) return undefined;
  try {
    const url = new URL(configured);
    return url.protocol === "https:" && ["chromewebstore.google.com", "chrome.google.com"].includes(url.hostname)
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

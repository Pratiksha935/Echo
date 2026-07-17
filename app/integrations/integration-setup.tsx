"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { integrationCatalog, type IntegrationDefinition } from "../../lib/integrations/catalog";
import type { IntegrationProvider } from "../../lib/integrations/catalog";
import type { IntegrationConnection } from "../../lib/auth/workspace";

type Props = {
  connectedProvider?: string;
  connections: IntegrationConnection[];
  configuredProviders: IntegrationProvider[];
  displayName: string;
  errorCode?: string;
  workspaceName: string;
};

export default function IntegrationSetup({ connectedProvider, connections, configuredProviders, displayName, errorCode, workspaceName }: Props) {
  const [selected, setSelected] = useState<IntegrationDefinition | null>(null);
  const statusByProvider = useMemo(() => new Map(connections.map(item => [item.provider, item])), [connections]);
  const authorised = connections.length;
  const indexed = connections.filter(item => item.lastSyncedAt).length;
  const attention = connections.filter(item => item.status === "attention").length;
  const googleApproved = statusByProvider.has("google");
  const slackApproved = statusByProvider.has("slack");
  const onboardingComplete = googleApproved && slackApproved;
  const priorityConnectors = integrationCatalog.filter(item => item.provider === "google" || item.provider === "slack");
  const moreConnectors = integrationCatalog.filter(item => item.provider !== "google" && item.provider !== "slack");

  return <main className="integrationsPage">
    <header className="integrationTopbar"><Link href="/">Found.</Link><span>{workspaceName.toUpperCase()} / SETUP</span><b>{displayName}</b></header>
    {(connectedProvider || errorCode) && <div className={`integrationFeedback ${errorCode ? "error" : "success"}`} role="status">
      {errorCode ? integrationError(errorCode) : connectionFeedback(connectedProvider, statusByProvider.get(connectedProvider ?? ""))}
    </div>}
    <section className="integrationHero">
      <div><span>WORKSPACE ONBOARDING / 3 STEPS</span><h1>Approve the work.<br/>Then enter Found.</h1></div>
      <p>First approve Google Workspace, then Slack. Each opens its own OAuth consent screen; Found does not index a source before approval.</p>
    </section>
    <section className="integrationStats"><article><span>WORK EMAIL</span><b>✓</b><p>Invitation verified</p></article><article><span>OAUTH APPROVED</span><b>{authorised}/2</b><p>Google Workspace + Slack</p></article><article><span>INDEXED</span><b>{String(indexed).padStart(2,"0")}</b><p>Completed source syncs</p></article><article><span>NEEDS ATTENTION</span><b>{String(attention).padStart(2,"0")}</b><p>Connection health</p></article></section>
    <section className="connectorSection">
      <div className="connectorHeading"><span>REQUIRED APPROVALS</span><p>Review the requested access, then continue to the provider’s consent screen. Slack unlocks after Google Workspace is approved.</p></div>
      <div className="connectorGrid">{priorityConnectors.map(item => {
        const connection = statusByProvider.get(item.provider);
        const isAuthorised = Boolean(connection);
        const isConfigured = configuredProviders.includes(item.provider);
        const isLocked = item.provider === "slack" && !googleApproved;
        return <article className="connectorCard" key={item.provider} style={{"--connector-accent":item.accent} as React.CSSProperties}>
          <div className="connectorMeta"><span className="connectorMark">{item.shortName}</span><em>{connectionState(connection, isConfigured, isLocked)}</em></div>
          <h2>{item.name}</h2><p>{item.description}</p>
          <ul>{item.ingests.map(value => <li key={value}>{value}</li>)}</ul>
          <footer><span>{connectionDetails(connection, item.syncMode)}</span><button disabled={isLocked} onClick={() => setSelected(item)}>{connection?.lastSyncedAt ? "Indexed ✓" : isAuthorised ? "Review status" : isLocked ? "Approve Google first" : "Review & approve"} ↗</button></footer>
        </article>})}</div>
      {onboardingComplete && <Link className="workspaceEntry" href="/workspace">ENTER WORKSPACE ↗</Link>}
      <div className="connectorHeading moreHeading"><span>MORE INTEGRATIONS</span><p>Optional connectors stay separate from initial onboarding and do not block workspace access.</p></div>
      <div className="connectorGrid moreConnectorGrid">{moreConnectors.map(item => {
        const connection = statusByProvider.get(item.provider);
        const isConfigured = configuredProviders.includes(item.provider);
        return <article className="connectorCard" key={item.provider} style={{"--connector-accent":item.accent} as React.CSSProperties}>
          <div className="connectorMeta"><span className="connectorMark">{item.shortName}</span><em>{connectionState(connection, isConfigured, false)}</em></div>
          <h2>{item.name}</h2><p>{item.description}</p>
          <footer><span>{connectionDetails(connection, item.syncMode)}</span><button onClick={() => setSelected(item)}>{connection?.lastSyncedAt ? "Indexed ✓" : connection ? "Review status" : "Set up"} ↗</button></footer>
        </article>})}</div>
    </section>
    <section className="pipelineStrip"><span>WHAT HAPPENS NEXT</span><p>Authorize → choose scope → backfill → apply permissions → index → retrieve → cite the original source</p></section>
    {selected && <div className="integrationModalBackdrop" role="presentation" onMouseDown={() => setSelected(null)}><section className="integrationModal" role="dialog" aria-modal="true" aria-labelledby="integration-title" onMouseDown={event => event.stopPropagation()}>
      <button className="modalClose" aria-label="Close" onClick={() => setSelected(null)}>×</button><span>{selected.shortName} / CONNECTION REVIEW</span><h2 id="integration-title">{selected.name}</h2><p>{selected.description}</p>
      <div className="modalBlock"><b>SYNC</b><span>{selected.syncMode}</span></div><div className="modalBlock"><b>REQUESTED ACCESS</b><span>{selected.scopes.join(" · ")}</span></div>
      <div className="modalNotice">Continuing opens {selected.name}’s OAuth consent screen. Review the requested scopes there and explicitly approve them. Cancelling grants Found no access and starts no indexing.</div>
      {!statusByProvider.has(selected.provider) && configuredProviders.includes(selected.provider)
        ? <a className="modalAction" href={selected.provider === "slack" ? "/auth/slack" : `/auth/integrations/${selected.provider}`}>CONNECT {selected.name.toUpperCase()} SECURELY ↗</a>
        : <button className="modalAction" disabled>{statusByProvider.has(selected.provider) ? connectionDetails(statusByProvider.get(selected.provider), "") : selected.availability === "planned" ? "PLANNED CONNECTOR" : "ADMIN SETUP REQUIRED"}</button>}
    </section></div>}
  </main>;
}

function providerName(provider?: string): string {
  return integrationCatalog.find(item => item.provider === provider)?.name ?? "The source";
}

function integrationError(code: string): string {
  if (code === "admin_required" || code === "workspace_forbidden") return "Only a workspace owner or admin can connect sources.";
  if (code === "google_required") return "Approve Google Workspace before continuing to Slack.";
  if (code.endsWith("_not_configured")) return `${providerName(code.replace("_not_configured", ""))} needs its OAuth credentials added by the Found administrator.`;
  if (code === "connection_storage_failed") return "Authorisation completed, but the encrypted connection could not be stored. Nothing was indexed.";
  if (code.includes("authorization_failed") || code === "invalid_integration_callback") return "The provider did not complete authorisation. Please try again.";
  return "This connection could not be completed.";
}

function connectionState(connection: IntegrationConnection | undefined, configured: boolean, locked: boolean): string {
  if (locked) return "LOCKED";
  if (!connection) return configured ? "READY FOR CONSENT" : "NOT CONFIGURED";
  if (connection.status === "attention") return "NEEDS ATTENTION";
  return connection.lastSyncedAt ? "INDEXED" : "AUTHORISED · NOT INDEXED";
}

function connectionDetails(connection: IntegrationConnection | undefined, fallback: string): string {
  if (!connection) return fallback;
  if (!connection.lastSyncedAt) return `${connection.externalWorkspaceName ?? "Source approved"} · indexing not started`;
  return `${connection.externalWorkspaceName ?? "Source approved"} · indexed ${new Date(connection.lastSyncedAt).toLocaleString()}`;
}

function connectionFeedback(provider: string | undefined, connection: IntegrationConnection | undefined): string {
  if (!connection) return `${providerName(provider)} did not return a saved authorisation.`;
  return connection.lastSyncedAt
    ? `${providerName(provider)} is authorised and its approved content was indexed.`
    : `${providerName(provider)} is authorised. Indexing has not completed.`;
}

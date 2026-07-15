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
  const connected = connections.filter(item => item.status === "connected").length;
  const attention = connections.filter(item => item.status === "attention").length;
  const ready = configuredProviders.length;

  return <main className="integrationsPage">
    <header className="integrationTopbar"><Link href="/">Found.</Link><span>{workspaceName.toUpperCase()} / SETUP</span><b>{displayName}</b></header>
    {(connectedProvider || errorCode) && <div className={`integrationFeedback ${errorCode ? "error" : "success"}`} role="status">
      {errorCode ? integrationError(errorCode) : `${providerName(connectedProvider)} is connected. Found can now begin its approved backfill.`}
    </div>}
    <section className="integrationHero">
      <div><span>WELCOME / CONNECT YOUR SOURCES</span><h1>Bring the work.<br/>Keep its permissions.</h1></div>
      <p>Choose each source Found may index. Every connection preserves deep links, ownership, and source-level access.</p>
    </section>
    <section className="integrationStats"><article><span>CONNECTED</span><b>{String(connected).padStart(2,"0")}</b><p>Authorised sources</p></article><article><span>READY NOW</span><b>{String(ready).padStart(2,"0")}</b><p>OAuth connectors</p></article><article><span>NEEDS ATTENTION</span><b>{String(attention).padStart(2,"0")}</b><p>{connections.length ? "Connection health" : "No sync started"}</p></article><article><span>ACCESS MODEL</span><b>ACL</b><p>Source permissions preserved</p></article></section>
    <section className="connectorSection">
      <div className="connectorHeading"><span>CHOOSE YOUR SOURCES</span><p>Connect only what your workspace approves. Found requests the smallest useful scope and keeps provider credentials out of the browser.</p></div>
      <div className="connectorGrid">{integrationCatalog.map(item => {
        const connection = statusByProvider.get(item.provider);
        const isConnected = connection?.status === "connected";
        const isConfigured = configuredProviders.includes(item.provider);
        return <article className="connectorCard" key={item.provider} style={{"--connector-accent":item.accent} as React.CSSProperties}>
          <div className="connectorMeta"><span className="connectorMark">{item.shortName}</span><em>{isConnected ? "CONNECTED" : isConfigured ? "READY" : item.availability === "planned" ? "PLANNED" : "NEEDS CONFIG"}</em></div>
          <h2>{item.name}</h2><p>{item.description}</p>
          <ul>{item.ingests.map(value => <li key={value}>{value}</li>)}</ul>
          <footer><span>{connection?.externalWorkspaceName ?? item.syncMode}</span><button onClick={() => setSelected(item)}>{isConnected ? "Manage" : "Set up"} ↗</button></footer>
        </article>})}</div>
    </section>
    <section className="pipelineStrip"><span>WHAT HAPPENS NEXT</span><p>Authorize → choose scope → backfill → apply permissions → index → retrieve → cite the original source</p></section>
    {selected && <div className="integrationModalBackdrop" role="presentation" onMouseDown={() => setSelected(null)}><section className="integrationModal" role="dialog" aria-modal="true" aria-labelledby="integration-title" onMouseDown={event => event.stopPropagation()}>
      <button className="modalClose" aria-label="Close" onClick={() => setSelected(null)}>×</button><span>{selected.shortName} / CONNECTION REVIEW</span><h2 id="integration-title">{selected.name}</h2><p>{selected.description}</p>
      <div className="modalBlock"><b>SYNC</b><span>{selected.syncMode}</span></div><div className="modalBlock"><b>REQUESTED ACCESS</b><span>{selected.scopes.join(" · ")}</span></div>
      <div className="modalNotice">Found never asks you to paste provider secrets into this page. Production connections use server-side OAuth and store only an encrypted credential reference.</div>
      {!statusByProvider.has(selected.provider) && configuredProviders.includes(selected.provider)
        ? <a className="modalAction" href={selected.provider === "slack" ? "/auth/slack" : `/auth/integrations/${selected.provider}`}>CONNECT {selected.name.toUpperCase()} SECURELY ↗</a>
        : <button className="modalAction" disabled>{statusByProvider.has(selected.provider) ? "CONNECTED" : selected.availability === "planned" ? "PLANNED CONNECTOR" : "ADMIN SETUP REQUIRED"}</button>}
    </section></div>}
  </main>;
}

function providerName(provider?: string): string {
  return integrationCatalog.find(item => item.provider === provider)?.name ?? "The source";
}

function integrationError(code: string): string {
  if (code === "admin_required" || code === "workspace_forbidden") return "Only a workspace owner or admin can connect sources.";
  if (code.endsWith("_not_configured")) return `${providerName(code.replace("_not_configured", ""))} needs its OAuth credentials added by the Found administrator.`;
  if (code === "connection_storage_failed") return "Authorisation completed, but the encrypted connection could not be stored. Nothing was indexed.";
  if (code.includes("authorization_failed") || code === "invalid_integration_callback") return "The provider did not complete authorisation. Please try again.";
  return "This connection could not be completed.";
}

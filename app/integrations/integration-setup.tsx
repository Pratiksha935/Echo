"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { integrationCatalog, type IntegrationDefinition } from "../../lib/integrations/catalog";
import type { IntegrationConnection } from "../../lib/auth/workspace";

type Props = { connections: IntegrationConnection[]; displayName: string; workspaceName: string };

export default function IntegrationSetup({ connections, displayName, workspaceName }: Props) {
  const [selected, setSelected] = useState<IntegrationDefinition | null>(null);
  const statusByProvider = useMemo(() => new Map(connections.map(item => [item.provider, item])), [connections]);
  const connected = connections.filter(item => item.status === "connected").length;

  return <main className="integrationsPage">
    <header className="integrationTopbar"><Link href="/">Found.</Link><span>{workspaceName.toUpperCase()} / SETUP</span><b>{displayName}</b></header>
    <section className="integrationHero">
      <div><span>WELCOME / CONNECT YOUR SOURCES</span><h1>Bring the work.<br/>Keep its permissions.</h1></div>
      <p>Choose each source Found may index. Every connection preserves deep links, ownership, and source-level access.</p>
    </section>
    <section className="integrationStats"><article><span>CONNECTED</span><b>{String(connected).padStart(2,"0")}</b><p>Slack workspace</p></article><article><span>NEXT STEP</span><b>04</b><p>Sources available</p></article><article><span>SYNC HEALTH</span><b>100%</b><p>Demo records healthy</p></article><article><span>ACCESS MODEL</span><b>ACL</b><p>Source permissions preserved</p></article></section>
    <section className="connectorSection">
      <div className="connectorHeading"><span>CHOOSE YOUR SOURCES</span><p>Connect only what your workspace approves. Found requests the smallest useful scope and keeps provider credentials out of the browser.</p></div>
      <div className="connectorGrid">{integrationCatalog.map(item => {
        const connection = statusByProvider.get(item.provider);
        const isConnected = connection?.status === "connected";
        return <article className="connectorCard" key={item.provider} style={{"--connector-accent":item.accent} as React.CSSProperties}>
          <div className="connectorMeta"><span className="connectorMark">{item.shortName}</span><em>{isConnected ? "CONNECTED" : item.availability.toUpperCase()}</em></div>
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
      {selected.provider === "slack" && !statusByProvider.has("slack")
        ? <a className="modalAction" href="/auth/slack">CONNECT SLACK SECURELY ↗</a>
        : <button className="modalAction" disabled>{statusByProvider.has(selected.provider) ? "CONNECTED" : "COMING NEXT"}</button>}
    </section></div>}
  </main>;
}

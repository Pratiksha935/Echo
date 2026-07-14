"use client";

import { useMemo, useState } from "react";
import { integrationCatalog, type IntegrationDefinition } from "../../lib/integrations/catalog";

const seededStatus: Record<string, "connected" | "available"> = { slack: "connected" };

export default function IntegrationsPage() {
  const [selected, setSelected] = useState<IntegrationDefinition | null>(null);
  const connected = useMemo(() => integrationCatalog.filter(x => seededStatus[x.provider] === "connected").length, []);

  return <main className="integrationsPage">
    <header className="integrationTopbar"><a href="/">EC / ECHOCHECK</a><span>RELOOP WORKSPACE</span><b>{connected} CONNECTED</b></header>
    <section className="integrationHero">
      <div><span>PLATFORM / INTEGRATIONS</span><h1>Connect the work.<br/>Keep the context.</h1></div>
      <p>Install sources once. EchoCheck continuously indexes permitted knowledge, preserves deep links and gives Hermes evidence it can trust.</p>
    </section>
    <section className="integrationStats"><article><span>CONNECTED</span><b>01</b><p>Slack workspace</p></article><article><span>INDEXED</span><b>18</b><p>Demo records</p></article><article><span>SYNC HEALTH</span><b>100%</b><p>No failed runs</p></article><article><span>ACCESS MODEL</span><b>ACL</b><p>Source permissions preserved</p></article></section>
    <section className="connectorSection">
      <div className="connectorHeading"><span>SOURCE CATALOGUE</span><p>Every connector follows the same install, backfill, webhook, normalize, deep-link and revoke contract.</p></div>
      <div className="connectorGrid">{integrationCatalog.map(item => {
        const isConnected = seededStatus[item.provider] === "connected";
        return <article className="connectorCard" key={item.provider} style={{"--connector-accent":item.accent} as React.CSSProperties}>
          <div className="connectorMeta"><span className="connectorMark">{item.shortName}</span><em>{isConnected ? "LIVE" : item.availability.toUpperCase()}</em></div>
          <h2>{item.name}</h2><p>{item.description}</p>
          <ul>{item.ingests.map(value => <li key={value}>{value}</li>)}</ul>
          <footer><span>{item.syncMode}</span><button onClick={() => setSelected(item)}>{isConnected ? "Manage" : "Configure"} ↗</button></footer>
        </article>})}</div>
    </section>
    <section className="pipelineStrip"><span>INGESTION CONTRACT</span><p>Install → Backfill → Webhook → Normalize → Apply permissions → Index → Retrieve → Cite source</p></section>
    {selected && <div className="integrationModalBackdrop" role="presentation" onMouseDown={() => setSelected(null)}><section className="integrationModal" role="dialog" aria-modal="true" aria-labelledby="integration-title" onMouseDown={e => e.stopPropagation()}>
      <button className="modalClose" aria-label="Close" onClick={() => setSelected(null)}>×</button><span>{selected.shortName} / CONNECTOR SETUP</span><h2 id="integration-title">{selected.name}</h2><p>{selected.description}</p>
      <div className="modalBlock"><b>SYNC</b><span>{selected.syncMode}</span></div><div className="modalBlock"><b>REQUESTED ACCESS</b><span>{selected.scopes.join(" · ")}</span></div>
      <div className="modalNotice">OAuth credentials are not stored in the browser. Production installs exchange authorization codes server-side and keep only an encrypted credential reference.</div>
      <button className="modalAction" disabled={selected.availability === "planned"}>{selected.provider === "slack" ? "CONNECTED TO NEW WORKSPACE" : selected.availability === "planned" ? "PLANNED CONNECTOR" : `START ${selected.name.toUpperCase()} SETUP`}</button>
    </section></div>}
  </main>;
}

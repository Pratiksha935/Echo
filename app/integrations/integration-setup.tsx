"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { IntegrationConnection } from "../../lib/auth/workspace";
import { integrationCatalog, type IntegrationProvider } from "../../lib/integrations/catalog";
import styles from "./onboarding.module.css";

type Props = {
  connectedProvider?: string;
  connections: IntegrationConnection[];
  configuredProviders: IntegrationProvider[];
  displayName: string;
  email: string;
  errorCode?: string;
  extensionInstallUrl?: string;
  workspaceName: string;
};

export default function IntegrationSetup({ connectedProvider, connections, configuredProviders, displayName, email, errorCode, extensionInstallUrl, workspaceName }: Props) {
  const statusByProvider = useMemo(() => new Map(connections.map(item => [item.provider, item])), [connections]);
  const google = statusByProvider.get("google");
  const slack = statusByProvider.get("slack");
  const googleApproved = approved(google);
  const slackApproved = approved(slack);
  const readyForWorkspace = googleApproved && slackApproved;
  const completedRequired = 1 + Number(googleApproved) + Number(slackApproved);

  return <main className={styles.page}>
    <header className={styles.topbar}>
      <Link href="/">Found<span>.</span></Link>
      <span>{workspaceName.toUpperCase()} / ONBOARDING</span>
      <b>{displayName}</b>
    </header>

    {(connectedProvider || errorCode) && <div className={`${styles.feedback} ${errorCode ? styles.feedbackError : styles.feedbackSuccess}`} role="status">
      {errorCode ? integrationError(errorCode) : connectionFeedback(connectedProvider, statusByProvider.get(connectedProvider ?? ""))}
    </div>}

    <section className={styles.hero}>
      <div><span>GUIDED SETUP · {completedRequired}/3 REQUIRED STEPS COMPLETE</span><h1>One Found account.<br/>Explicit source access.</h1></div>
      <p>Sign in once to Found, then review Google Workspace and Slack separately. Installing the browser extension does not grant either source access.</p>
    </section>

    <nav className={styles.progress} aria-label="Onboarding progress">
      <a href="#account" className={styles.done}>01 <span>Account</span></a>
      <a href="#google" className={googleApproved ? styles.done : styles.current}>02 <span>Google</span></a>
      <a href="#slack" className={slackApproved ? styles.done : googleApproved ? styles.current : ""}>03 <span>Slack</span></a>
      <a href="#extension">04 <span>Extension</span></a>
      <a href="#pair">05 <span>Pair</span></a>
      <a href="#dashboard" className={readyForWorkspace ? styles.current : ""}>06 <span>Enter Found</span></a>
    </nav>

    <section className={styles.steps}>
      <Step id="account" number="01" title="Found account" status="SIGNED IN" complete>
        <p>Your Found identity is active for this browser. It is the account used when you pair the extension.</p>
        <dl><div><dt>ACCOUNT</dt><dd>{email}</dd></div><div><dt>WORKSPACE</dt><dd>{workspaceName}</dd></div></dl>
      </Step>

      <Step id="google" number="02" title="Google Workspace" status={providerStatus(google, configuredProviders.includes("google"))} complete={googleApproved}>
        <p>This is a separate Google Workspace consent for read-only Drive and Docs access. Your Google sign-in alone does not approve indexing.</p>
        <ScopeList values={["Drive files · read only", "Google Docs · read only", "Identity · email"]}/>
        {googleApproved ? <Connection connection={google!}/> : configuredProviders.includes("google") ? <Link className={styles.action} href="/auth/integrations/google" prefetch={false}>REVIEW GOOGLE WORKSPACE CONSENT ↗</Link> : <DisabledAction>GOOGLE WORKSPACE ADMIN SETUP REQUIRED</DisabledAction>}
      </Step>

      <Step id="slack" number="03" title="Slack" status={googleApproved ? providerStatus(slack, configuredProviders.includes("slack")) : "WAITING FOR GOOGLE"} complete={slackApproved} locked={!googleApproved}>
        <p>Slack opens its own consent screen after Google. Found requests public-channel ingestion access and does not request permission to post messages.</p>
        <ScopeList values={["Public channels · read", "Public messages · read", "Users · read"]}/>
        {slackApproved ? <Connection connection={slack!}/> : !googleApproved ? <DisabledAction>APPROVE GOOGLE FIRST</DisabledAction> : configuredProviders.includes("slack") ? <Link className={styles.action} href="/auth/slack" prefetch={false}>REVIEW SLACK CONSENT ↗</Link> : <DisabledAction>SLACK ADMIN SETUP REQUIRED</DisabledAction>}
      </Step>

      <Step id="extension" number="04" title="Install the extension" status={extensionInstallUrl ? "STORE LISTING AVAILABLE" : "PRIVATE PREVIEW · NOT VERIFIED"}>
        {extensionInstallUrl ? <><p>Install Found from the configured Chrome Web Store listing. Found cannot verify installation from this page; confirm it in Chrome before pairing.</p><a className={styles.action} href={extensionInstallUrl} target="_blank" rel="noreferrer">OPEN CHROME WEB STORE ↗</a></> : <><p>Download the approved private-release package directly from Found. Remove older Found extensions before loading this version so only one content script runs on each page.</p><a className={styles.action} href="/found-extension-v0.4.8.zip" download>DOWNLOAD FOUND v0.4.8 ↗</a><ol><li>Extract the downloaded ZIP.</li><li>Open <code>chrome://extensions</code> in Chrome and remove older Found versions.</li><li>Turn on <b>Developer mode</b>, choose <b>Load unpacked</b>, and select the extracted folder.</li><li>Pin <b>Found — Organisational Memory</b> from the Extensions menu.</li></ol><div className={styles.pending}>Production store distribution pending · private package installation requires Chrome Developer mode</div></>}
      </Step>

      <Step id="pair" number="05" title="Pair this browser" status="AWAITING EXTENSION CONFIRMATION">
        <p>Open the Found extension from Chrome’s toolbar and choose <b>Connect or switch workspace</b>. On the Found confirmation page, choose <b>Connect browser</b>. Return to the indexed document, open Found again, and choose <b>Check this page</b>.</p>
        <div className={styles.explainer}><b>What pairing does</b><span>Links this browser to {workspaceName}</span><b>What it does not do</b><span>It does not replace or silently approve Google Workspace or Slack consent.</span></div>
        <div className={styles.pending}>Pairing is confirmed inside the extension · this page does not pretend to detect it</div>
      </Step>

      <Step id="dashboard" number="06" title="Enter Found" status={readyForWorkspace ? "READY" : "LOCKED UNTIL SOURCE CONSENT"} complete={readyForWorkspace} locked={!readyForWorkspace}>
        <p>Once both required sources have saved authorisation, enter the dashboard. Indexing state stays visible separately from consent state.</p>
        {readyForWorkspace ? <Link className={styles.action} href="/workspace">ENTER FOUND DASHBOARD ↗</Link> : <DisabledAction>COMPLETE GOOGLE AND SLACK CONSENT</DisabledAction>}
      </Step>
    </section>

    <section className={styles.more}>
      <span>AFTER ONBOARDING</span><h2>Connect more company memory.</h2><p>Notion, Jira Cloud, GitHub, and Read AI remain optional. They never share Google Workspace or Slack consent.</p>
      <div>{integrationCatalog.filter(item => !["google", "slack"].includes(item.provider)).map(item => <article key={item.provider}><b>{item.shortName}</b><h3>{item.name}</h3><span>{item.availability === "planned" ? "PLANNED" : configuredProviders.includes(item.provider) ? "AVAILABLE" : "ADMIN SETUP REQUIRED"}</span></article>)}</div>
    </section>
  </main>;
}

function Step({ children, complete = false, id, locked = false, number, status, title }: { children: React.ReactNode; complete?: boolean; id: string; locked?: boolean; number: string; status: string; title: string }) {
  return <article id={id} className={`${styles.step} ${complete ? styles.stepComplete : ""} ${locked ? styles.stepLocked : ""}`}>
    <header><span>{number}</span><div><small>{status}</small><h2>{title}</h2></div><i aria-label={complete ? "Complete" : status}>{complete ? "✓" : number}</i></header>
    <div className={styles.stepBody}>{children}</div>
  </article>;
}

function ScopeList({ values }: { values: string[] }) { return <ul className={styles.scopes}>{values.map(value => <li key={value}>{value}</li>)}</ul>; }
function DisabledAction({ children }: { children: React.ReactNode }) { return <button className={styles.action} disabled>{children}</button>; }
function Connection({ connection }: { connection: IntegrationConnection }) { return <div className={styles.connection}><b>Authorisation saved</b><span>{connection.externalWorkspaceName ?? "Approved source"}</span><small>{connection.lastSyncedAt ? `Indexed ${new Date(connection.lastSyncedAt).toLocaleString()}` : "Indexing has not completed"}</small></div>; }
function approved(connection?: IntegrationConnection): boolean { return Boolean(connection && connection.status !== "disconnected"); }
function providerStatus(connection: IntegrationConnection | undefined, configured: boolean): string {
  if (!connection) return configured ? "READY FOR CONSENT" : "ADMIN SETUP REQUIRED";
  if (connection.status === "disconnected") return "DISCONNECTED";
  if (connection.status === "attention") return "AUTHORISED · NEEDS ATTENTION";
  return connection.lastSyncedAt ? "AUTHORISED · INDEXED" : "AUTHORISED · INDEXING PENDING";
}
function providerName(provider?: string): string { return integrationCatalog.find(item => item.provider === provider)?.name ?? "The source"; }
function integrationError(code: string): string {
  if (code === "admin_required" || code === "workspace_forbidden") return "Only a workspace owner or admin can connect sources.";
  if (code === "google_required") return "Approve Google Workspace before continuing to Slack.";
  if (code.endsWith("_not_configured")) return `${providerName(code.replace("_not_configured", ""))} needs OAuth credentials added by the Found administrator.`;
  if (code === "connection_storage_failed") return "Authorisation completed, but the encrypted connection could not be stored. Nothing was indexed.";
  if (code.includes("authorization_failed") || code === "invalid_integration_callback") return "The provider did not complete authorisation. Please try again.";
  return "This connection could not be completed.";
}
function connectionFeedback(provider: string | undefined, connection: IntegrationConnection | undefined): string {
  if (!connection) return `${providerName(provider)} did not return a saved authorisation.`;
  return connection.lastSyncedAt ? `${providerName(provider)} is authorised and its approved content was indexed.` : `${providerName(provider)} is authorised. Indexing has not completed.`;
}

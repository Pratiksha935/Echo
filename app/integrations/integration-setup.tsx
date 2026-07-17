"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { integrationCatalog } from "../../lib/integrations/catalog";
import type { IntegrationProvider } from "../../lib/integrations/catalog";
import type { IntegrationConnection } from "../../lib/auth/workspace";

type Props = {
  connectedProvider?: string;
  connections: IntegrationConnection[];
  configuredProviders: IntegrationProvider[];
  displayName: string;
  email: string;
  errorCode?: string;
  workspaceName: string;
};

type StepState = "complete" | "current" | "locked";

const requiredProviders = ["google", "slack"] as const;

export default function IntegrationSetup({ connectedProvider, connections, configuredProviders, displayName, email, errorCode, workspaceName }: Props) {
  const pairingStatus = useRef<HTMLHeadingElement>(null);
  const statusByProvider = useMemo(() => new Map(connections.map(item => [item.provider, item])), [connections]);
  const googleApproved = isApproved(statusByProvider.get("google"));
  const slackApproved = isApproved(statusByProvider.get("slack"));
  const sourcesApproved = googleApproved && slackApproved;
  const [browserPaired, setBrowserPaired] = useState(false);

  useEffect(() => {
    const status = pairingStatus.current;
    if (!status || !sourcesApproved) return;
    const update = () => setBrowserPaired(status.textContent?.trim() === "Browser connected.");
    update();
    const observer = new MutationObserver(update);
    observer.observe(status, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [sourcesApproved]);

  const installComplete = browserPaired;
  const steps: Array<{ detail: string; label: string; state: StepState }> = [
    { label: "Found account", detail: email, state: "complete" },
    { label: "Google Workspace", detail: providerDetail(statusByProvider.get("google")), state: googleApproved ? "complete" : "current" },
    { label: "Slack", detail: providerDetail(statusByProvider.get("slack")), state: slackApproved ? "complete" : googleApproved ? "current" : "locked" },
    { label: "Install extension", detail: installComplete ? "Detected in this browser" : "Chrome extension", state: installComplete ? "complete" : sourcesApproved ? "current" : "locked" },
    { label: "Verify pairing", detail: browserPaired ? `${workspaceName} paired` : "Waiting for extension", state: browserPaired ? "complete" : sourcesApproved ? "current" : "locked" },
    { label: "Enter dashboard", detail: browserPaired ? "Ready" : "Complete pairing first", state: browserPaired ? "current" : "locked" },
  ];

  return <main className="onboardingPage">
    <header className="onboardingTopbar">
      <Link href="/">Found<span>.</span></Link>
      <span>{workspaceName.toUpperCase()} / ONBOARDING</span>
      <div><i aria-hidden="true" />{displayName}</div>
    </header>

    {(connectedProvider || errorCode) && <div className={`onboardingFeedback ${errorCode ? "error" : "success"}`} role="status">
      {errorCode ? integrationError(errorCode) : connectionFeedback(connectedProvider, statusByProvider.get(connectedProvider ?? ""))}
    </div>}

    <div className="onboardingShell">
      <aside className="onboardingProgress" aria-label="Onboarding progress">
        <p>SET UP FOUND</p>
        <h1>Bring your<br/>company memory<br/>online.</h1>
        <ol>{steps.map((step, index) => <li className={step.state} key={step.label}>
          <span>{step.state === "complete" ? "✓" : String(index + 1).padStart(2, "0")}</span>
          <div><b>{step.label}</b><small>{step.detail}</small></div>
        </li>)}</ol>
        <small>Found only accesses sources you explicitly approve. Connection state shown here comes from this workspace.</small>
      </aside>

      <section className="onboardingMain">
        <div className="onboardingIntro">
          <span>AUTHENTICATED SETUP · 6 STEPS</span>
          <h2>{browserPaired ? "Found is ready." : sourcesApproved ? "Pair this browser." : "Connect the places your team works."}</h2>
          <p>Signed in as <b>{email}</b> for <b>{workspaceName}</b>. Approvals stay separate so you can inspect each provider’s requested access before granting consent.</p>
        </div>

        <section className="onboardingAccount" aria-labelledby="account-title">
          <div className="onboardingStepNumber">01</div>
          <div><span>FOUND ACCOUNT</span><h3 id="account-title">Signed in securely</h3><p>Your authenticated account is active. Source connections and browser sessions are resolved through its tenant-scoped workspace membership.</p></div>
          <strong>COMPLETE ✓</strong>
        </section>

        <section className="onboardingConsent" aria-label="Required provider consent">
          {requiredProviders.map((provider, index) => {
            const definition = integrationCatalog.find(item => item.provider === provider)!;
            const connection = statusByProvider.get(provider);
            const approved = isApproved(connection);
            const locked = provider === "slack" && !googleApproved;
            const configured = configuredProviders.includes(provider);
            return <article className={locked ? "locked" : ""} key={provider}>
              <div className="onboardingStepNumber">0{index + 2}</div>
              <div className="consentCopy">
                <span>{definition.shortName} · EXPLICIT OAUTH CONSENT</span>
                <h3>{definition.name}</h3>
                <p>{definition.description}</p>
                <dl><dt>REQUESTED ACCESS</dt><dd>{definition.scopes.join(" · ")}</dd></dl>
                {connection && <small>{providerDetail(connection)}{connection.externalWorkspaceName ? ` · ${connection.externalWorkspaceName}` : ""}</small>}
              </div>
              <div className="consentAction">
                {approved ? <strong>APPROVED ✓</strong> : locked ? <button disabled>APPROVE GOOGLE FIRST</button> : configured
                  ? <a href={provider === "slack" ? "/auth/slack" : "/auth/integrations/google"}>REVIEW &amp; APPROVE ↗</a>
                  : <button disabled>ADMIN SETUP REQUIRED</button>}
                <small>{approved ? "Consent recorded for this workspace" : "Opens the provider consent screen"}</small>
              </div>
            </article>;
          })}
        </section>

        <section className={`onboardingBrowser ${sourcesApproved ? "available" : "locked"}`} aria-labelledby="browser-title">
          <div className="browserSteps">
            <span className="onboardingStepNumber">04</span><i aria-hidden="true">F</i><span className="onboardingStepNumber">05</span>
          </div>
          <div>
            <span>BROWSER EXTENSION · INSTALL &amp; VERIFY</span>
            <h3 id="browser-title">{browserPaired ? "Extension paired to this workspace." : "Install Found, then verify this browser."}</h3>
            <p>The extension proves installation by requesting an authenticated, short-lived browser session for <b>{workspaceName}</b>. Until that handshake succeeds, Found does not mark either browser step complete.</p>
            {sourcesApproved && !browserPaired && <a className="extensionDownload" href="/echocheck-extension.zip" download>DOWNLOAD CHROME EXTENSION ↓</a>}
            <div className={`pairingCheck ${browserPaired ? "paired" : ""}`} aria-live="polite">
              <i aria-hidden="true" />
              <div>
                <h4 ref={pairingStatus} data-found-pair-status>{sourcesApproved ? "Checking for the Found extension…" : "Connect Google Workspace and Slack first."}</h4>
                <p data-found-pair-detail>{sourcesApproved ? "If the extension is installed, it will securely pair this browser automatically." : "Browser pairing is available after both provider approvals are recorded."}</p>
              </div>
            </div>
          </div>
        </section>

        <section className={`onboardingFinish ${browserPaired ? "ready" : ""}`}>
          <span className="onboardingStepNumber">06</span>
          <div><span>YOUR WORKSPACE</span><h3>Enter the Found dashboard</h3><p>Search company memory and inspect every answer at its original source.</p></div>
          {browserPaired ? <Link href="/workspace">ENTER DASHBOARD ↗</Link> : <button disabled>PAIR EXTENSION TO CONTINUE</button>}
        </section>
      </section>
    </div>
  </main>;
}

function isApproved(connection: IntegrationConnection | undefined): boolean {
  return Boolean(connection && connection.status !== "disconnected");
}

function providerName(provider?: string): string {
  return integrationCatalog.find(item => item.provider === provider)?.name ?? "The source";
}

function providerDetail(connection: IntegrationConnection | undefined): string {
  if (!connection || connection.status === "disconnected") return "Consent required";
  if (connection.status === "attention") return "Approved · needs attention";
  if (!connection.lastSyncedAt) return "Approved · indexing pending";
  return `Indexed ${new Date(connection.lastSyncedAt).toLocaleDateString()}`;
}

function integrationError(code: string): string {
  if (code === "admin_required" || code === "workspace_forbidden") return "Only a workspace owner or admin can connect sources.";
  if (code === "google_required") return "Approve Google Workspace before continuing to Slack.";
  if (code.endsWith("_not_configured")) return `${providerName(code.replace("_not_configured", ""))} needs OAuth credentials added by the Found administrator.`;
  if (code === "connection_storage_failed") return "Authorisation completed, but the encrypted connection could not be stored. Nothing was indexed.";
  if (code.includes("authorization_failed") || code === "invalid_integration_callback") return "The provider did not complete authorisation. Please try again.";
  return "This connection could not be completed.";
}

function connectionFeedback(provider: string | undefined, connection: IntegrationConnection | undefined): string {
  if (!isApproved(connection)) return `${providerName(provider)} did not return a saved authorisation.`;
  return `${providerName(provider)} consent is recorded for this workspace${connection?.lastSyncedAt ? " and approved content has been indexed" : "; indexing has not completed"}.`;
}

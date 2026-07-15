import Link from "next/link";
import { foundSignInPath, getFoundUser } from "./auth";

export const dynamic = "force-dynamic";

const integrations = ["Slack", "Notion", "Jira", "Google Workspace", "GitHub"];

export default async function LandingPage() {
  const user = await getFoundUser();
  const primaryHref = user ? "/workspace" : foundSignInPath("/workspace");

  return (
    <main className="foundLanding">
      <nav className="foundNav" aria-label="Primary navigation">
        <Link className="foundWordmark" href="/">Found<span>.</span></Link>
        <div className="foundNavLinks">
          <a href="#how">How it works</a>
          <a href="#security">Security</a>
          <a href="#integrations">Integrations</a>
        </div>
        <Link className="foundLogin" href={primaryHref}>{user ? "Open workspace" : "Log in"}</Link>
      </nav>

      <section className="foundHero" aria-labelledby="found-title">
        <div className="foundHeroCopy">
          <p className="foundEyebrow">COMPANY MEMORY, WITH RECEIPTS</p>
          <h1 id="found-title">Your company<br/>already knows.</h1>
        </div>
        <div className="foundIntroCard">
          <span>THE MEMORY LAYER</span>
          <h2>Context that finds your team.</h2>
          <p>Found connects conversations, decisions, documents, tickets, campaigns, and code—then surfaces the right evidence before work repeats.</p>
          <Link href={primaryHref}>{user ? "Continue setup" : "Connect your workspace"}<span>↗</span></Link>
        </div>
        <div className="foundSignal foundSignalBottom">
          <span>PRIOR WORK · 96%</span>
          <b>Progressive delivery guardrails</b>
          <small>LOOP-42 · implementation approved</small>
        </div>
      </section>

      <section className="foundMarquee" id="integrations" aria-label="Supported integrations">
        <span>WORKS WHERE YOUR TEAM WORKS</span>
        <div>{integrations.map(name => <b key={name}>{name}</b>)}</div>
      </section>

      <section className="foundHow" id="how">
        <header>
          <p>HOW FOUND WORKS</p>
          <h2>Ask once.<br/>Find everything.</h2>
          <span>Found keeps every answer grounded in the source—so your team can inspect the original thread, document, ticket, or implementation.</span>
        </header>
        <div className="foundSteps">
          <article><span>01</span><h3>Connect</h3><p>Choose the Slack channels, Notion spaces, Jira projects, Drive folders, and repositories Found may index.</p></article>
          <article><span>02</span><h3>Remember</h3><p>Found turns scattered work into permission-aware records while the source systems remain authoritative.</p></article>
          <article><span>03</span><h3>Surface</h3><p>Strong prior work appears inside Slack, the browser, and code review—with its owner, status, and direct source link.</p></article>
        </div>
      </section>

      <section className="foundProof">
        <div><p>ONE QUESTION</p><h2>“Have we tried a lower deposit for trusted renters?”</h2></div>
        <article>
          <span>FOUND · SAME IDEA · 94%</span>
          <h3>Dynamic security deposits for trusted renters</h3>
          <p>Rohan Desai already explored this intervention. The experiment is approved and implementation is in progress.</p>
          <dl><div><dt>NOTION</dt><dd>Decision and experiment design</dd></div><div><dt>SLACK</dt><dd>Original team discussion</dd></div><div><dt>JIRA</dt><dd>RLP-101 · In Progress</dd></div></dl>
        </article>
      </section>

      <section className="foundSecurity" id="security">
        <div><p>SECURITY BY ARCHITECTURE</p><h2>Your knowledge stays permission-aware.</h2></div>
        <div className="foundSecurityGrid">
          <article><b>Source ACLs</b><p>Retrieval is filtered by organisation and effective source permissions before ranking.</p></article>
          <article><b>Scoped OAuth</b><p>Admins choose what Found can access. Provider tokens belong in encrypted server-side storage.</p></article>
          <article><b>Source-first</b><p>Found stores a searchable index and audit trail; Slack, Notion, Jira, Drive, and GitHub retain the full record.</p></article>
          <article><b>Revocable</b><p>Connections are designed to be revoked, re-scoped, re-indexed, and deleted by workspace administrators.</p></article>
        </div>
      </section>

      <section className="foundFinal">
        <p>READY WHEN YOUR WORKSPACE IS</p>
        <h2>Stop restarting.<br/>Start with what’s found.</h2>
        <Link href={primaryHref}>{user ? "Open integration setup" : "Log in and connect"}<span>↗</span></Link>
      </section>

      <footer className="foundFooter"><Link href="/">Found.</Link><p>Company memory, with receipts.</p><span>© 2026 FOUND</span></footer>
    </main>
  );
}

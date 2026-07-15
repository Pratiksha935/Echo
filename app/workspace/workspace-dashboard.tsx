"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";

const views = ["Overview", "Product", "GTM", "Engineering", "Research", "Browser"] as const;
type View = typeof views[number];
const records = [
  {team:"Product",title:"Dynamic security deposits for trusted renters",owner:"Rohan Desai",state:"Approved",source:"Notion · RLP-101",keys:"deposit trusted clean returns"},
  {team:"Product",title:"Fit confidence and backup-size reservation",owner:"Ananya Sharma",state:"Discovery complete",source:"Notion · RLP-102",keys:"fit backup adjacent size"},
  {team:"GTM",title:"Wedding Wardrobe Week",owner:"Aarav Shah",state:"13.9× ROAS",source:"Campaign CSV",keys:"wedding campaign roas itinerary"},
  {team:"GTM",title:"Customer measurement and proof-of-value problem",owner:"Rhea Bose",state:"Evidence confirmed",source:"Slack · #sales-floor",keys:"measurement roi proof value pilot"},
  {team:"Engineering",title:"Progressive delivery guardrails",owner:"Leena Rao",state:"Implementation approved",source:"Jira · LOOP-42",keys:"canary rollback feature flag deployment"},
  {team:"Engineering",title:"Developer portal and service maturity scorecards",owner:"Vikram Rao",state:"Pilot running",source:"Jira · ENG-214",keys:"harness portal catalog scorecard"},
];
const links=[
  {kind:"COMPETITOR",title:"Rent the Runway membership model",owner:"Nisha Kapoor",tag:"retention · rental"},
  {kind:"ARTICLE",title:"Harness developer portal patterns",owner:"Vikram Rao",tag:"platform · scorecards"},
  {kind:"CODE",title:"Shared risk-adjusted deposit service",owner:"Ishaan Verma",tag:"deposit · checkout"},
];

export default function WorkspaceDashboard({displayName}:{displayName:string}) {
  const [view,setView]=useState<View>("Overview");
  const [query,setQuery]=useState("");
  const [submitted,setSubmitted]=useState("");
  const matches=useMemo(()=>{const terms=submitted.toLowerCase().split(/\W+/).filter(x=>x.length>3);return records.filter(item=>terms.some(term=>`${item.title} ${item.keys}`.toLowerCase().includes(term))).slice(0,3)},[submitted]);
  function search(event:FormEvent){event.preventDefault();setSubmitted(query.trim())}
  return <main className="foundWorkspace">
    <aside className="wsRail"><Link href="/" className="wsLogo">Found<span>.</span></Link><nav>{views.map(item=><button key={item} className={view===item?"active":""} onClick={()=>setView(item)}><i/>{item}</button>)}</nav><div><Link href="/integrations">Connect sources ↗</Link><small>5 sources · healthy</small></div></aside>
    <section className="wsMain">
      <header className="wsTop"><div><span>RELOOP / COMPANY INTELLIGENCE</span><b>{view}</b></div><div><i/> LIVE MEMORY <strong>{displayName}</strong></div></header>
      <section className="wsHero"><p>THE GENERAL INTELLIGENCE OF YOUR COMPANY</p><h1>Everything your team<br/>has already learned.</h1><form onSubmit={search}><input aria-label="Search company knowledge" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Ask about a decision, campaign, customer insight, or code…"/><button>Find it ↗</button></form></section>
      {submitted&&<section className="wsResults" aria-live="polite"><header><span>FOUND IN COMPANY MEMORY</span><b>{matches.length} strong matches</b></header>{matches.length?matches.map(item=><article key={item.title}><span>{item.team}</span><div><h3>{item.title}</h3><p>{item.owner} · {item.source}</p></div><strong>{item.state} ↗</strong></article>):<p>No strong prior work found. Found stays silent on weak matches.</p>}</section>}
      <section className="wsMetrics"><article><span>MEMORY RECORDS</span><b>18</b><p>Across approved sources</p></article><article><span>PRIOR WORK FOUND</span><b>09</b><p>This month</p></article><article><span>DECISIONS LINKED</span><b>94%</b><p>With original evidence</p></article><article><span>SYNC HEALTH</span><b>100%</b><p>No failed sources</p></article></section>
      {(view==="Overview"||view==="Product")&&<section className="wsSection"><header><span>PRODUCT MEMORY</span><h2>Decisions before<br/>feature requests.</h2></header><div className="wsDecision"><div><span>P0 · CONFLICT DETECTED</span><h3>“Zero deposit for everyone” is already a known dead end.</h3><p>The approved path is a 50% lower hold after five clean returns. The blanket zero-deposit campaign was stopped.</p></div><aside><b>94%</b><span>SAME IDEA</span><dl><div><dt>OWNER</dt><dd>Rohan Desai</dd></div><div><dt>STATUS</dt><dd>Experiment approved</dd></div><div><dt>SOURCES</dt><dd>Notion · Slack · RLP-101</dd></div></dl></aside></div></section>}
      {(view==="Overview"||view==="GTM")&&<section className="wsSection wsGtm"><header><span>GTM INTELLIGENCE</span><h2>What worked.<br/>What did not.</h2></header><div className="wsCampaigns"><article><b>33.6×</b><span>Return & Earn</span><i style={{width:"100%"}}/></article><article><b>13.9×</b><span>Wedding Wardrobe Week</span><i style={{width:"62%"}}/></article><article><b>4.4×</b><span>Trust Your Rental</span><i style={{width:"27%"}}/></article><article><b>1.3×</b><span>Office Edit Trial</span><i style={{width:"8%"}}/></article></div></section>}
      {(view==="Overview"||view==="Engineering")&&<section className="wsSection"><header><span>ENGINEERING MEMORY</span><h2>Reuse the behavior.<br/>Not just the file.</h2></header><div className="wsCode"><article><span>LOOP-42</span><code>createCanaryPlan()</code><p>packages/release-guard/src/canary.ts</p><b>Leena Rao ↗</b></article><article><span>ENG-214</span><code>resolveServiceOwner()</code><p>services/catalog/src/ownership.ts</p><b>Vikram Rao ↗</b></article><article><span>LOOP-63</span><code>extract_failure_taxonomy()</code><p>tools/incident-linker/index.py</p><b>Kabir Malhotra ↗</b></article></div><Link className="wsModuleLink" href="/code-review">Open PR duplicate guard ↗</Link></section>}
      {(view==="Overview"||view==="Research")&&<section className="wsSection"><header><span>LINK DUMP</span><h2>Save it now.<br/>Find it when it matters.</h2></header><div className="wsLinks">{links.map(item=><article key={item.title}><span>{item.kind}</span><h3>{item.title}</h3><p>{item.owner}</p><b>{item.tag}</b><i>↗</i></article>)}</div><button className="wsAdd">+ ADD ARTICLE, REPOSITORY, OR COMPETITOR LINK</button></section>}
      {(view==="Overview"||view==="Browser")&&<section className="wsBrowser"><div><span>BROWSER INTELLIGENCE</span><h2>Found follows the idea,<br/>not your browsing history.</h2><p>On supported articles, the extension checks page meaning against approved company memory and surfaces only strong matches.</p><Link href="/demo-article">Open article demo ↗</Link></div><article><span>96% · PRIOR WORK</span><h3>Developer portal and service maturity scorecards</h3><p>Vikram Rao is already running this pilot.</p><b>OPEN ENG-214 ↗</b></article></section>}
    </section>
  </main>
}

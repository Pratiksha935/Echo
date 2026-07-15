"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import type { WorkspaceKnowledgeRecord } from "../../lib/auth/workspace";

const views = ["Overview", "Product", "GTM", "Sales", "Engineering", "Research", "Browser"] as const;
type View = typeof views[number];
const demoRecords = [
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

type Props = {
  connectedCount: number;
  demoMode: boolean;
  displayName: string;
  records: WorkspaceKnowledgeRecord[];
  workspaceName: string;
};

export default function WorkspaceDashboard({connectedCount,demoMode,displayName,records,workspaceName}:Props) {
  const [view,setView]=useState<View>("Overview");
  const [query,setQuery]=useState("");
  const [submitted,setSubmitted]=useState("");
  const companyRecords=useMemo(()=>demoMode?demoRecords.map(item=>({...item,sourceUrl:"#"})):records.map(item=>({
    team:item.department??"Company",title:item.title,owner:item.authorName??"Unknown owner",state:item.status,source:`${item.source} · ${item.externalId}`,sourceUrl:item.sourceUrl,keys:`${item.title} ${item.department??""}`
  })),[demoMode,records]);
  const matches=useMemo(()=>{const terms=submitted.toLowerCase().split(/\W+/).filter(x=>x.length>3);return companyRecords.filter(item=>terms.some(term=>`${item.title} ${item.keys}`.toLowerCase().includes(term))).slice(0,6)},[companyRecords,submitted]);
  const departmentRecords=useMemo(()=>companyRecords.filter(item=>item.team.toLowerCase()===view.toLowerCase()),[companyRecords,view]);
  const visibleRecords=useMemo(()=>view==="Overview"?curateOverview(companyRecords):departmentRecords.slice(0,6),[companyRecords,departmentRecords,view]);
  const visibleTotal=view==="Overview"?companyRecords.length:departmentRecords.length;
  function search(event:FormEvent){event.preventDefault();setSubmitted(query.trim())}
  return <main className="foundWorkspace">
    <aside className="wsRail"><Link href="/" className="wsLogo">Found<span>.</span></Link><nav>{views.map(item=><button key={item} className={view===item?"active":""} onClick={()=>setView(item)}><i/>{item}</button>)}</nav><div><Link href="/integrations">Connect sources ↗</Link><small>{demoMode?"Demo memory":`${connectedCount} source${connectedCount===1?"":"s"} connected`}</small></div></aside>
    <section className="wsMain">
      <header className="wsTop"><div><span>{workspaceName.toUpperCase()} / COMPANY INTELLIGENCE</span><b>{view}</b></div><div><i/> {demoMode?"DEMO MEMORY":"PRIVATE WORKSPACE"} <strong>{displayName}</strong></div></header>
      <section className="wsHero"><p>THE GENERAL INTELLIGENCE OF YOUR COMPANY</p><h1>Everything your team<br/>has already learned.</h1><form onSubmit={search}><input aria-label="Search company knowledge" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Ask about a decision, campaign, customer insight, or code…"/><button>Find it ↗</button></form></section>
      {submitted&&<section className="wsResults" aria-live="polite"><header><span>FOUND IN COMPANY MEMORY</span><b>{matches.length} strong matches</b></header>{matches.length?matches.map(item=><article key={item.title}><span>{item.team}</span><div><h3>{item.title}</h3><p>{item.owner} · {item.source}</p></div><strong>{item.state} ↗</strong></article>):<p>No strong prior work found. Found stays silent on weak matches.</p>}</section>}
      <section className="wsMetrics"><article><span>MEMORY RECORDS</span><b>{demoMode?"18":String(records.length).padStart(2,"0")}</b><p>Across approved sources</p></article><article><span>CONNECTED SOURCES</span><b>{demoMode?"05":String(connectedCount).padStart(2,"0")}</b><p>Workspace-authorised</p></article><article><span>EVIDENCE LINKS</span><b>{demoMode?"94%":records.length?"100%":"—"}</b><p>Original sources retained</p></article><article><span>WORKSPACE MODE</span><b>{demoMode?"CV1":"ACL"}</b><p>{demoMode?"Seeded product demo":"Tenant isolated"}</p></article></section>
      {!demoMode&&<section className="wsSection wsLiveMemory"><header><span>{view.toUpperCase()} MEMORY · {visibleRecords.length} OF {visibleTotal}</span><h2>{records.length?"The few records that change the next decision.":"Connect a source to begin."}</h2></header>{visibleRecords.length?<><div className="wsLiveRecords">{visibleRecords.map(item=><article key={`${item.source}-${item.title}`}><span>{item.team}</span><div><h3><a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.title}</a></h3><p>{item.owner} · {item.source}</p></div><b>{item.state}</b></article>)}</div>{visibleTotal>visibleRecords.length&&<p className="wsRecordNote">Showing the highest-signal records. Search reaches all {visibleTotal} approved memories.</p>}</>:<div className="wsEmpty"><p>No company records are visible in this department.</p><Link href="/integrations">Manage Slack and Google Workspace ↗</Link></div>}</section>}
      {demoMode&&(view==="Overview"||view==="Product")&&<section className="wsSection"><header><span>PRODUCT MEMORY</span><h2>Decisions before<br/>feature requests.</h2></header><div className="wsDecision"><div><span>P0 · CONFLICT DETECTED</span><h3>“Zero deposit for everyone” is already a known dead end.</h3><p>The approved path is a 50% lower hold after five clean returns. The blanket zero-deposit campaign was stopped.</p></div><aside><b>94%</b><span>SAME IDEA</span><dl><div><dt>OWNER</dt><dd>Rohan Desai</dd></div><div><dt>STATUS</dt><dd>Experiment approved</dd></div><div><dt>SOURCES</dt><dd>Notion · Slack · RLP-101</dd></div></dl></aside></div></section>}
      {demoMode&&(view==="Overview"||view==="GTM")&&<section className="wsSection wsGtm"><header><span>GTM INTELLIGENCE</span><h2>What worked.<br/>What did not.</h2></header><div className="wsCampaigns"><article><b>33.6×</b><span>Return & Earn</span><i style={{width:"100%"}}/></article><article><b>13.9×</b><span>Wedding Wardrobe Week</span><i style={{width:"62%"}}/></article><article><b>4.4×</b><span>Trust Your Rental</span><i style={{width:"27%"}}/></article><article><b>1.3×</b><span>Office Edit Trial</span><i style={{width:"8%"}}/></article></div></section>}
      {demoMode&&(view==="Overview"||view==="Engineering")&&<section className="wsSection"><header><span>ENGINEERING MEMORY</span><h2>Reuse the behavior.<br/>Not just the file.</h2></header><div className="wsCode"><article><span>LOOP-42</span><code>createCanaryPlan()</code><p>packages/release-guard/src/canary.ts</p><b>Leena Rao ↗</b></article><article><span>ENG-214</span><code>resolveServiceOwner()</code><p>services/catalog/src/ownership.ts</p><b>Vikram Rao ↗</b></article><article><span>LOOP-63</span><code>extract_failure_taxonomy()</code><p>tools/incident-linker/index.py</p><b>Kabir Malhotra ↗</b></article></div><Link className="wsModuleLink" href="/code-review">Open PR duplicate guard ↗</Link></section>}
      {demoMode&&(view==="Overview"||view==="Research")&&<section className="wsSection"><header><span>LINK DUMP</span><h2>Save it now.<br/>Find it when it matters.</h2></header><div className="wsLinks">{links.map(item=><article key={item.title}><span>{item.kind}</span><h3>{item.title}</h3><p>{item.owner}</p><b>{item.tag}</b><i>↗</i></article>)}</div><button className="wsAdd">+ ADD ARTICLE, REPOSITORY, OR COMPETITOR LINK</button></section>}
      {demoMode&&(view==="Overview"||view==="Browser")&&<section className="wsBrowser"><div><span>BROWSER INTELLIGENCE</span><h2>Found follows the idea,<br/>not your browsing history.</h2><p>On supported articles, the extension checks page meaning against approved company memory and surfaces only strong matches.</p><Link href="/demo-article">Open article demo ↗</Link></div><article><span>96% · PRIOR WORK</span><h3>Developer portal and service maturity scorecards</h3><p>Vikram Rao is already running this pilot.</p><b>OPEN ENG-214 ↗</b></article></section>}
    </section>
  </main>
}

function curateOverview<T extends { team: string }>(items: T[]): T[] {
  const perTeam = new Map<string, number>();
  return items.filter(item => {
    const count = perTeam.get(item.team) ?? 0;
    if (count >= 2) return false;
    perTeam.set(item.team, count + 1);
    return true;
  }).slice(0, 8);
}

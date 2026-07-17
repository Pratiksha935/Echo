"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import type { MemoryUpdate, WorkspaceKnowledgeRecord } from "../../lib/auth/workspace";
import { buildDecisionMemory, decisionPath, departments, formatMoment, type DecisionMemory, type Department } from "../../lib/workspace/intelligence";

const views = ["Overview", ...departments] as const;
type View = typeof views[number];

const demoRecords: WorkspaceKnowledgeRecord[] = [
  record("RLP-101","Product","Dynamic security deposits for trusted renters","Rohan Desai","Experiment approved","Notion","https://app.notion.com/p/39b630edf61f811fb5c2fb52bd1b2507","Customers with five clean returns receive a 50% reduction in the standard security deposit.","2026-07-17T10:30:00.000Z"),
  record("slack:RLP-101","Product","Dynamic security deposits for trusted renters","Rohan Desai","Latest Slack update","Slack","https://newworkspace-2bk3073.slack.com/archives/C0BGVQAPU0L","The team rejected a blanket zero-deposit policy and retained the risk-adjusted hold.","2026-07-17T11:10:00.000Z"),
  record("RLP-102","Product","Fit confidence and backup-size reservation","Ananya Sharma","Discovery complete","Notion","https://app.notion.com/p/39b630edf61f81428907d392653ae37f","Reserve an adjacent size when fit confidence is low.","2026-07-16T15:20:00.000Z"),
  record("SALES-MEASUREMENT-001","Sales","Customer measurement and proof-of-value problem","Rhea Bose","Evidence confirmed","Slack","https://newworkspace-2bk3073.slack.com/archives/C0BGVQC999S/p1783839807897629","Paid 30-day proof of value with one written success metric replaces default free pilots.","2026-07-17T09:45:00.000Z"),
  record("GTM-WEDDING-01","GTM","Wedding Wardrobe Week","Aarav Shah","13.9× ROAS","Google Sheets","https://docs.google.com/spreadsheets/","Wedding-event bundles produced the strongest qualified-renter conversion among seasonal campaigns.","2026-07-15T13:00:00.000Z"),
  record("LOOP-42","Engineering","Progressive delivery guardrails","Leena Rao","Implementation approved","Slack","https://app.slack.com/client/T08LC40MYVB/C0BGU0STURX","Shared feature flags, canary cohorts, health verification and rollback are the approved release path.","2026-07-17T08:20:00.000Z"),
  record("BROWSER-HARNESS","Research","Harness developer portal patterns","Vikram Rao","Research linked","Browser","https://www.harness.io/products/internal-developer-portal","Competitor research linked to the existing developer portal pilot.","2026-07-14T10:00:00.000Z"),
];

type Props = { connectedCount:number; demoMode:boolean; displayName:string; memoryUpdates:MemoryUpdate[]; records:WorkspaceKnowledgeRecord[]; workspaceName:string };

export default function WorkspaceDashboard({ connectedCount, demoMode, displayName, memoryUpdates, records, workspaceName }: Props) {
  const [view,setView] = useState<View>("Overview");
  const [query,setQuery] = useState("");
  const [submitted,setSubmitted] = useState("");
  const [graphId,setGraphId] = useState("");
  const effectiveRecords = demoMode ? demoRecords : records;
  const decisions = useMemo(() => buildDecisionMemory(effectiveRecords,memoryUpdates),[effectiveRecords,memoryUpdates]);
  const selectedDepartment = view === "Overview" ? null : view as Department;
  const departmentDecisions = useMemo(() => selectedDepartment ? decisions.filter(item=>item.department===selectedDepartment) : [],[decisions,selectedDepartment]);
  const searchResults = useMemo(() => searchDecisions(decisions,submitted),[decisions,submitted]);
  const graphDecisions = decisions.slice(0,5);
  const selectedGraph = graphDecisions.find(item=>item.id===graphId) ?? graphDecisions[0];
  const sourceKinds = new Set(decisions.flatMap(item=>item.sources.map(source=>source.kind)));
  const activeDepartments = departments.filter(department=>decisions.some(item=>item.department===department));
  const latestUpdates = decisions.slice(0,6);

  function search(event:FormEvent) { event.preventDefault(); setSubmitted(query.trim()); }
  function selectView(next:View) { setView(next); setSubmitted(""); window.scrollTo({top:0,behavior:"smooth"}); }

  return <main className="foundWorkspace workspaceV2">
    <aside className="wsRail">
      <Link href="/" className="wsLogo">Found<span>.</span></Link>
      <nav>{views.map(item=><button type="button" key={item} className={view===item?"active":""} onClick={()=>selectView(item)}><i/>{item}</button>)}</nav>
      <div><Link href="/integrations">Manage sources ↗</Link><small>{connectedCount} authorised source{connectedCount===1?"":"s"}</small></div>
    </aside>
    <section className="wsMain">
      <header className="wsTop"><div><span>{workspaceName.toUpperCase()} / LIVE COMPANY MEMORY</span><b>{view}</b></div><div><i/> {demoMode?"DEMO WORKSPACE":"TENANT-ISOLATED"} <strong>{displayName}</strong></div></header>
      <section className="pulseHero">
        <div><span>{view==="Overview"?"COMPANY PULSE":"DEPARTMENT MEMORY"} · {formatDay(new Date())}</span>
          <h1>{view==="Overview"?<>What changed across<br/>{workspaceName}.</>:<>Everything {view}<br/>needs to know.</>}</h1>
          <p>{view==="Overview"?"A current, evidence-weighted view of decisions, changed assumptions and emerging work. Raw source records stay inside their department and decision timelines.":`${departmentDecisions.length} classified decisions, ordered by the latest verified layer.`}</p>
        </div>
        <form onSubmit={search}><input aria-label="Search company knowledge" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Ask about a decision, campaign, client, competitor, or implementation…"/><button>Search memory ↗</button></form>
      </section>

      {submitted&&<SearchResults query={submitted} results={searchResults}/>}

      {view==="Overview" ? <>
        <section className="pulseMetrics" aria-label="Company memory health">
          <Metric label="ACTIVE DECISIONS" value={String(decisions.length).padStart(2,"0")} detail="Consolidated across duplicate sources"/>
          <Metric label="CHANGED THIS WEEK" value={String(decisions.filter(item=>withinDays(item.latestAt,7)).length).padStart(2,"0")} detail="New evidence or memory layers"/>
          <Metric label="DEPARTMENTS MOVING" value={String(activeDepartments.length).padStart(2,"0")} detail={activeDepartments.join(" · ")||"No classified activity"}/>
          <Metric label="SOURCE COVERAGE" value={String(sourceKinds.size).padStart(2,"0")} detail={[...sourceKinds].join(" · ")||"Connect company sources"}/>
        </section>
        <section className="companyPulse">
          <header><div><span>TRENDING NOW</span><h2>The decisions<br/>shaping this week.</h2></div><p>Momentum is based on recency, source diversity and explicit memory updates—not message volume.</p></header>
          <div className="trendLedger">{decisions.slice(0,4).map((decision,index)=><DecisionCard decision={decision} rank={index+1} key={decision.id}/>)}</div>
        </section>
        <section className="pulseSplit">
          <div className="changeStream"><header><span>LATEST VERIFIED CHANGES</span><b>Newest first</b></header>{latestUpdates.map(item=><Link href={decisionPath(item.id)} key={item.id}><time>{formatMoment(item.latestAt)}</time><div><b>{item.department}</b><h3>{item.title}</h3><p>{truncate(item.latestText,150)}</p></div><span>{item.status} ↗</span></Link>)}</div>
          <div className="departmentPulse"><header><span>DEPARTMENT PULSE</span><b>Classified automatically</b></header>{departments.map(department=>{const items=decisions.filter(item=>item.department===department);return <button type="button" key={department} onClick={()=>selectView(department)}><span>{department}</span><b>{String(items.length).padStart(2,"0")}</b><small>{items[0]?`Latest · ${formatRelative(items[0].latestAt)}`:"No activity yet"}</small></button>})}</div>
        </section>
        <section className="knowledgeGraphV2">
          <header><div><span>LIVE KNOWLEDGE GRAPH</span><h2>Decisions connected<br/>to their evidence.</h2></div><p>Select a decision to see its department, source diversity, latest memory layer and timeline. Nodes are generated from live records—never duplicated decoration.</p></header>
          {graphDecisions.length ? <div className="graphGrid">
            <div className="graphDepartments"><span>DEPARTMENTS</span>{[...new Set(graphDecisions.map(item=>item.department))].map(item=><b key={item}>{item}</b>)}</div>
            <div className="graphDecisions"><span>DECISIONS</span>{graphDecisions.map(item=><button type="button" className={selectedGraph?.id===item.id?"active":""} onClick={()=>setGraphId(item.id)} key={item.id}><small>{item.department}</small><b>{item.title}</b><em>{item.sources.length} source{item.sources.length===1?"":"s"}</em></button>)}</div>
            <aside><span>SELECTED MEMORY</span><h3>{selectedGraph?.title}</h3><p>{truncate(selectedGraph?.latestText??"",240)}</p><dl><div><dt>OWNER</dt><dd>{selectedGraph?.owner}</dd></div><div><dt>LATEST LAYER</dt><dd>{selectedGraph?formatMoment(selectedGraph.latestAt):"—"}</dd></div><div><dt>EVIDENCE</dt><dd>{selectedGraph?.sources.map(source=>source.kind).join(" · ")}</dd></div></dl>{selectedGraph&&<Link href={decisionPath(selectedGraph.id)}>OPEN DECISION TIMELINE ↗</Link>}</aside>
          </div>:<EmptyState/>}
        </section>
      </> : <DepartmentView department={selectedDepartment!} decisions={departmentDecisions}/>}
    </section>
  </main>;
}

function DepartmentView({department,decisions}:{department:Department;decisions:DecisionMemory[]}) {
  const sources=new Set(decisions.flatMap(item=>item.sources.map(source=>source.kind)));
  return <>
    <section className="departmentSummary"><div><span>{department.toUpperCase()} / CURRENT MEMORY</span><h2>{departmentHeading(department)}</h2><p>{departmentDescription(department)}</p></div><dl><div><dt>DECISIONS</dt><dd>{String(decisions.length).padStart(2,"0")}</dd></div><div><dt>UPDATED THIS WEEK</dt><dd>{String(decisions.filter(item=>withinDays(item.latestAt,7)).length).padStart(2,"0")}</dd></div><div><dt>SOURCE TYPES</dt><dd>{String(sources.size).padStart(2,"0")}</dd></div></dl></section>
    <section className="decisionRegistry"><header><span>LATEST FIRST</span><h2>Decision memory</h2><p>One row per decision. Duplicate Slack, Docs and browser captures are consolidated into its evidence timeline.</p></header>{decisions.length?<div>{decisions.map(decision=><Link href={decisionPath(decision.id)} key={decision.id}><div><span>{formatMoment(decision.latestAt)}</span><em>{decision.status}</em></div><h3>{decision.title}</h3><p>{truncate(decision.latestText,220)}</p><footer><span>{decision.owner}</span><b>{decision.sources.map(source=>source.kind).join(" · ")}</b><strong>Open timeline ↗</strong></footer></Link>)}</div>:<EmptyState/>}</section>
    {department==="Browser"&&<section className="browserOperatingModel"><span>BROWSER MEMORY</span><h2>Capture deliberately.<br/>Discover automatically.</h2><div><article><b>01</b><h3>Ambient insight</h3><p>Found checks supported pages in the background and opens a battlecard only for strong workspace matches.</p></article><article><b>02</b><h3>Team capture</h3><p>Research, GTM, Product and Sales can save the current page with a department and explicit note from the extension.</p></article><article><b>03</b><h3>Decision routing</h3><p>Every surfaced insight opens its internal timeline; source systems remain receipts, not the primary interface.</p></article></div></section>}
  </>;
}

function DecisionCard({decision,rank}:{decision:DecisionMemory;rank:number}) { return <Link href={decisionPath(decision.id)}><div><span>0{rank}</span><em>{decision.department}</em></div><h3>{decision.title}</h3><p>{truncate(decision.latestText,170)}</p><footer><span>{formatRelative(decision.latestAt)}</span><b>{decision.sources.length} evidence source{decision.sources.length===1?"":"s"} ↗</b></footer></Link>; }
function SearchResults({query,results}:{query:string;results:DecisionMemory[]}) { return <section className="searchOverlay"><header><span>RESULTS FOR “{query}”</span><b>{results.length} decision{results.length===1?"":"s"}</b></header>{results.length?results.map(item=><Link href={decisionPath(item.id)} key={item.id}><span>{item.department}</span><div><h3>{item.title}</h3><p>{truncate(item.latestText,140)}</p></div><b>{formatRelative(item.latestAt)} ↗</b></Link>):<p>No strong company-memory match. Found does not manufacture an answer.</p>}</section>; }
function Metric({label,value,detail}:{label:string;value:string;detail:string}) { return <article><span>{label}</span><b>{value}</b><p>{detail}</p></article>; }
function EmptyState() { return <div className="workspaceEmpty"><h3>No classified memory yet.</h3><p>Connect an approved source or capture a page from the Found extension.</p><Link href="/integrations">Manage integrations ↗</Link></div>; }

function searchDecisions(items:DecisionMemory[],query:string):DecisionMemory[] { const terms=query.toLowerCase().split(/\W+/).filter(term=>term.length>2); if(!terms.length)return[]; return items.map(item=>({item,score:terms.reduce((score,term)=>score+(item.title.toLowerCase().includes(term)?4:`${item.latestText} ${item.department} ${item.owner}`.toLowerCase().includes(term)?1:0),0)})).filter(result=>result.score>=2).sort((a,b)=>b.score-a.score).slice(0,8).map(result=>result.item); }
function departmentHeading(department:Department):string { return ({Product:"What customers need—and what we decided.",GTM:"Campaign intelligence that compounds.",Sales:"Client evidence before the next call.",Engineering:"Implementation memory before the next PR.",Research:"Signals worth carrying into the roadmap.",Browser:"The web, connected to company context."})[department]; }
function departmentDescription(department:Department):string { return ({Product:"Approved product choices, rejected alternatives, experiments and the newest context attached by the team.",GTM:"Campaign results, positioning decisions and reusable patterns grouped by the work they influence.",Sales:"Customer signals, proof-of-value criteria and account intelligence retained with the original receipt.",Engineering:"Architecture choices, existing implementations and operational learning consolidated across code and conversation.",Research:"Competitor moves, articles and market evidence deliberately captured by the team.",Browser:"Items explicitly saved from the web plus strong organisational matches surfaced while the team browses."})[department]; }
function record(externalId:string,department:string,title:string,authorName:string,status:string,source:string,sourceUrl:string,body:string,sourceUpdatedAt:string):WorkspaceKnowledgeRecord { return {externalId,department,title,authorName,status,source,sourceUrl,body,sourceUpdatedAt}; }
function truncate(value:string,max:number):string { const clean=value.replace(/\s+/g," ").trim(); return clean.length>max?`${clean.slice(0,max-1).trim()}…`:clean; }
function withinDays(value:string,days:number):boolean { const time=Date.parse(value); return !Number.isNaN(time)&&Date.now()-time<=days*86400000; }
function formatRelative(value:string):string { const time=Date.parse(value); if(Number.isNaN(time))return"Time not indexed"; const days=Math.max(0,Math.floor((Date.now()-time)/86400000)); return days===0?"Today":days===1?"Yesterday":`${days} days ago`; }
function formatDay(date:Date):string { return new Intl.DateTimeFormat("en",{day:"2-digit",month:"short",year:"numeric"}).format(date); }

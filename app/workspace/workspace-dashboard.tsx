"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import type { MemoryUpdate, WorkspaceKnowledgeRecord } from "../../lib/auth/workspace";
import { buildDecisionMemory, decisionPath, departments, type DecisionMemory, type Department } from "../../lib/workspace/intelligence";

const views = ["Overview", ...departments] as const;
type View = typeof views[number];

const demoRecords: WorkspaceKnowledgeRecord[] = [
  record("RLP-101","Product","Dynamic security deposits for trusted renters","Rohan Desai","Experiment approved","Notion","https://app.notion.com/p/39b630edf61f811fb5c2fb52bd1b2507","Customers with five clean returns receive a 50% reduction in the standard security deposit.","2026-07-17T10:30:00.000Z"),
  record("slack:RLP-101","Product","Dynamic security deposits for trusted renters","Rohan Desai","Decision confirmed","Slack","https://newworkspace-2bk3073.slack.com/archives/C0BGVQAPU0L","The team rejected a blanket zero-deposit policy and retained the risk-adjusted hold.","2026-07-17T11:10:00.000Z"),
  record("RLP-102","Product","Fit confidence and backup-size reservation","Ananya Sharma","Discovery complete","Notion","https://app.notion.com/p/39b630edf61f81428907d392653ae37f","Reserve an adjacent size when fit confidence is low.","2026-07-16T15:20:00.000Z"),
  record("SALES-MEASUREMENT-001","Sales","Customer measurement and proof-of-value problem","Rhea Bose","Evidence confirmed","Slack","https://newworkspace-2bk3073.slack.com/archives/C0BGVQC999S/p1783839807897629","Paid 30-day proof of value with one written success metric replaces default free pilots.","2026-07-17T09:45:00.000Z"),
  record("GTM-WEDDING-01","GTM","Wedding Wardrobe Week","Aarav Shah","13.9× ROAS","Google Sheets","https://docs.google.com/spreadsheets/","Wedding-event bundles produced the strongest qualified-renter conversion among seasonal campaigns.","2026-07-15T13:00:00.000Z"),
  record("LOOP-42","Engineering","Progressive delivery guardrails","Leena Rao","Implementation approved","Slack","https://app.slack.com/client/T08LC40MYVB/C0BGU0STURX","Shared feature flags, canary cohorts, health verification and rollback are the approved release path.","2026-07-17T08:20:00.000Z"),
  record("BROWSER-HARNESS","Research","Harness developer portal patterns","Vikram Rao","Research linked","Browser","https://www.harness.io/products/internal-developer-portal","Competitor research linked to the existing developer portal pilot.","2026-07-14T10:00:00.000Z"),
];

type Props = { connectedCount:number; connectedProviders:string[]; demoMode:boolean; displayName:string; memoryUpdates:MemoryUpdate[]; records:WorkspaceKnowledgeRecord[]; workspaceName:string };

export default function WorkspaceDashboard({ connectedCount, connectedProviders, demoMode, displayName, memoryUpdates, records, workspaceName }: Props) {
  const [view,setView] = useState<View>("Overview");
  const [query,setQuery] = useState("");
  const [submitted,setSubmitted] = useState("");
  const [graphId,setGraphId] = useState("");
  const effectiveRecords = demoMode ? demoRecords : records;
  const decisions = useMemo(() => buildDecisionMemory(effectiveRecords,memoryUpdates),[effectiveRecords,memoryUpdates]);
  const selectedDepartment = view === "Overview" ? null : view as Department;
  const departmentDecisions = selectedDepartment ? decisions.filter(item=>item.department===selectedDepartment) : [];
  const searchResults = useMemo(() => searchDecisions(decisions,submitted),[decisions,submitted]);
  const selectedGraph = decisions.find(item=>item.id===graphId) ?? decisions[0];
  const sourceKinds = [...new Set(decisions.flatMap(item=>item.sources.map(source=>source.kind)))];
  const activeDepartments = departments.filter(department=>decisions.some(item=>item.department===department));
  const isReady = demoMode || ["google","slack"].every(provider=>connectedProviders.includes(provider));

  function search(event:FormEvent) { event.preventDefault(); setSubmitted(query.trim()); }
  function selectView(next:View) { setView(next); setSubmitted(""); window.scrollTo({top:0,behavior:"smooth"}); }

  return <main className="foundWorkspace workspaceV3">
    <aside className="kbSidebar">
      <Link href="/workspace" className="kbBrand"><i>F</i><span>Found</span></Link>
      <div className="kbWorkspace"><small>WORKSPACE</small><b>{workspaceName}</b><span><i/> Live company memory</span></div>
      <nav aria-label="Knowledge views">{views.map(item=><button type="button" key={item} className={view===item?"active":""} onClick={()=>selectView(item)}><i>{icon(item)}</i><span>{item}</span>{item!=="Overview"&&<em>{decisions.filter(decision=>decision.department===item).length}</em>}</button>)}</nav>
      <div className="kbSidebarFooter"><Link href="/integrations"><i>＋</i><span>Sources & setup</span></Link><small>{connectedCount} authorised source{connectedCount===1?"":"s"}</small></div>
    </aside>

    <section className="kbMain">
      <header className="kbTopbar"><div><button type="button">{view}</button><span>/</span><b>{workspaceName}</b></div><div><span className="kbSecurity">● Tenant isolated</span><span className="kbUser">{initials(displayName)}</span></div></header>
      <div className="kbContent">
        <section className="kbWelcome">
          <div><span>{view==="Overview"?"COMPANY INTELLIGENCE":"DEPARTMENT MEMORY"}</span><h1>{view==="Overview"?`Good ${greeting()}, ${firstName(displayName)}.`:`${view} knowledge`}</h1><p>{view==="Overview"?"A concise view of what changed, what is gaining momentum, and which decisions need attention.":departmentDescription(view as Department)}</p></div>
          <form onSubmit={search}><input aria-label="Search company knowledge" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search decisions, customers, campaigns, or code…"/><button aria-label="Search">⌕</button></form>
        </section>

        {submitted&&<SearchResults query={submitted} results={searchResults}/>}
        {view==="Overview" ? <>
          {!isReady&&<SetupPanel connectedProviders={connectedProviders}/>}
          <section className="kbStats" aria-label="Knowledge health">
            <Metric label="Decisions" value={String(decisions.length)} detail="Consolidated records"/>
            <Metric label="Changed this week" value={String(decisions.filter(item=>withinDays(item.latestAt,7)).length)} detail="New evidence or input"/>
            <Metric label="Active departments" value={String(activeDepartments.length)} detail={activeDepartments.slice(0,3).join(", ")||"Awaiting data"}/>
            <Metric label="Evidence coverage" value={`${sourceKinds.length} types`} detail={sourceKinds.slice(0,3).join(", ")||"Connect sources"}/>
          </section>

          <section className="kbHermesGrid" aria-label="Hermes intelligence layer">
            <article className="kbHermesAgent"><span>HERMES · CONTINUAL LEARNING</span><h2>The agent watching decision drift.</h2><p>Hermes reviews Slack messages, Google Workspace records, browser captures and team corrections as append-only memory layers. It decides when to surface a battlecard, when silence is safer, and what changed since the original source.</p><Link href="/integrations">Tune sources and surfaces →</Link></article>
            <article><span>THIS WEEK</span><b>{decisions.filter(item=>item.latestInput).length}</b><p>team corrections appended without editing source systems</p></article>
            <article><span>WATCHLIST</span><b>{decisions.filter(item=>/approved|confirmed|updated|input/i.test(item.status)).length}</b><p>decisions with active status or changed context</p></article>
            <article><span>SURFACES</span><b>3</b><p>workspace dashboard, browser companion, Slack-native cards</p></article>
          </section>

          <section className="kbOverviewGrid">
            <div className="kbPanel kbTrending"><PanelHeader eyebrow="TRENDING" title="Decisions shaping this week" action="Evidence-weighted"/>
              <div>{decisions.slice(0,5).map((decision,index)=><DecisionRow decision={decision} rank={index+1} key={decision.id}/>)}</div>
            </div>
            <div className="kbPanel kbActivity"><PanelHeader eyebrow="LATEST ACTIVITY" title="Verified change stream" action="Newest first"/>
              <div>{decisions.slice(0,6).map(item=><Link href={decisionPath(item.id)} key={item.id}><i className={`sourceDot source${safeClass(item.sources[0]?.kind)}`}/><div><b>{item.title}</b><p>{item.latestInput?"Team input appended":"Source evidence indexed"}</p></div><time>{formatRelative(item.latestAt)}</time></Link>)}</div>
            </div>
          </section>

          <section className="kbPanel kbGraph">
            <PanelHeader eyebrow="HERMES KNOWLEDGE GRAPH" title="How decisions connect to evidence" action="Source-linked memory"/>
            {selectedGraph ? <div className="kbGraphLayout">
              <div className="kbGraphCanvas">
                <div className="graphColumn graphTeams"><span>DEPARTMENTS</span>{[...new Set(decisions.slice(0,6).map(item=>item.department))].map(item=><button key={item} onClick={()=>selectView(item)}>{item}</button>)}</div>
                <div className="graphColumn graphMemory"><span>DECISIONS</span>{decisions.slice(0,6).map(item=><button className={selectedGraph.id===item.id?"active":""} onClick={()=>setGraphId(item.id)} key={item.id}><b>{item.title}</b><small>{item.sources.length} receipt{item.sources.length===1?"":"s"}</small></button>)}</div>
                <div className="graphColumn graphSources"><span>EVIDENCE</span>{sourceKinds.slice(0,6).map(item=><b key={item}>{item}</b>)}</div>
              </div>
              <aside><span>SELECTED MEMORY</span><h3>{selectedGraph.title}</h3><p>{truncate(selectedGraph.verifiedText,180)}</p>{selectedGraph.latestInput&&<div className="kbLatestInput"><small>HERMES LATEST LAYER</small><p>{truncate(selectedGraph.latestInput,120)}</p></div>}<dl><div><dt>Owner</dt><dd>{selectedGraph.owner}</dd></div><div><dt>Updated</dt><dd>{formatRelative(selectedGraph.latestAt)}</dd></div><div><dt>Sources</dt><dd>{selectedGraph.sources.map(source=>source.kind).join(" · ")}</dd></div></dl><Link href={decisionPath(selectedGraph.id)}>Open decision timeline →</Link></aside>
            </div>:<EmptyState/>}
          </section>

          <section className="kbDepartmentGrid"><PanelHeader eyebrow="DEPARTMENTS" title="Knowledge by team" action={`${activeDepartments.length} active`}/><div>{departments.map(department=>{const items=decisions.filter(item=>item.department===department);return <button key={department} onClick={()=>selectView(department)}><i>{icon(department)}</i><div><b>{department}</b><span>{items[0]?.title??"No indexed activity"}</span></div><em>{items.length}</em></button>})}</div></section>
        </> : <DepartmentView department={selectedDepartment!} decisions={departmentDecisions}/>}
      </div>
    </section>
  </main>;
}

function SetupPanel({connectedProviders}:{connectedProviders:string[]}) { const google=connectedProviders.includes("google"),slack=connectedProviders.includes("slack"); return <section className="kbSetup"><div><span>GET STARTED</span><h2>Bring your company memory online</h2><p>Install Found, pair this browser, then approve each company source explicitly.</p><Link href="/integrations">Continue setup →</Link></div><ol><li className="done"><b>1</b><span>Found account<small>Signed in</small></span></li><li><b>2</b><span>Browser extension<small>Install and pair</small></span></li><li className={google?"done":""}><b>3</b><span>Google Workspace<small>{google?"Authorised":"Read-only consent"}</small></span></li><li className={slack?"done":""}><b>4</b><span>Slack<small>{slack?"Authorised":"Public channels"}</small></span></li></ol></section>; }
function DepartmentView({department,decisions}:{department:Department;decisions:DecisionMemory[]}) { return <section className="kbDepartment"><div className="kbDepartmentHeader"><div><span>{department.toUpperCase()} / CURRENT MEMORY</span><h2>{departmentHeading(department)}</h2></div><dl><div><dt>Decisions</dt><dd>{decisions.length}</dd></div><div><dt>Updated this week</dt><dd>{decisions.filter(item=>withinDays(item.latestAt,7)).length}</dd></div><div><dt>Source types</dt><dd>{new Set(decisions.flatMap(item=>item.sources.map(source=>source.kind))).size}</dd></div></dl></div><div className="kbRegistry"><PanelHeader eyebrow="DECISION REGISTRY" title="Latest verified knowledge" action="Newest first"/>{decisions.length?decisions.map(item=><DecisionRow decision={item} key={item.id}/>):<EmptyState/>}</div></section>; }
function DecisionRow({decision,rank}:{decision:DecisionMemory;rank?:number}) { const sourceUrl=decision.sources[0]?.url; return <article className="kbDecisionRow"><span>{rank?String(rank).padStart(2,"0"):icon(decision.department)}</span><div><div><em>{decision.department}</em><small>{decision.status}</small></div><h3>{sourceUrl?<a href={sourceUrl} target="_blank" rel="noreferrer">{decision.title} ↗</a>:<Link href={decisionPath(decision.id)}>{decision.title}</Link>}</h3><p>{truncate(decision.verifiedText,130)}</p></div><aside><b>{decision.sources.length}</b><small>receipts</small><time>{formatRelative(decision.latestAt)}</time><Link href={decisionPath(decision.id)}>Memory →</Link></aside></article>; }
function SearchResults({query,results}:{query:string;results:DecisionMemory[]}) { return <section className="kbSearchResults"><PanelHeader eyebrow={`RESULTS FOR “${query}”`} title={`${results.length} matching decisions`} action="Company knowledge only"/>{results.length?results.map(item=><DecisionRow decision={item} key={item.id}/>):<p>I couldn’t find enough evidence in company knowledge to answer this.</p>}</section>; }
function PanelHeader({eyebrow,title,action}:{eyebrow:string;title:string;action:string}) { return <header className="kbPanelHeader"><div><span>{eyebrow}</span><h2>{title}</h2></div><small>{action}</small></header>; }
function Metric({label,value,detail}:{label:string;value:string;detail:string}) { return <article><span>{label}</span><b>{value}</b><p>{detail}</p></article>; }
function EmptyState() { return <div className="workspaceEmpty"><h3>No classified memory yet.</h3><p>Connect an approved source or capture a page from the Found extension.</p><Link href="/integrations">Manage sources →</Link></div>; }

function searchDecisions(items:DecisionMemory[],query:string):DecisionMemory[] { const terms=query.toLowerCase().split(/\W+/).filter(term=>term.length>2); if(!terms.length)return[]; return items.map(item=>({item,score:terms.reduce((score,term)=>score+(item.title.toLowerCase().includes(term)?4:`${item.latestText} ${item.verifiedText} ${item.department} ${item.owner}`.toLowerCase().includes(term)?1:0),0)})).filter(result=>result.score>=2).sort((a,b)=>b.score-a.score).slice(0,8).map(result=>result.item); }
function departmentHeading(department:Department):string { return ({Product:"What customers need—and what we decided.",GTM:"Campaign intelligence that compounds.",Sales:"Client evidence before the next call.",Engineering:"Implementation memory before the next PR.",Research:"Signals worth carrying into the roadmap.",Browser:"The web, connected to company context."})[department]; }
function departmentDescription(department:Department):string { return ({Product:"Approved choices, rejected alternatives, experiments, and the newest context attached by the team.",GTM:"Campaign results, positioning decisions, and reusable patterns grouped by the work they influence.",Sales:"Customer signals, proof-of-value criteria, and account intelligence retained with their receipts.",Engineering:"Architecture choices, existing implementations, and operational learning across code and conversation.",Research:"Competitor moves, articles, and market evidence deliberately captured by the team.",Browser:"Items saved from the web and strong organisational matches surfaced while the team browses."})[department]; }
function icon(view:View):string { return ({Overview:"⌂",Product:"P",GTM:"G",Sales:"S",Engineering:"E",Research:"R",Browser:"B"})[view]; }
function safeClass(value:string|undefined):string { return String(value??"source").toLowerCase().replace(/[^a-z0-9]+/g,""); }
function record(externalId:string,department:string,title:string,authorName:string,status:string,source:string,sourceUrl:string,body:string,sourceUpdatedAt:string):WorkspaceKnowledgeRecord { return {externalId,department,title,authorName,status,source,sourceUrl,body,sourceUpdatedAt}; }
function truncate(value:string,max:number):string { const clean=value.replace(/\s+/g," ").trim(); return clean.length>max?`${clean.slice(0,max-1).trim()}…`:clean; }
function withinDays(value:string,days:number):boolean { const time=Date.parse(value); return !Number.isNaN(time)&&Date.now()-time<=days*86400000; }
function formatRelative(value:string):string { const time=Date.parse(value); if(Number.isNaN(time))return"Time not indexed"; const days=Math.max(0,Math.floor((Date.now()-time)/86400000)); return days===0?"Today":days===1?"Yesterday":`${days}d ago`; }
function initials(value:string):string { return value.split(/\s+/).map(part=>part[0]).join("").slice(0,2).toUpperCase()||"U"; }
function firstName(value:string):string { return value.trim().split(/\s+/)[0]||"there"; }
function greeting():string { const hour=new Date().getHours(); return hour<12?"morning":hour<18?"afternoon":"evening"; }

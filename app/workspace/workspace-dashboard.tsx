"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import type { MemoryUpdate, WorkspaceKnowledgeRecord } from "../../lib/auth/workspace";

const views = ["Overview", "Executive", "Product", "GTM", "Sales", "Engineering", "Research", "Browser"] as const;
type View = typeof views[number];
const demoRecords = [
  {team:"Product",title:"Dynamic security deposits for trusted renters",owner:"Rohan Desai",state:"Approved",source:"Notion · RLP-101",sourceUrl:"https://app.notion.com/p/39b630edf61f811fb5c2fb52bd1b2507",keys:"deposit trusted clean returns"},
  {team:"Product",title:"Fit confidence and backup-size reservation",owner:"Ananya Sharma",state:"Discovery complete",source:"Notion · RLP-102",sourceUrl:"https://app.notion.com/p/39b630edf61f81428907d392653ae37f",keys:"fit backup adjacent size"},
  {team:"GTM",title:"Wedding Wardrobe Week",owner:"Aarav Shah",state:"13.9× ROAS",source:"Slack · #gtm-ideas",sourceUrl:"https://newworkspace-2bk3073.slack.com/archives/C0BGVQAPU0L",keys:"wedding campaign roas itinerary"},
  {team:"GTM",title:"Customer measurement and proof-of-value problem",owner:"Rhea Bose",state:"Evidence confirmed",source:"Slack · #sales-floor",sourceUrl:"https://newworkspace-2bk3073.slack.com/archives/C0BGVQC999S/p1783839807897629",keys:"measurement roi proof value pilot"},
  {team:"Engineering",title:"Progressive delivery guardrails",owner:"Leena Rao",state:"Implementation approved",source:"Slack · LOOP-42",sourceUrl:"https://app.slack.com/client/T08LC40MYVB/C0BGU0STURX",keys:"canary rollback feature flag deployment"},
  {team:"Engineering",title:"Developer portal and service maturity scorecards",owner:"Vikram Rao",state:"Pilot running",source:"Slack · ENG-214",sourceUrl:"https://app.slack.com/client/T08LC40MYVB/C0BGU0STURX",keys:"harness portal catalog scorecard"},
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
  memoryUpdates: MemoryUpdate[];
  records: WorkspaceKnowledgeRecord[];
  workspaceName: string;
};

const executiveTrends = [
  {change:"3 linked sources",department:"Product",impact:"Checkout policy",momentum:"03",owner:"Rohan Desai",source:"Notion · Slack · RLP-101",sourceUrl:"https://app.notion.com/p/39b630edf61f811fb5c2fb52bd1b2507",title:"Trusted renters move to a lower deposit after five clean returns"},
  {change:"2 linked sources",department:"Sales",impact:"Pilot policy",momentum:"02",owner:"Rhea Bose",source:"Slack · #sales-floor",sourceUrl:"https://newworkspace-2bk3073.slack.com/archives/C0BGVQC999S/p1783839807897629",title:"Paid proof-of-value replaces default free pilots"},
  {change:"3 linked sources",department:"Engineering",impact:"Release policy",momentum:"03",owner:"Leena Rao",source:"Slack · Jira LOOP-42 · Code",sourceUrl:"https://app.slack.com/client/T08LC40MYVB/C0BGU0STURX",title:"Progressive delivery guardrails become the shared release path"},
];

const graphNodes = [
  {id:"deposit",label:"Trusted renter deposit",kind:"DECISION",className:"kgDeposit",sourceUrl:"https://app.notion.com/p/39b630edf61f811fb5c2fb52bd1b2507"},
  {id:"measurement",label:"Proof-of-value metric",kind:"CUSTOMER SIGNAL",className:"kgMeasurement",sourceUrl:"https://newworkspace-2bk3073.slack.com/archives/C0BGVQC999S/p1783839807897629"},
  {id:"portal",label:"Developer portal",kind:"INITIATIVE",className:"kgPortal",sourceUrl:"https://app.slack.com/client/T08LC40MYVB/C0BGU0STURX"},
  {id:"slack",label:"Slack",kind:"SOURCE",className:"kgSlack",sourceUrl:"https://app.slack.com/client/T08LC40MYVB/C0BGU0STURX"},
  {id:"docs",label:"Google Docs",kind:"SOURCE",className:"kgDocs",sourceUrl:"https://docs.google.com/document/d/1eh7J9rAhvuWYWuB8MD-A3h97MAFWhYRtysFI53ABBYE"},
  {id:"code",label:"Code",kind:"SOURCE",className:"kgCode",sourceUrl:"https://github.com/Pratiksha935/echocheck-engineering-demo"},
];

export default function WorkspaceDashboard({connectedCount,demoMode,displayName,memoryUpdates,records,workspaceName}:Props) {
  const [view,setView]=useState<View>("Overview");
  const [graphFocus,setGraphFocus]=useState("deposit");
  const [query,setQuery]=useState("");
  const [submitted,setSubmitted]=useState("");
  const companyRecords=useMemo(()=>{
    const base=demoMode?demoRecords:records.map(item=>({
      team:item.department??"Company",title:item.title,owner:item.authorName??"Unknown owner",state:item.status,source:`${item.source} · ${item.externalId}`,sourceKind:item.source,sourceUrl:item.sourceUrl,keys:`${item.title} ${item.body} ${item.department??""}`
    }));
    const updates=memoryUpdates.map(item=>({team:"Company",title:item.currentTitle,owner:"Company update",state:"Latest memory layer",source:`${item.origin.toUpperCase()} · VERSIONED UPDATE`,sourceKind:item.origin,sourceUrl:item.sourceUrl,keys:`${item.currentTitle} ${item.updateText}`}));
    return [...updates,...base];
  },[demoMode,memoryUpdates,records]);
  const trending=useMemo(()=>demoMode?executiveTrends:buildExecutiveTrends(companyRecords),[companyRecords,demoMode]);
  const activeGraphNodes=useMemo(()=>demoMode?graphNodes:[...companyRecords.slice(0,3).map((item,index)=>({id:`memory-${index}`,label:item.title,kind:"MEMORY",className:["kgDeposit","kgMeasurement","kgPortal"][index],sourceUrl:item.sourceUrl})),...Array.from(new Set(records.map(item=>item.source))).slice(0,4).map((source,index)=>({id:`source-${index}`,label:source,kind:"SOURCE",className:["kgSlack","kgDocs","kgJira","kgCode"][index],sourceUrl:records.find(item=>item.source===source)?.sourceUrl??"/workspace"}))],[companyRecords,demoMode,records]);
  const selectedGraphNode=activeGraphNodes.find(node=>node.id===graphFocus)??activeGraphNodes[0];
  const matches=useMemo(()=>rankMatches(companyRecords,submitted),[companyRecords,submitted]);
  const departmentRecords=useMemo(()=>companyRecords.filter(item=>item.team.toLowerCase()===view.toLowerCase()),[companyRecords,view]);
  const visibleRecords=useMemo(()=>view==="Overview"?curateOverview(companyRecords):departmentRecords.slice(0,6),[companyRecords,departmentRecords,view]);
  const visibleTotal=view==="Overview"?companyRecords.length:departmentRecords.length;
  function search(event:FormEvent){event.preventDefault();setSubmitted(query.trim())}
  function selectView(item:View){
    setView(item);
    setSubmitted("");
    window.scrollTo({top:0,behavior:"smooth"});
  }
  return <main className="foundWorkspace">
    <aside className="wsRail"><Link href="/" className="wsLogo">Found<span>.</span></Link><nav>{views.map(item=><button key={item} className={view===item?"active":""} onClick={()=>selectView(item)}><i/>{item}</button>)}</nav><div><Link href="/integrations">Connect sources ↗</Link><small>{demoMode?"Demo memory":`${connectedCount} source${connectedCount===1?"":"s"} connected`}</small></div></aside>
    <section className="wsMain">
      <header className="wsTop"><div><span>{workspaceName.toUpperCase()} / COMPANY INTELLIGENCE</span><b>{view}</b></div><div><i/> {demoMode?"DEMO MEMORY":"PRIVATE WORKSPACE"} <strong>{displayName}</strong></div></header>
      <section className="wsHero"><p>THE GENERAL INTELLIGENCE OF YOUR COMPANY</p><h1>Everything your team<br/>has already learned.</h1><form onSubmit={search}><input aria-label="Search company knowledge" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Ask about a decision, campaign, customer insight, or code…"/><button>Find it ↗</button></form></section>
      {submitted&&<section className="wsResults" aria-live="polite"><header><span>FOUND IN COMPANY MEMORY</span><b>{matches.length} strong matches</b></header>{matches.length?matches.map(item=><article key={item.title}><span>{item.team}</span><div><h3>{item.title}</h3><p>{item.owner} · {item.source}</p></div><a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.state} ↗</a></article>):<p>No strong prior work found. Found stays silent on weak matches.</p>}</section>}
      <section className="wsMetrics"><article><span>MEMORY RECORDS</span><b>{demoMode?"18":String(records.length).padStart(2,"0")}</b><p>Across approved sources</p></article><article><span>CONNECTED SOURCES</span><b>{demoMode?"05":String(connectedCount).padStart(2,"0")}</b><p>Workspace-authorised</p></article><article><span>EVIDENCE LINKS</span><b>{demoMode?"94%":records.length?"100%":"—"}</b><p>Original sources retained</p></article><article><span>WORKSPACE MODE</span><b>{demoMode?"CV1":"ACL"}</b><p>{demoMode?"Seeded product demo":"Tenant isolated"}</p></article></section>
      {memoryUpdates.length>0&&<section className="wsUpdateBanner"><span>MEMORY CHANGED</span><div><b>{memoryUpdates[0].currentTitle}</b><p>{memoryUpdates[0].updateText}</p></div><a href={memoryUpdates[0].sourceUrl} target="_blank" rel="noreferrer">VERIFY ORIGINAL ↗</a></section>}
      {(view==="Overview"||view==="Executive")&&<section className="wsExecutive">
        <header><div><span>EXECUTIVE PULSE · TODAY</span><h2>Trending decisions<br/>across the company.</h2></div><p>Ranked by retained evidence, source diversity and the latest verified memory layers—not by message volume alone.</p></header>
        <div className="wsTrendGrid">{trending.map((item,index)=><a href={item.sourceUrl} target="_blank" rel="noreferrer" key={item.title} className={index===0?"lead":""}><div><span>{item.department}</span><em>{item.change}</em></div><h3>{item.title}</h3><p>{item.owner} · {item.source}</p><footer><span>{item.impact}</span><b>{item.momentum}</b></footer></a>)}</div>
        <div className="wsPulseGrid"><article><span>SOURCED ACTIVITY · TODAY</span><div className="wsPulseBars">{[54,78,66,92].map((height,index)=><i key={index} style={{height:`${height}%`}}/>)}</div><footer><small>EARLIER</small><b>4 verified changes shown</b><small>LATEST</small></footer></article><article className="wsChangeFeed"><span>LATEST VERIFIED CHANGES</span>{[
          ["NEW","Product","Deposit experiment approved","Notion + Slack"],
          ["NEW","Sales","POV metric attached to pilot","Slack"],
          ["LINK","Engineering","Canary contract reused","Jira + Code"],
          ["DATA","GTM","Wedding campaign benchmarked","Sheet"],
        ].map(item=><div key={item[0]}><time>{item[0]}</time><p><b>{item[1]}</b>{item[2]}</p><small>{item[3]}</small></div>)}</article></div>
      </section>}
      {(view==="Overview"||view==="Executive")&&<section className="wsKnowledgeGraph"><header><span>ORGANISATIONAL KNOWLEDGE GRAPH</span><div><h2>See how the company<br/>reached a decision.</h2><p>Every node keeps its source receipt. Select an idea to inspect the evidence network around it.</p></div></header><div className="kgLayout"><div className="kgCanvas" aria-label="Interactive company knowledge graph"><i className="kgLine kgL1"/><i className="kgLine kgL2"/><i className="kgLine kgL3"/><i className="kgLine kgL4"/><i className="kgLine kgL5"/>{activeGraphNodes.map(node=><button type="button" onClick={()=>setGraphFocus(node.id)} className={`kgNode ${node.className} ${graphFocus===node.id?"active":""}`} key={node.id}><span>{node.kind}</span><b>{node.label}</b></button>)}</div><aside><span>SELECTED MEMORY</span><h3>{selectedGraphNode?.label??"Connect a source"}</h3><p>{graphFocus==="deposit"?"Three Slack conversations and three linked records converge on the same approved intervention: reduce the hold after five clean returns.":"This node is connected through retained source evidence and its latest append-only memory updates."}</p><dl><div><dt>CONNECTED EVIDENCE</dt><dd>{graphFocus==="deposit"?"06":"04"}</dd></div><div><dt>LATEST LAYER</dt><dd>{memoryUpdates.length?"New update":"Latest indexed"}</dd></div><div><dt>CONFIDENCE</dt><dd>{demoMode?"94%":"Evidence linked"}</dd></div></dl><a href={selectedGraphNode?.sourceUrl??"/workspace"} target="_blank" rel="noreferrer">OPEN ORIGINAL SOURCE ↗</a></aside></div></section>}
      {!demoMode&&<section className="wsSection wsLiveMemory"><header><span>{view.toUpperCase()} MEMORY · {visibleRecords.length} OF {visibleTotal}</span><h2>{records.length?"The few records that change the next decision.":"Connect a source to begin."}</h2></header>{visibleRecords.length?<><div className="wsLiveRecords">{visibleRecords.map(item=><article key={`${item.source}-${item.title}`}><span>{item.team}</span><div><h3><a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.title}</a></h3><p>{item.owner} · {item.source}</p></div><b>{item.state}</b></article>)}</div>{visibleTotal>visibleRecords.length&&<p className="wsRecordNote">Showing the highest-signal records. Search reaches all {visibleTotal} approved memories.</p>}</>:<div className="wsEmpty"><p>No company records are visible in this department.</p><Link href="/integrations">Manage Slack and Google Workspace ↗</Link></div>}</section>}
      {demoMode&&(view==="Overview"||view==="Product")&&<section className="wsSection"><header><span>PRODUCT MEMORY</span><h2>Decisions before<br/>feature requests.</h2></header><div className="wsDecision"><div><span>P0 · CONFLICT DETECTED</span><h3>“Zero deposit for everyone” is already a known dead end.</h3><p>The approved path is a 50% lower hold after five clean returns. The blanket zero-deposit campaign was stopped.</p><a className="wsDecisionSource" href="https://app.notion.com/p/39b630edf61f811fb5c2fb52bd1b2507" target="_blank" rel="noreferrer">VERIFY ORIGINAL DECISION ↗</a></div><aside><b>94%</b><span>SAME IDEA</span><dl><div><dt>OWNER</dt><dd>Rohan Desai</dd></div><div><dt>STATUS</dt><dd>Experiment approved</dd></div><div><dt>SOURCES</dt><dd>Notion · Slack · RLP-101</dd></div></dl></aside></div></section>}
      {demoMode&&(view==="Overview"||view==="GTM")&&<section className="wsSection wsGtm"><header><span>GTM INTELLIGENCE</span><h2>What worked.<br/>What did not.</h2></header><div className="wsCampaigns"><article><b>33.6×</b><span>Return & Earn</span><i style={{width:"100%"}}/></article><article><b>13.9×</b><span>Wedding Wardrobe Week</span><i style={{width:"62%"}}/></article><article><b>4.4×</b><span>Trust Your Rental</span><i style={{width:"27%"}}/></article><article><b>1.3×</b><span>Office Edit Trial</span><i style={{width:"8%"}}/></article></div></section>}
      {demoMode&&(view==="Overview"||view==="Engineering")&&<section className="wsSection"><header><span>ENGINEERING MEMORY</span><h2>Reuse the behavior.<br/>Not just the file.</h2></header><div className="wsCode"><article><span>LOOP-42</span><code>createCanaryPlan()</code><p>packages/release-guard/src/canary.ts</p><b>Leena Rao ↗</b></article><article><span>ENG-214</span><code>resolveServiceOwner()</code><p>services/catalog/src/ownership.ts</p><b>Vikram Rao ↗</b></article><article><span>LOOP-63</span><code>extract_failure_taxonomy()</code><p>tools/incident-linker/index.py</p><b>Kabir Malhotra ↗</b></article></div><Link className="wsModuleLink" href="/code-review">Open PR duplicate guard ↗</Link></section>}
      {demoMode&&(view==="Overview"||view==="Research")&&<section className="wsSection"><header><span>LINK DUMP</span><h2>Save it now.<br/>Find it when it matters.</h2></header><div className="wsLinks">{links.map(item=><article key={item.title}><span>{item.kind}</span><h3>{item.title}</h3><p>{item.owner}</p><b>{item.tag}</b><i>↗</i></article>)}</div><button className="wsAdd">+ ADD ARTICLE, REPOSITORY, OR COMPETITOR LINK</button></section>}
      {demoMode&&(view==="Overview"||view==="Browser")&&<section className="wsBrowser"><div><span>BROWSER INTELLIGENCE</span><h2>Found follows the idea,<br/>not your browsing history.</h2><p>On supported articles, the extension checks page meaning against approved company memory and surfaces only strong matches.</p><Link href="/demo-article">Open article demo ↗</Link></div><article><span>96% · PRIOR WORK</span><h3>Developer portal and service maturity scorecards</h3><p>Vikram Rao is already running this pilot.</p><a href="https://app.slack.com/client/T08LC40MYVB/C0BGU0STURX" target="_blank" rel="noreferrer">VERIFY IN SLACK ↗</a></article></section>}
    </section>
  </main>
}

function curateOverview<T extends { sourceKind?: string; team: string }>(items: T[]): T[] {
  const perTeam = new Map<string, number>();
  const sourcePairs = new Set<string>();
  return items.filter(item => {
    const count = perTeam.get(item.team) ?? 0;
    if (count >= 2) return false;
    const pair = `${item.team}:${item.sourceKind ?? "demo"}`;
    if (sourcePairs.has(pair)) return false;
    perTeam.set(item.team, count + 1);
    sourcePairs.add(pair);
    return true;
  }).slice(0, 8);
}

function buildExecutiveTrends<T extends { owner:string; source:string; sourceUrl:string; team:string; title:string }>(items:T[]) {
  const groups=new Map<string,{count:number;item:T;sources:Set<string>}>();
  for(const item of items){
    const key=item.title.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
    const group=groups.get(key);
    if(group){group.count+=1;group.sources.add(item.source)}else{groups.set(key,{count:1,item,sources:new Set([item.source])})}
  }
  return [...groups.values()].sort((a,b)=>b.sources.size-a.sources.size||b.count-a.count).slice(0,3).map(group=>({
    change:`${group.count} linked record${group.count===1?"":"s"}`,
    department:group.item.team,
    impact:"Company memory",
    momentum:String(group.sources.size).padStart(2,"0"),
    owner:group.item.owner,
    source:[...group.sources].join(" · "),
    sourceUrl:group.item.sourceUrl,
    title:group.item.title,
  }));
}

const SEARCH_STOP_WORDS = new Set(["about","after","again","already","could","from","have","into","should","that","their","there","these","this","what","when","where","which","with","would"]);

function rankMatches<T extends { keys: string; title: string }>(items: T[], query: string): T[] {
  const terms = [...new Set(query.toLowerCase().split(/\W+/).filter(term => term.length > 3 && !SEARCH_STOP_WORDS.has(term)))];
  if (!terms.length) return [];
  return items.map(item => {
    const title = item.title.toLowerCase();
    const evidence = item.keys.toLowerCase();
    const score = terms.reduce((total, term) => total + (title.includes(term) ? 3 : evidence.includes(term) ? 1 : 0), 0);
    const matchedTerms = terms.filter(term => evidence.includes(term)).length;
    return { item, matchedTerms, score };
  }).filter(result => result.score >= 2 && (result.matchedTerms >= 2 || result.score >= 3))
    .sort((a,b) => b.score - a.score)
    .slice(0,6)
    .map(result => result.item);
}

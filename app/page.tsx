"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Memory = { id:string; cluster:string; title:string; excerpt:string; department:string; source:"Slack"|"Notion"|"Jira"|"GitHub"|"Campaign CSV"; owner:string; status:string; url:string; keywords:string[]; };

const memory: Memory[] = [
  {id:"KB-001",cluster:"DEP-TRUST",title:"Dynamic security deposits for trusted renters",excerpt:"Approved pilot: reduce the refundable hold by 50% after five clean returns, with loss-rate guardrails.",department:"Product",source:"Notion",owner:"Rohan Desai",status:"Experiment approved",url:"https://app.notion.com/p/39b630edf61f811fb5c2fb52bd1b2507",keywords:["deposit","clean returns","trusted","hold","repeat"]},
  {id:"RLP-101",cluster:"DEP-TRUST",title:"Trust-score service and deposit multiplier",excerpt:"Implementation uses successful returns, late rate, damage claims, payment failures and account age.",department:"Engineering",source:"Jira",owner:"Rohan Desai",status:"In progress",url:"https://jira.example.com/browse/RLP-101",keywords:["deposit","risk","multiplier","clean returns"]},
  {id:"KB-004",cluster:"FIT-BACKUP",title:"Fit confidence and backup-size reservation",excerpt:"Reserve one adjacent size only when fit confidence is low. Universal two-size ordering was rejected on margin.",department:"Product",source:"Notion",owner:"Ananya Sharma",status:"Discovery complete",url:"https://app.notion.com/p/39b630edf61f81428907d392653ae37f",keywords:["fit","size","adjacent","backup","brand"]},
  {id:"KB-008",cluster:"WED-ITIN",title:"Event itinerary beats a generic wedding discount",excerpt:"Seven of nine interviews preferred one haldi-to-reception itinerary over a flat bundle discount.",department:"GTM",source:"Slack",owner:"Nisha Kapoor",status:"Decision",url:"https://app.slack.com/client/T08LC40MYVB/C0BGVQAPU0L",keywords:["wedding","itinerary","campaign","discount","haldi"]},
  {id:"CMP-009",cluster:"GTM-WEDDING",title:"Wedding Wardrobe Week",excerpt:"₹2.8L spend · ₹38.8L revenue · 702 paid orders · 13.9× ROAS. Mumbai and Bengaluru drove 72%.",department:"GTM",source:"Campaign CSV",owner:"Aarav Shah",status:"Completed",url:"#campaigns",keywords:["wedding","campaign","itinerary","roas","mumbai"]},
  {id:"CMP-012",cluster:"DEP-TRUST",title:"Deposit-Free Forever",excerpt:"Stopped after weak conversion and a policy mismatch. Zero deposit for everyone attracted risk without qualified demand.",department:"GTM",source:"Campaign CSV",owner:"Devika Menon",status:"Stopped",url:"#campaigns",keywords:["deposit","zero","campaign","failed"]},
  {id:"ENG-001",cluster:"CODE-PRICE",title:"calculateDepositMultiplier()",excerpt:"Production service already computes risk-adjusted holds and reason codes. Extend feature flags instead of forking.",department:"Engineering",source:"GitHub",owner:"Ishaan Verma",status:"Production",url:"https://github.com/example/reloop/blob/main/services/risk/deposit.ts",keywords:["deposit","function","calculator","clean returns","hold"]},
  {id:"ENG-003",cluster:"CODE-SEARCH",title:"isServiceableForEvent()",excerpt:"Shared guard checks inspection, cleaning, transit and event-date feasibility before relevance scoring.",department:"Engineering",source:"GitHub",owner:"Vikram Rao",status:"Production",url:"https://github.com/example/reloop/blob/main/services/search/isServiceable.ts",keywords:["search","filter","delivery","wedding","serviceable","cleaning"]},
  {id:"KB-011",cluster:"RETURN-NUDGE",title:"Event-aware pickup reminders",excerpt:"14 of 38 late-return contacts confused courier pickup with warehouse receipt. Pilot one-tap rescheduling before fees.",department:"Customer Success",source:"Notion",owner:"Kabir Malhotra",status:"Experiment designed",url:"https://app.notion.com/p/39b630edf61f81c38937db2a0e1a3cdb",keywords:["return","pickup","reminder","late","courier"]},
  {id:"ENG-214",cluster:"HARNESS-IDP",title:"Developer portal and service maturity scorecards",excerpt:"Platform Engineering is piloting a unified catalog, ownership metadata, scorecards and paved deployment paths inspired by Harness and Backstage.",department:"Engineering",source:"Jira",owner:"Vikram Rao",status:"Pilot running",url:"https://app.slack.com/client/T08LC40MYVB/C0BGU0STURX",keywords:["harness","developer portal","service catalog","scorecard","golden path"]},
  {id:"LOOP-42",cluster:"LOOP-DELIVERY",title:"Progressive delivery guardrails",excerpt:"Shared feature flags, canary cohorts, health verification and one-click rollback for high-risk releases.",department:"Engineering",source:"Slack",owner:"Leena Rao",status:"Implementation approved",url:"https://app.slack.com/client/T08LC40MYVB/C0BGU0STURX",keywords:["feature flag","canary","progressive delivery","rollback","verification"]},
  {id:"LOOP-57",cluster:"LOOP-METRICS",title:"Engineering effectiveness baseline",excerpt:"Service-level DORA metrics with explicit guardrails against individual developer scoring.",department:"Engineering",source:"Notion",owner:"Maya Singh",status:"Baseline complete",url:"https://app.slack.com/client/T08LC40MYVB/C0BGU0STURX",keywords:["dora","lead time","change failure","deployment frequency","developer productivity"]},
  {id:"LOOP-63",cluster:"LOOP-INCIDENTS",title:"Incident-learning knowledge graph",excerpt:"Connect postmortems with services, owners, runbooks and repeated failure modes before new work starts.",department:"Engineering",source:"GitHub",owner:"Kabir Malhotra",status:"Pilot running",url:"https://app.slack.com/client/T08LC40MYVB/C0BGU0STURX",keywords:["incident","postmortem","root cause","runbook","operational readiness"]},
];

const prompts=["What if customers with five clean returns paid a smaller security deposit?","Which wedding campaign converted best, and why?","Build a function that filters outfits unable to arrive before the wedding."];

type SavedLink={id:string;url:string;title:string;note:string;tags:string;owner:string;kind:"Employee link"|"Competitor watch"|"Code reference";};
const seedLinks:SavedLink[]=[
  {id:"RES-001",url:"https://www.renttherunway.com/",title:"Rent the Runway membership and reserve model",note:"Competitor uses membership benefits and reservation windows to reduce repeat-rental friction.",tags:"competitor membership rental retention",owner:"Nisha Kapoor",kind:"Competitor watch"},
  {id:"RES-002",url:"https://github.com/example/reloop/blob/main/services/risk/deposit.ts",title:"Shared risk-adjusted deposit service",note:"Production implementation for trusted-renter deposit multipliers. Reuse before creating checkout risk code.",tags:"code deposit risk clean returns multiplier",owner:"Ishaan Verma",kind:"Code reference"},
  {id:"RES-003",url:"https://www.mckinsey.com/industries/retail/our-insights",title:"Circular retail and recommerce research",note:"Useful market evidence for rental trust, reverse logistics, and customer adoption discussions.",tags:"article circular retail trust reverse logistics",owner:"Meera Iyer",kind:"Employee link"},
];

function findMatches(q:string){const words=q.toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>3);return memory.map(m=>({...m,score:m.keywords.reduce((n,k)=>n+(q.toLowerCase().includes(k)||words.some(w=>k.includes(w)||w.includes(k))?1:0),0)})).filter(m=>m.score>0).sort((a,b)=>b.score-a.score).slice(0,4);}

export default function Home(){
  const [query,setQuery]=useState(""); const [submitted,setSubmitted]=useState(""); const [dept,setDept]=useState("All");
  const [links,setLinks]=useState<SavedLink[]>(seedLinks); const [linkUrl,setLinkUrl]=useState(""); const [linkTitle,setLinkTitle]=useState(""); const [linkNote,setLinkNote]=useState(""); const [linkTags,setLinkTags]=useState("");
  useEffect(()=>{const saved=localStorage.getItem("echocheck-research-links");if(saved){try{setLinks(JSON.parse(saved))}catch{}}},[]);
  useEffect(()=>{localStorage.setItem("echocheck-research-links",JSON.stringify(links))},[links]);
  const matches=useMemo(()=>findMatches(submitted||query),[submitted,query]);
  const externalMatches=useMemo(()=>{const terms=(submitted||query).toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>3);return links.filter(x=>terms.some(t=>`${x.title} ${x.note} ${x.tags}`.toLowerCase().includes(t))).slice(0,3)},[submitted,query,links]);
  const isQuestion=/^(which|why|how|what did|show me|find)/i.test((submitted||query).trim());
  const filtered=dept==="All"?memory:memory.filter(x=>x.department===dept);
  function run(e:FormEvent){e.preventDefault();setSubmitted(query.trim());}
  function saveLink(e:FormEvent){e.preventDefault();if(!linkUrl.trim()||!linkTitle.trim())return;setLinks(v=>[{id:`RES-${String(v.length+1).padStart(3,"0")}`,url:linkUrl.trim(),title:linkTitle.trim(),note:linkNote.trim()||"Saved for future prior-art checks.",tags:linkTags.trim(),owner:"You",kind:"Employee link"},...v]);setLinkUrl("");setLinkTitle("");setLinkNote("");setLinkTags("");}
  return <main className="app" id="top">
    <nav className="rail">
      <a className="logo" href="#top"><span>EC</span><b>ECHOCHECK</b></a>
      <div className="railLinks"><a className="on" href="#search">01<br/><b>ASK</b></a><a href="#insights">02<br/><b>INSIGHTS</b></a><a href="#memory">03<br/><b>MEMORY</b></a><a href="#campaigns">04<br/><b>CAMPAIGNS</b></a><a href="#research">05<br/><b>RESEARCH</b></a><a href="/code-review">06<br/><b>PR GUARD</b></a><a href="/integrations">07<br/><b>CONNECT</b></a></div>
      <div className="railFoot"><i/> LIVE<br/>HERMES + SLACK</div>
    </nav>

    <section className="stage">
      <header className="mast"><p>RELOOP / ORGANISATIONAL INTELLIGENCE</p><p>18 RECORDS · 5 SOURCES · UPDATED NOW</p></header>
      <section className="hero" id="search">
        <div className="heroIndex">01 / ASK EVERYTHING</div>
        <h1>Your company<br/>already knows.</h1>
        <p className="lede">EchoCheck catches repeated ideas before work begins, answers from scattered evidence, and turns team memory into the next useful action.</p>
        <form className="ask" onSubmit={run}>
          <textarea aria-label="Ask EchoCheck" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Propose an idea, ask what worked, or describe code you plan to build…"/>
          <button><span className="askLabel">Search memory</span><span className="askArrow">↗</span></button>
        </form>
        <div className="promptRow">{prompts.map((p,i)=><button key={p} onClick={()=>{setQuery(p);setSubmitted(p)}}><span>0{i+1}</span>{p}</button>)}</div>
      </section>

      {submitted&&<section className="resultScene" aria-live="polite">
        <div className="scanline"><span>HERMES TRACE</span><i/><b>INTENT → RETRIEVE → JUDGE → RESPOND</b></div>
        <div className="verdict">
          <div><small>{isQuestion?"ANSWER FROM MEMORY":matches.length?"PRIOR WORK FOUND":"NEW SIGNAL"}</small><h2>{isQuestion?"Here is what the organisation already learned.":matches.length?"Pause. This has been explored before.":"No meaningful prior work found."}</h2></div>
          <div className="confidence"><b>{matches.length?Math.min(96,78+matches[0].score*4):"—"}{matches.length&&"%"}</b><span>{isQuestion?"evidence coverage":"semantic match"}</span></div>
        </div>
        {isQuestion&&submitted.toLowerCase().includes("wedding")&&<div className="answer"><span>THE PATTERN</span><p><b>Wedding Wardrobe Week</b> was the strongest conversion campaign: 702 orders and 13.9× ROAS. Itinerary-led creative won because it solved coordination across haldi, mehendi, sangeet and reception—not merely price. Scale Mumbai and Bengaluru, while fixing niche-size inventory.</p></div>}
        <div className="evidenceGrid">{matches.map((m,i)=><a href={m.url} target={m.url.startsWith("http")?"_blank":undefined} rel="noreferrer" className="evidence" key={m.id}><div><span>0{i+1} / {m.source.toUpperCase()}</span><em>{m.status}</em></div><h3>{m.title}</h3><p>{m.excerpt}</p><footer><b>{m.owner}</b><span>OPEN SOURCE ↗</span></footer></a>)}</div>
        {externalMatches.length>0&&<div className="researchHits"><span>EXTERNAL RESEARCH + CODE MATCHES</span>{externalMatches.map(x=><a href={x.url} target="_blank" rel="noreferrer" key={x.id}><b>{x.kind}</b><strong>{x.title}</strong><p>{x.note}</p><em>{x.owner} · {x.tags}</em></a>)}</div>}
      </section>}

      <section className="insights" id="insights">
        <div className="sectionHead"><span>02 / PROACTIVE INSIGHTS</span><h2>What needs<br/>attention now.</h2><p>Not another dashboard. A ranked queue of decisions your data is asking the team to make.</p></div>
        <div className="storyGrid">
          <article className="story giant"><span>P0 · CONFLICT</span><h3>“Zero deposit for everyone” is a known dead end.</h3><p>CMP-012 failed on conversion and policy fit. The approved alternative is a 50% lower hold after five clean returns.</p><div className="storyFoot">OWNER / ROHAN DESAI <a href="https://app.notion.com/p/39b630edf61f811fb5c2fb52bd1b2507">VIEW DECISION ↗</a></div></article>
          <article className="story metric"><span>GTM / WINNER</span><b>13.9×</b><h3>Wedding itinerary ROAS</h3><p>72% of paid orders came from Mumbai and Bengaluru.</p></article>
          <article className="story code"><span>ENGINEERING / REUSE</span><pre>calculateDepositMultiplier()</pre><h3>Already in production.</h3><p>Intercept the next duplicate PR and point it to the shared risk service.</p></article>
        </div>
      </section>

      <section className="memorySection" id="memory">
        <div className="sectionHead horizontal"><span>03 / SEARCHABLE MEMORY</span><h2>One index.<br/>Sources intact.</h2><p>EchoCheck keeps the normalized record. Slack, Notion, Jira, GitHub and campaign files keep the detail.</p></div>
        <div className="deptTabs">{["All","Product","GTM","Engineering","Customer Success"].map(d=><button className={dept===d?"active":""} onClick={()=>setDept(d)} key={d}>{d}</button>)}</div>
        <div className="memoryTable"><div className="tableHead"><span>ID / SOURCE</span><span>MEMORY</span><span>OWNER</span><span>STATE</span></div>{filtered.map(m=><a href={m.url} key={m.id}><span><b>{m.id}</b><small>{m.source}</small></span><span><b>{m.title}</b><small>{m.department} · {m.cluster}</small></span><span>{m.owner}</span><span>{m.status} ↗</span></a>)}</div>
      </section>

      <section className="campaigns" id="campaigns"><div><span>04 / GTM MEMORY</span><h2>Learn from every launch.</h2></div><div className="bars"><p><span>RETURN & EARN</span><i style={{width:"100%"}}/><b>33.6×</b></p><p><span>WEDDING WARDROBE WEEK</span><i style={{width:"62%"}}/><b>13.9×</b></p><p><span>TRUST YOUR RENTAL</span><i style={{width:"27%"}}/><b>4.4×</b></p><p><span>OFFICE EDIT TRIAL</span><i style={{width:"8%"}}/><b>1.3×</b></p></div><p className="campaignNote">Ask why campaigns failed, what message won, who owned it, and what to try next. Every answer links back to evidence.</p></section>
      <section className="research" id="research">
        <div className="sectionHead"><span>05 / RESEARCH INBOX</span><h2>Dump it here.<br/>Find it later.</h2><p>Articles, competitor pages, social posts, repositories, PRs and technical references become searchable evidence for future feature requests.</p></div>
        <div className="researchLayout">
          <form className="linkForm" onSubmit={saveLink}><div><label>URL *</label><input type="url" value={linkUrl} onChange={e=>setLinkUrl(e.target.value)} placeholder="https://…" required/></div><div><label>TITLE *</label><input value={linkTitle} onChange={e=>setLinkTitle(e.target.value)} placeholder="What is useful here?" required/></div><div><label>CONTEXT</label><textarea value={linkNote} onChange={e=>setLinkNote(e.target.value)} placeholder="Why should the team remember this?"/></div><div><label>TAGS</label><input value={linkTags} onChange={e=>setLinkTags(e.target.value)} placeholder="deposit competitor checkout code"/></div><button>SAVE TO ORGANISATIONAL MEMORY ↗</button></form>
          <div className="watchPanel"><div className="watchTitle"><span>COMPETITOR WATCH</span><b>3 MONITORS ACTIVE</b></div><article><i className="watchLive"/><div><b>Rent the Runway</b><p>Product pages, pricing and membership changes</p></div><em>DAILY</em></article><article><i className="watchLive"/><div><b>Leadership social feeds</b><p>Permitted LinkedIn/Twitter feeds and announcements</p></div><em>6 HOURS</em></article><article><i className="watchLive"/><div><b>Engineering releases</b><p>GitHub repositories, changelogs and package updates</p></div><em>HOURLY</em></article><small>Collection uses official APIs, RSS, public changelogs or approved feeds. Each finding is deduplicated and linked to its original source.</small></div>
        </div>
        <div className="linkDump">{links.map(x=><a href={x.url} target="_blank" rel="noreferrer" key={x.id}><span>{x.id}<small>{x.kind}</small></span><div><b>{x.title}</b><p>{x.note}</p></div><em>{x.owner}<small>{x.tags}</small></em><strong>↗</strong></a>)}</div>
        <div className="codeFlow"><span>CODE-SAFE PRIOR ART</span><p><b>PR description</b> → behavior extraction → GitHub/Jira/docs/link-dump retrieval → semantic code match → existing symbol + owner + reuse guidance.</p></div>
      </section>
      <footer className="footer"><b>ECHOCHECK</b><p>YOUR COMPANY’S LAST SOURCE OF TRUTH.</p><a href="#top">BACK TO TOP ↑</a></footer>
    </section>
  </main>
}

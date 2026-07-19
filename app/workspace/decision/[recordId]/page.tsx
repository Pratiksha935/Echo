import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireFoundUser } from "../../../auth";
import type { MemoryUpdate, WorkspaceKnowledgeRecord } from "../../../../lib/auth/workspace";
import { getFoundWorkspace, getWorkspaceKnowledgeRecord, listMemoryUpdates, listWorkspaceKnowledgeRecords } from "../../../../lib/auth/workspace";
import type { DecisionMemory } from "../../../../lib/workspace/intelligence";
import { buildDecisionMemory, canonicalUrl, classifyDepartment, formatMoment, normaliseTitle } from "../../../../lib/workspace/intelligence";
import { readHermesKnowledgeNormalization } from "../../../../lib/workspace/knowledge-normalization";
import { presentKnowledgeRecord, summarizeKnowledgeText, type KnowledgePresentation } from "../../../../lib/workspace/presentation";

export const dynamic = "force-dynamic";

export default async function DecisionTimelinePage({params}:{params:Promise<{recordId:string}>}) {
  const {recordId:rawRecordId}=await params;
  const recordId=decodeRecordId(rawRecordId);
  const user=await requireFoundUser(`/workspace/decision/${encodeURIComponent(recordId)}`);
  const workspace=await getFoundWorkspace();
  if(!workspace) notFound();
  const [recentRecords,exactRecord,updates]=await Promise.all([listWorkspaceKnowledgeRecords(workspace.organisationId,200),getWorkspaceKnowledgeRecord(workspace.organisationId,recordId),listMemoryUpdates(workspace.organisationId)]);
  const records=exactRecord&&recentRecords.every(record=>record.externalId!==exactRecord.externalId)?[exactRecord,...recentRecords]:recentRecords;
  const decisions=buildDecisionMemory(records,updates);
  const decision=decisions.find(item=>item.id===recordId||item.sources.some(source=>source.externalId===recordId))??(exactRecord?exactRecordDecision(exactRecord,updates):null);
  if(!decision) redirect("/workspace");
  const sourceIds=new Set(decision.sources.map(source=>source.externalId));
  const sourceEvents=records.filter(record=>sourceIds.has(record.externalId)).map(record=>({actor:record.authorName??"Source owner not indexed",at:record.sourceUpdatedAt,body:presentKnowledgeRecord(record).summary,kind:record.source,label:record.status,url:record.sourceUrl}));
  const updateEvents=decision.updates.map(update=>({actor:update.actorUserId===user.id?user.email:"Team member",at:update.createdAt,body:update.updateText,kind:update.origin==="slack"?"Slack update":"Team update",label:"Append-only memory",url:update.sourceUrl}));
  const timeline=[...sourceEvents,...updateEvents].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
  const uniqueReceipts=decision.sources.filter((source,index,all)=>all.findIndex(item=>canonicalUrl(item.url)===canonicalUrl(source.url))===index);
  const verifiedSummary=decision.presentation.summary;
  const askFoundHref=`/workspace?ask=${encodeURIComponent(`What does company knowledge say about ${decision.title}?`)}`;

  return <main className="decisionPage">
    <nav><Link href="/workspace">Found<span>.</span></Link><div><span>{workspace.organisationName.toUpperCase()} / {decision.department}</span><b>KNOWLEDGE TIMELINE</b></div><Link href="/workspace">Back to workspace ↗</Link></nav>
    <header className="decisionHero"><div><span>{decision.status}</span><h1>{decision.title}</h1><p>{verifiedSummary}</p></div><dl><div><dt>OWNER</dt><dd>{decision.owner}</dd></div><div><dt>DEPARTMENT</dt><dd>{decision.department}</dd></div><div><dt>LATEST ACTIVITY</dt><dd>{formatMoment(decision.latestAt)}</dd></div><div><dt>EVIDENCE SOURCES</dt><dd>{uniqueReceipts.length}</dd></div></dl></header>
    <section className="decisionBody">
      <div className="timeline"><header><span>NEWEST FIRST</span><h2>How this memory evolved.</h2><p>Team updates are overlays. Slack messages, Docs, spreadsheet rows and other source records remain untouched and directly verifiable.</p></header><StructuredEvidence presentation={decision.presentation}/>{timeline.map((event,index)=><article key={`${event.kind}-${event.at}-${index}`}><time>{formatMoment(event.at)}</time><i/><div><span>{event.kind} · {event.label} · {event.actor}</span><p>{summarizeKnowledgeText(event.body)}</p><a href={event.url} target="_blank" rel="noreferrer">Verify source receipt ↗</a></div></article>)}</div>
      <aside className="decisionAside"><span>{decision.presentation.eyebrow}</span><h2>{verifiedSummary}</h2><p>Source-backed company knowledge remains separate from user input. The original source receipt stays directly verifiable.</p>{decision.latestInput&&<div className="kbLatestInput"><small>LATEST TEAM INPUT</small><p>{summarizeKnowledgeText(decision.latestInput)}</p><small>{formatMoment(decision.latestAt)} · retained in timeline</small></div>}<div><span>UNIQUE RECEIPTS</span>{uniqueReceipts.map(source=><a href={source.url} target="_blank" rel="noreferrer" key={`${source.kind}-${source.externalId}`}><b>{source.kind}</b><small>{formatMoment(source.recordedAt)}</small><em>↗</em></a>)}</div><div className="decisionAskFound"><span>ASK FOUND</span><p>Ask a private, source-grounded question about this knowledge record. Hermes answers only from indexed company memory.</p><Link href={askFoundHref}>ASK FOUND ABOUT THIS RECORD ↗</Link></div><Link href={`/memory/correct?${new URLSearchParams({record_id:decision.id,title:decision.title,source_url:uniqueReceipts[0]?.url??"https://sage-profiterole-3b1c22.netlify.app/workspace"})}`}>APPEND TEAM CONTEXT ↗</Link></aside>
    </section>
  </main>;
}

function decodeRecordId(value:string):string {
  let current=value;
  for(let index=0;index<2;index+=1) {
    try {
      const decoded=decodeURIComponent(current);
      if(decoded===current) break;
      current=decoded;
    } catch {
      break;
    }
  }
  return current;
}

function exactRecordDecision(record:WorkspaceKnowledgeRecord,updates:MemoryUpdate[]):DecisionMemory {
  const titleKey=normaliseTitle(record.title);
  const relatedUpdates=updates.filter(update=>update.sourceRecordId===record.externalId||normaliseTitle(update.currentTitle)===titleKey)
    .sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
  const latestUpdate=relatedUpdates[0];
  const presentation=presentKnowledgeRecord(record);
  const normalized=readHermesKnowledgeNormalization(record.metadata);
  return {
    department: classifyDepartment(record.department, `${record.title} ${record.body} ${record.source}`),
    id: record.externalId,
    latestAt: latestUpdate?.createdAt??record.sourceUpdatedAt,
    latestInput: latestUpdate?.updateText??null,
    latestText: latestUpdate?.updateText??presentation.summary,
    owner: normalized?.owner??readableMetadata(record.metadata.owner)??record.authorName??"Owner not indexed",
    presentation,
    sources: [{externalId:record.externalId,kind:record.source,recordedAt:record.sourceUpdatedAt,summary:presentation.summary,url:record.sourceUrl}],
    status: latestUpdate?"Team input added":normalized?.status??record.status,
    title: presentation.title,
    updates: relatedUpdates,
    verifiedText: presentation.summary,
  };
}

function StructuredEvidence({presentation}:{presentation:KnowledgePresentation}) {
  if(presentation.kind!=="spreadsheet"||!presentation.fields.length)return null;
  if(presentation.rows.length<=1)return <section className="decisionStructured"><span>READABLE FIELDS</span><dl>{presentation.fields.map(field=><div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl></section>;
  return <section className="decisionStructured"><span>READABLE ROWS</span><div className="knowledgeTable"><table><thead><tr>{presentation.columns.map(column=><th key={column}>{column}</th>)}</tr></thead><tbody>{presentation.rows.map((row,rowIndex)=><tr key={rowIndex}>{presentation.columns.map((column,columnIndex)=><td key={`${column}-${columnIndex}`}>{row[columnIndex]||"—"}</td>)}</tr>)}</tbody></table></div></section>;
}

function readableMetadata(value:unknown):string|null {
  if(typeof value==="string"||typeof value==="number"||typeof value==="boolean")return String(value).trim()||null;
  return null;
}

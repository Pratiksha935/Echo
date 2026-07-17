import Link from "next/link";
import { notFound } from "next/navigation";
import { requireFoundUser } from "../../../auth";
import { getFoundWorkspace, listMemoryUpdates, listWorkspaceKnowledgeRecords } from "../../../../lib/auth/workspace";
import { buildDecisionMemory, canonicalUrl, formatMoment, normaliseTitle } from "../../../../lib/workspace/intelligence";

export const dynamic = "force-dynamic";

export default async function DecisionTimelinePage({params}:{params:Promise<{recordId:string}>}) {
  const {recordId}=await params;
  const user=await requireFoundUser(`/workspace/decision/${encodeURIComponent(recordId)}`);
  const workspace=await getFoundWorkspace();
  if(!workspace) notFound();
  const [records,updates]=await Promise.all([listWorkspaceKnowledgeRecords(workspace.organisationId,200),listMemoryUpdates(workspace.organisationId)]);
  const decisions=buildDecisionMemory(records,updates);
  const decision=decisions.find(item=>item.id===recordId||item.sources.some(source=>source.externalId===recordId));
  if(!decision) notFound();
  const titleKey=normaliseTitle(decision.title);
  const sourceEvents=records.filter(record=>normaliseTitle(record.title)===titleKey).map(record=>({actor:record.authorName??"Source owner not indexed",at:record.sourceUpdatedAt,body:record.body,kind:record.source,label:record.status,url:record.sourceUrl}));
  const updateEvents=decision.updates.map(update=>({actor:update.actorUserId===user.id?user.email:"Team member",at:update.createdAt,body:update.updateText,kind:update.origin==="slack"?"Slack update":"Team update",label:"Append-only memory",url:update.sourceUrl}));
  const timeline=[...sourceEvents,...updateEvents].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
  const uniqueReceipts=decision.sources.filter((source,index,all)=>all.findIndex(item=>canonicalUrl(item.url)===canonicalUrl(source.url))===index);

  return <main className="decisionPage">
    <nav><Link href="/workspace">Found<span>.</span></Link><div><span>{workspace.organisationName.toUpperCase()} / {decision.department}</span><b>DECISION TIMELINE</b></div><Link href="/workspace">Back to workspace ↗</Link></nav>
    <header className="decisionHero"><div><span>{decision.status}</span><h1>{decision.title}</h1><p>{decision.latestText}</p></div><dl><div><dt>OWNER</dt><dd>{decision.owner}</dd></div><div><dt>DEPARTMENT</dt><dd>{decision.department}</dd></div><div><dt>LATEST VERIFIED LAYER</dt><dd>{formatMoment(decision.latestAt)}</dd></div><div><dt>EVIDENCE SOURCES</dt><dd>{uniqueReceipts.length}</dd></div></dl></header>
    <section className="decisionBody">
      <div className="timeline"><header><span>NEWEST FIRST</span><h2>How this memory evolved.</h2><p>Team updates are overlays. Slack messages, Docs and other source records remain untouched and directly verifiable.</p></header>{timeline.map((event,index)=><article key={`${event.kind}-${event.at}-${index}`}><time>{formatMoment(event.at)}</time><i/><div><span>{event.kind} · {event.label} · {event.actor}</span><p>{event.body}</p><a href={event.url} target="_blank" rel="noreferrer">Verify source receipt ↗</a></div></article>)}</div>
      <aside className="decisionAside"><span>CURRENT TRUTH</span><h2>{decision.latestText}</h2><p>Found uses this newest layer when the decision appears in search or a browser battlecard.</p><div><span>UNIQUE RECEIPTS</span>{uniqueReceipts.map(source=><a href={source.url} target="_blank" rel="noreferrer" key={`${source.kind}-${source.externalId}`}><b>{source.kind}</b><small>{formatMoment(source.recordedAt)}</small><em>↗</em></a>)}</div><Link href={`/memory/correct?${new URLSearchParams({record_id:decision.id,title:decision.title,source_url:uniqueReceipts[0]?.url??"https://sage-profiterole-3b1c22.netlify.app/workspace"})}`}>ADD A VERIFIED UPDATE ↗</Link></aside>
    </section>
  </main>;
}

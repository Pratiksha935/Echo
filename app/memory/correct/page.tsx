import Link from "next/link";
import { requireFoundUser } from "../../auth";

export const dynamic = "force-dynamic";

type Params = { correction?: string; record_id?: string; source_url?: string; title?: string };

export default async function CorrectMemoryPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const returnTo = `/memory/correct?${new URLSearchParams(cleanParams(params))}`;
  const user = await requireFoundUser(returnTo);
  const recordId = clean(params.record_id, 120);
  const title = clean(params.title, 180);
  const correction = clean(params.correction, 800);
  const sourceUrl = safeSourceUrl(params.source_url);

  return <main className="memoryReview">
    <nav><Link href="/workspace">Found<span>.</span></Link><span>MEMORY UPDATE / SOURCE-PRESERVING</span><b>{user.displayName}</b></nav>
    <section className="memoryReviewGrid">
      <div className="memoryReviewStory">
        <span>THE ORIGINAL EVIDENCE STAYS UNTOUCHED</span>
        <h1>Add what changed.<br/>Keep the receipt.</h1>
        <p>Found stores this as a new layer of organisational memory. It never edits the Google Doc, Slack thread, Jira ticket or code asset underneath it.</p>
        <a href={sourceUrl} target="_blank" rel="noreferrer">Open original source ↗</a>
      </div>
      <form className="memoryReviewForm" action="/api/memory/update" method="post">
        <span>REVIEW BEFORE ADDING</span>
        <h2>{title || "Memory update"}</h2>
        <input type="hidden" name="recordId" value={recordId}/>
        <input type="hidden" name="title" value={title}/>
        <input type="hidden" name="sourceUrl" value={sourceUrl}/>
        <label>What should Found remember now?
          <textarea name="updateText" maxLength={800} minLength={12} defaultValue={correction} required/>
        </label>
        <div className="memoryPromise"><i/>Original source retained <i/>New version timestamped <i/>Future retrievals use the latest layer</div>
        <button type="submit">ADD TO FOUND MEMORY <b>↗</b></button>
        <small>This update is attributed to {user.email}. It becomes a versioned overlay and can be traced back to this source.</small>
      </form>
    </section>
  </main>;
}

function clean(value: string | undefined, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanParams(params: Params): Record<string, string> {
  return Object.fromEntries(Object.entries(params).filter((entry): entry is [string,string] => typeof entry[1] === "string"));
}

function safeSourceUrl(value: string | undefined): string {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" ? url.toString() : "https://sage-profiterole-3b1c22.netlify.app/workspace";
  } catch {
    return "https://sage-profiterole-3b1c22.netlify.app/workspace";
  }
}

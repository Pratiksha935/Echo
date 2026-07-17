import type { MemoryUpdate, WorkspaceKnowledgeRecord } from "../auth/workspace";

export const departments = ["Product", "GTM", "Sales", "Engineering", "Research", "Browser"] as const;
export type Department = typeof departments[number];

export type DecisionSource = {
  externalId: string;
  kind: string;
  recordedAt: string;
  summary: string;
  url: string;
};

export type DecisionMemory = {
  department: Department;
  id: string;
  latestAt: string;
  latestText: string;
  owner: string;
  sources: DecisionSource[];
  status: string;
  title: string;
  updates: MemoryUpdate[];
};

export function buildDecisionMemory(records: WorkspaceKnowledgeRecord[], updates: MemoryUpdate[]): DecisionMemory[] {
  const grouped = new Map<string, WorkspaceKnowledgeRecord[]>();
  for (const record of records) {
    const key = normaliseTitle(record.title);
    grouped.set(key, [...(grouped.get(key) ?? []), record]);
  }
  return [...grouped.values()].map(group => {
    const ordered = [...group].sort((a,b) => time(b.sourceUpdatedAt) - time(a.sourceUpdatedAt));
    const latest = ordered[0];
    const relatedUpdates = updates.filter(update => normaliseTitle(update.currentTitle) === normaliseTitle(latest.title) || ordered.some(record => record.externalId === update.sourceRecordId))
      .sort((a,b) => time(b.createdAt) - time(a.createdAt));
    const latestUpdate = relatedUpdates[0];
    const sources = uniqueSources(ordered.map(record => ({ externalId:record.externalId,kind:record.source,recordedAt:record.sourceUpdatedAt,summary:record.body,url:record.sourceUrl })));
    return {
      department: classifyDepartment(latest.department, `${latest.title} ${latest.body} ${latest.source}`),
      id: latest.externalId,
      latestAt: latestUpdate?.createdAt ?? latest.sourceUpdatedAt,
      latestText: latestUpdate?.updateText ?? latest.body,
      owner: latest.authorName ?? "Owner not indexed",
      sources,
      status: latestUpdate ? "Updated memory" : latest.status,
      title: latest.title,
      updates: relatedUpdates,
    };
  }).sort((a,b) => time(b.latestAt) - time(a.latestAt));
}

export function classifyDepartment(value: string | null, evidence = ""): Department {
  const explicit = departments.find(department => department.toLowerCase() === value?.trim().toLowerCase());
  if (explicit) return explicit;
  const text = `${value ?? ""} ${evidence}`.toLowerCase();
  if (/browser|article|web research/.test(text)) return "Browser";
  if (/research|competitor|market intelligence/.test(text)) return "Research";
  if (/engineer|platform|developer|code|incident|deployment/.test(text)) return "Engineering";
  if (/sales|customer|pipeline|proof.of.value|client|account/.test(text)) return "Sales";
  if (/gtm|growth|marketing|campaign|acquisition|activation/.test(text)) return "GTM";
  return "Product";
}

export function decisionPath(id: string): string {
  return `/workspace/decision/${encodeURIComponent(id)}`;
}

export function formatMoment(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time not indexed";
  return new Intl.DateTimeFormat("en", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" }).format(date);
}

export function normaliseTitle(value: string): string {
  return value.toLowerCase().replace(/^\[[^\]]+\]\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();
}

export function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.replace(/\/$/, "");
  } catch { return value; }
}

function uniqueSources(items: DecisionSource[]): DecisionSource[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = canonicalUrl(item.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function time(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

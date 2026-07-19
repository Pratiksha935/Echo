export const HERMES_KNOWLEDGE_NORMALIZATION_VERSION = "hermes-knowledge-v1";

export type HermesKnowledgeFact = {
  label: string;
  value: string;
};

export type HermesKnowledgeNormalization = {
  entities: string[];
  facts: HermesKnowledgeFact[];
  nextAction: string | null;
  owner: string | null;
  status: string | null;
  summary: string | null;
  title: string | null;
  type: string | null;
  version: string | null;
};

export type ValidatedHermesKnowledgeNormalization = HermesKnowledgeNormalization & {
  summary: string;
  title: string;
  type: string;
  version: typeof HERMES_KNOWLEDGE_NORMALIZATION_VERSION;
};

const NORMALIZATION_KEYS = new Set(["version", "type", "title", "summary", "facts", "entities", "owner", "status", "nextAction"]);
const NORMALIZATION_TYPES = new Set(["decision", "document", "article", "conversation", "sheet_row", "spreadsheet", "order_record", "source_record"]);

/**
 * Reads the bounded, source-derived presentation contract produced by Hermes at
 * ingestion time. Rendering never calls Hermes and safely falls back when the
 * contract is absent or malformed; the original knowledge record stays intact.
 */
export function readHermesKnowledgeNormalization(metadata?: Record<string, unknown> | null): HermesKnowledgeNormalization | null {
  const value = metadata?.normalized;
  if (!isObject(value)) return null;

  const facts = readFacts(value.facts).slice(0, 12);
  const entities = (Array.isArray(value.entities) ? value.entities : [])
    .map(item => readValue(item))
    .filter(Boolean)
    .slice(0, 12);
  const result: HermesKnowledgeNormalization = {
    entities,
    facts,
    nextAction: readOptional(value.nextAction ?? value.next_action, 160),
    owner: readOptional(value.owner, 120),
    status: readOptional(value.status, 120),
    summary: readOptional(value.summary, 320),
    title: readOptional(value.title, 160),
    type: readOptional(value.type, 80),
    version: readOptional(value.version, 80),
  };
  return Object.values(result).some(item => Array.isArray(item) ? item.length : item) ? result : null;
}

export function parseHermesKnowledgeNormalizationResponse(response: string): ValidatedHermesKnowledgeNormalization {
  if (response.length > 20_000) throw new HermesNormalizationMalformedError();
  let value: unknown;
  try {
    value = JSON.parse(response);
  } catch {
    throw new HermesNormalizationMalformedError();
  }
  if (!isObject(value) || Object.keys(value).some(key => !NORMALIZATION_KEYS.has(key))) throw new HermesNormalizationMalformedError();
  if (value.version !== HERMES_KNOWLEDGE_NORMALIZATION_VERSION) throw new HermesNormalizationMalformedError();
  if (!requiredString(value.type) || !NORMALIZATION_TYPES.has(value.type)) throw new HermesNormalizationMalformedError();
  if (!requiredString(value.title) || !requiredString(value.summary)) throw new HermesNormalizationMalformedError();
  if (!Array.isArray(value.facts) || value.facts.length > 12 || !value.facts.every(isStrictFact)) throw new HermesNormalizationMalformedError();
  if (!Array.isArray(value.entities) || value.entities.length > 12 || !value.entities.every(item => requiredString(item))) throw new HermesNormalizationMalformedError();
  for (const key of ["owner", "status", "nextAction"] as const) {
    if (value[key] !== undefined && value[key] !== null && !requiredString(value[key])) throw new HermesNormalizationMalformedError();
  }

  const normalized = readHermesKnowledgeNormalization({ normalized: value });
  if (!normalized?.type || !normalized.title || !normalized.summary) throw new HermesNormalizationMalformedError();
  return {
    ...normalized,
    version: HERMES_KNOWLEDGE_NORMALIZATION_VERSION,
    type: normalized.type,
    title: normalized.title,
    summary: normalized.summary,
  };
}

export class HermesNormalizationMalformedError extends Error {
  constructor() { super("Hermes normalization was malformed."); }
}

function readFacts(value: unknown): HermesKnowledgeFact[] {
  if (isObject(value)) return Object.entries(value).map(([label, fact]) => ({ label: readValue(label), value: readValue(fact) })).filter(validFact);
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!isObject(item)) return [];
    const label = readValue(item.label ?? item.name ?? item.key ?? item.header);
    const fact = readValue(item.value ?? item.content ?? item.text);
    return label && fact ? [{ label, value: fact }] : [];
  });
}

function validFact(fact: HermesKnowledgeFact): boolean {
  return Boolean(fact.label && fact.value);
}

function isStrictFact(value: unknown): boolean {
  return isObject(value)
    && Object.keys(value).length === 2
    && Object.keys(value).every(key => key === "label" || key === "value")
    && requiredString(value.label)
    && requiredString(value.value);
}

function requiredString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.replace(/\s+/g, " ").trim());
}

function readOptional(value: unknown, max: number): string | null {
  const result = readValue(value, max);
  return result || null;
}

function readValue(value: unknown, max = 160): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return compact(String(value), max);
  if (Array.isArray(value)) return compact(value.map(item => readValue(item, 80)).filter(Boolean).join(", "), max);
  return "";
}

function compact(value: string, max: number): string {
  const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

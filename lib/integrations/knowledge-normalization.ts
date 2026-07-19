import { HermesUnavailableError, queryHermes } from "../hermes/client";
import {
  HermesNormalizationMalformedError,
  parseHermesKnowledgeNormalizationResponse,
} from "../workspace/knowledge-normalization";
import { buildHermesNormalizationPrompt, type NormalizationSourceRecord } from "../workspace/knowledge-normalization-prompt";
import { serviceRest } from "./service-rest";

type NormalizationJob = {
  attempts: number;
  job_id: string;
  knowledge_record_id: string;
  organisation_id: string;
  version: number;
};

export async function drainKnowledgeNormalizationQueue(limit = 3): Promise<{ attempted: number; failed: number; succeeded: number; superseded: number }> {
  const jobs = await serviceRest<NormalizationJob[]>("/rpc/claim_knowledge_normalization_jobs", {
    body: JSON.stringify({ p_limit: Math.min(Math.max(limit, 1), 10) }),
    method: "POST",
  });
  const results = await Promise.all(jobs.map(processNormalizationJob));
  return {
    attempted: jobs.length,
    failed: results.filter(result => result === "failed").length,
    succeeded: results.filter(result => result === "succeeded").length,
    superseded: results.filter(result => result === "superseded").length,
  };
}

async function processNormalizationJob(job: NormalizationJob): Promise<"failed" | "succeeded" | "superseded"> {
  try {
    const records = await serviceRest<NormalizationSourceRecord[]>(
      `/knowledge_records?select=id,source,title,body,author_name,department,metadata&organisation_id=eq.${encodeURIComponent(job.organisation_id)}&id=eq.${encodeURIComponent(job.knowledge_record_id)}&limit=1`,
    );
    const record = records[0];
    if (!record) throw new NormalizationRecordMissingError();
    const response = await queryHermes(buildHermesNormalizationPrompt(record), job.organisation_id);
    const normalized = parseHermesKnowledgeNormalizationResponse(response);
    const completed = await serviceRest<boolean>("/rpc/complete_knowledge_normalization_job", {
      body: JSON.stringify({ p_job_id: job.job_id, p_version: job.version, p_normalized: normalized }),
      method: "POST",
    });
    return completed ? "succeeded" : "superseded";
  } catch (error) {
    await scheduleRetry(job, normalizationErrorCode(error));
    return "failed";
  }
}

async function scheduleRetry(job: NormalizationJob, errorCode: string): Promise<void> {
  const retryAfterSeconds = Math.min(3_600, 30 * (2 ** Math.min(Math.max(job.attempts - 1, 0), 7)));
  await serviceRest("/rpc/fail_knowledge_normalization_job", {
    body: JSON.stringify({
      p_error_code: errorCode,
      p_job_id: job.job_id,
      p_retry_after_seconds: retryAfterSeconds,
      p_version: job.version,
    }),
    method: "POST",
  }).catch(() => undefined);
}

function normalizationErrorCode(error: unknown): string {
  if (error instanceof HermesUnavailableError) return "normalization_hermes_unavailable";
  if (error instanceof HermesNormalizationMalformedError) return "normalization_hermes_malformed";
  if (error instanceof NormalizationRecordMissingError) return "normalization_record_missing";
  return "normalization_worker_failed";
}

class NormalizationRecordMissingError extends Error {}

import fs from "fs/promises";

import { getJobDir } from "@/lib/paths";

export type JobStatus = "queued" | "processing" | "completed" | "failed";

export type JobRecord = {
  status: JobStatus;
  progress: number;
  step: string;
  error?: string;
  downloadPath?: string;
  /** Zaman damgalı metin satırları: komutlar, ffmpeg/whisper çıktısı özeti. */
  logs: string[];
  createdAt: number;
  completedAt?: number;
};

const jobs = new Map<string, JobRecord>();
const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

const DEFAULT_TTL_MS = 45 * 60 * 1000;

/** Uzun videolarda Whisper segment satırları çok olabilir. */
const MAX_JOB_LOG_LINES = 20_000;

export function getJob(jobId: string): JobRecord | undefined {
  return jobs.get(jobId);
}

export function setJob(jobId: string, record: JobRecord): void {
  jobs.set(jobId, record);
}

export function updateJob(
  jobId: string,
  patch: Partial<Omit<JobRecord, "createdAt">>
): void {
  const cur = jobs.get(jobId);
  if (!cur) return;
  jobs.set(jobId, { ...cur, ...patch });
}

/**
 * İş günlüğüne satır ekler; aynı satır sunucu konsoluna da yazılır.
 */
export function appendJobLog(jobId: string, message: string): void {
  const cur = jobs.get(jobId);
  if (!cur) return;
  const ts = new Date().toISOString();
  const line = `${ts}  ${message}`;
  const prev = cur.logs ?? [];
  const next = [...prev, line];
  const logs =
    next.length > MAX_JOB_LOG_LINES ? next.slice(-MAX_JOB_LOG_LINES) : next;
  jobs.set(jobId, { ...cur, logs });
  console.log(`[subframe ${jobId.slice(0, 8)}] ${message}`);
}

export function createJobRecord(jobId: string): JobRecord {
  const rec: JobRecord = {
    status: "queued",
    progress: 0,
    step: "Sırada",
    logs: [],
    createdAt: Date.now(),
  };
  jobs.set(jobId, rec);
  return rec;
}

export function scheduleJobDeletion(
  jobId: string,
  ttlMs: number = DEFAULT_TTL_MS
): void {
  const existing = cleanupTimers.get(jobId);
  if (existing) clearTimeout(existing);

  const t = setTimeout(() => {
    cleanupTimers.delete(jobId);
    void deleteJobFiles(jobId);
  }, ttlMs);
  cleanupTimers.set(jobId, t);
}

export async function deleteJobFiles(jobId: string): Promise<void> {
  const t = cleanupTimers.get(jobId);
  if (t) {
    clearTimeout(t);
    cleanupTimers.delete(jobId);
  }
  jobs.delete(jobId);
  try {
    await fs.rm(getJobDir(jobId), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

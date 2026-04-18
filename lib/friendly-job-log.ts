import { appendJobLog } from "@/lib/job-store";

/** Görsel ayırıcı (iş günlüğü panelinde bölüm başlığı gibi) */
export const LOG_RULE =
  "────────────────────────────────────────────────────────";

export function logBlank(jobId: string): void {
  appendJobLog(jobId, "");
}

export function logRule(jobId: string): void {
  appendJobLog(jobId, LOG_RULE);
}

/**
 * Yeni bölüm: boş satır + emoji başlık + çizgi.
 * Örnek: logSection(jobId, "🎬", "Video hazır")
 */
export function logSection(jobId: string, emoji: string, title: string): void {
  logBlank(jobId);
  appendJobLog(jobId, `${emoji}  ${title}`);
  appendJobLog(jobId, LOG_RULE);
}

export function logBullet(jobId: string, text: string): void {
  appendJobLog(jobId, `   • ${text}`);
}

export function logOk(jobId: string, text: string): void {
  appendJobLog(jobId, `   ✅ ${text}`);
}

export function logWait(jobId: string, text: string): void {
  appendJobLog(jobId, `   ⏳ ${text}`);
}

export function logWarn(jobId: string, text: string): void {
  appendJobLog(jobId, `   ⚠️ ${text}`);
}

export function logError(jobId: string, text: string): void {
  appendJobLog(jobId, `   ❌ ${text}`);
}

/** Teknik detay (komut, yol) — isterseniz diye */
export function logTech(jobId: string, text: string): void {
  appendJobLog(jobId, `   ▸ ${text}`);
}

export function logNote(jobId: string, text: string): void {
  appendJobLog(jobId, `   💡 ${text}`);
}

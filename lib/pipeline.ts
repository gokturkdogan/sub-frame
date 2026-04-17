import fs from "fs/promises";

import {
  appendJobLog,
  createJobRecord,
  getJob,
  scheduleJobDeletion,
  updateJob,
} from "@/lib/job-store";
import { getJobPaths } from "@/lib/paths";
import { subtitleLanguageTag } from "@/lib/lang";
import { extractAudio, muxSoftSubtitles } from "@/workers/ffmpeg";
import { transcribeTurkishToSrt } from "@/workers/whisper";
import { translateSrtFile } from "@/workers/translate";

const TTL_MS = Number(process.env.JOB_TTL_MS) || 45 * 60 * 1000;
const FAIL_TTL_MS = 10 * 60 * 1000;

/**
 * Uzun süren adımlarda ekran donmasın diye, gerçek tamamlanma gelene kadar
 * yüzdeyi yalnızca `ceiling` değerine kadar yavaşça artırır (tahmini, abartısız).
 */
function startBoundedProgressPulse(
  jobId: string,
  ceiling: number,
  intervalMs: number
): () => void {
  const id = setInterval(() => {
    const cur = getJob(jobId);
    if (!cur || cur.status !== "processing") return;
    if (cur.progress >= ceiling) return;
    updateJob(jobId, {
      progress: Math.min(ceiling, cur.progress + 1),
    });
  }, intervalMs);
  return () => clearInterval(id);
}

export async function runPipeline(jobId: string, targetLang: string): Promise<void> {
  const p = getJobPaths(jobId);

  const progress = (n: number, step: string) => {
    updateJob(jobId, {
      status: "processing",
      progress: n,
      step,
    });
  };

  try {
    appendJobLog(
      jobId,
      `İşlem hattı: hedef dil=${targetLang}, klasör=${p.dir}`
    );
    progress(18, "Ses çıkarılıyor");
    await extractAudio(p.inputVideo, p.audioWav, jobId);

    progress(38, "Türkçe yazıya dökülüyor");
    const stopWhisperPulse = startBoundedProgressPulse(jobId, 55, 12_000);
    try {
      await transcribeTurkishToSrt(p.audioWav, p.trSrt, p.dir, jobId);
    } finally {
      stopWhisperPulse();
    }

    progress(58, "Altyazılar çevriliyor");
    const stopTranslatePulse = startBoundedProgressPulse(jobId, 78, 10_000);
    try {
      await translateSrtFile(p.trSrt, p.translatedSrt, targetLang, jobId);
    } finally {
      stopTranslatePulse();
    }

    progress(82, "Altyazı videoya ekleniyor");
    const langTag = subtitleLanguageTag(targetLang);
    const stopMuxPulse = startBoundedProgressPulse(jobId, 96, 8000);
    try {
      await muxSoftSubtitles(
        p.inputVideo,
        p.translatedSrt,
        p.finalMp4,
        langTag,
        jobId
      );
    } finally {
      stopMuxPulse();
    }

    const downloadPath = `/api/download/${jobId}`;
    appendJobLog(jobId, `Bitti: final.mp4 → ${downloadPath}`);
    updateJob(jobId, {
      status: "completed",
      progress: 100,
      step: "Tamamlandı",
      downloadPath,
      completedAt: Date.now(),
    });
    scheduleJobDeletion(jobId, TTL_MS);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    appendJobLog(jobId, `HATA: ${msg}`);
    updateJob(jobId, {
      status: "failed",
      progress: 0,
      step: "Başarısız",
      error: msg,
    });
    scheduleJobDeletion(jobId, FAIL_TTL_MS);
  }
}

export async function ensureJobDir(jobId: string): Promise<void> {
  const p = getJobPaths(jobId);
  await fs.mkdir(p.dir, { recursive: true });
  createJobRecord(jobId);
}

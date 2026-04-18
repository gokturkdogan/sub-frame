import fs from "fs/promises";

import {
  createJobRecord,
  getJob,
  scheduleJobDeletion,
  updateJob,
} from "@/lib/job-store";
import {
  logBullet,
  logError,
  logNote,
  logOk,
  logSection,
  logTech,
} from "@/lib/friendly-job-log";
import type { PipelineStepCode } from "@/lib/pipeline-steps";
import { getJobPaths } from "@/lib/paths";
import {
  isTurkishSubtitleTarget,
  subtitleLanguageTag,
  TARGET_LANGUAGES,
} from "@/lib/lang";
import { extractAudio, muxSoftSubtitles } from "@/workers/ffmpeg";
import { transcribeTurkishToSrt } from "@/workers/whisper";
import { translateSrtFile } from "@/workers/translate";

const TTL_MS = Number(process.env.JOB_TTL_MS) || 45 * 60 * 1000;
const FAIL_TTL_MS = 10 * 60 * 1000;

/**
 * Uzun süren adımlarda gerçek bitiş gelene kadar yüzdeyi `ceiling`’e kadar
 * yavaşça artırır; `progressHint` ile barın yanında bağlam verir.
 */
function startBoundedProgressPulse(
  jobId: string,
  ceiling: number,
  intervalMs: number,
  hint?: string | ((pct: number) => string)
): () => void {
  const id = setInterval(() => {
    const cur = getJob(jobId);
    if (!cur || cur.status !== "processing") return;
    if (cur.progress >= ceiling) return;
    const next = Math.min(ceiling, cur.progress + 1);
    const progressHint =
      hint === undefined
        ? cur.progressHint
        : typeof hint === "function"
          ? hint(next)
          : hint;
    updateJob(jobId, {
      progress: next,
      progressHint,
    });
  }, intervalMs);
  return () => clearInterval(id);
}

export async function runPipeline(jobId: string, targetLang: string): Promise<void> {
  const p = getJobPaths(jobId);

  const progress = (
    n: number,
    code: PipelineStepCode,
    step: string,
    progressHint?: string
  ) => {
    updateJob(jobId, {
      status: "processing",
      progress: n,
      step,
      stepCode: code,
      ...(progressHint !== undefined ? { progressHint } : {}),
    });
  };

  try {
    const turkishOnly = isTurkishSubtitleTarget(targetLang);
    updateJob(jobId, { skipTranslate: turkishOnly });

    const langLabel =
      TARGET_LANGUAGES.find((l) => l.code === targetLang)?.label ?? targetLang;
    logSection(jobId, "🚀", "İşlem başladı");
    logNote(
      jobId,
      "Video sırayla işlenir: ses ayıklama → konuşmayı yazıya dökme → (gerekirse) çeviri → videoya gömme."
    );
    logBullet(jobId, `Altyazı dili: ${langLabel} (${targetLang})`);
    logTech(jobId, `Geçici dosyalar: ${p.dir}`);

    progress(
      14,
      "extract_audio",
      "Ses çıkarılıyor",
      "2/5 · Videodan ses ayrılıyor (FFmpeg)"
    );
    const stopExtractPulse = startBoundedProgressPulse(
      jobId,
      27,
      2800,
      (p) =>
        `2/5 · Ses hazırlanıyor — genel ilerleme yaklaşık %${p} (tahmini, adım bitene kadar artar)`
    );
    try {
      await extractAudio(p.inputVideo, p.audioWav, jobId);
    } finally {
      stopExtractPulse();
    }

    progress(
      28,
      "transcribe",
      "Konuşma yazıya dökülüyor",
      "3/5 · Konuşma tanıma (Whisper) başlıyor"
    );
    const stopWhisperPulse = startBoundedProgressPulse(
      jobId,
      55,
      8200,
      (p) =>
        `3/5 · Ses yazıya dökülüyor — genel ~%${p} · bu adım uzun sürebilir`
    );
    try {
      await transcribeTurkishToSrt(p.audioWav, p.trSrt, p.dir, jobId);
    } finally {
      stopWhisperPulse();
    }

    let srtForMux = p.translatedSrt;

    if (turkishOnly) {
      logSection(jobId, "⏭️", "Çeviri adımı yok");
      logNote(
        jobId,
        "Hedef dil zaten Türkçe; metin çevrilmeyecek. Yazıya dökülen Türkçe altyazı doğrudan videoya eklenir."
      );
      srtForMux = p.trSrt;
    } else {
      progress(
        58,
        "translate",
        "Metin çevriliyor",
        "4/5 · Satır satır çeviri (ilerleme aşağıda güncellenir)"
      );
      await translateSrtFile(p.trSrt, p.translatedSrt, targetLang, jobId);
    }

    progress(
      turkishOnly ? 72 : 77,
      "mux",
      "Altyazı videoya gömülüyor",
      turkishOnly
        ? "5/5 · Altyazı videoya gömülüyor (çeviri atlandı)"
        : "5/5 · Son birleştirme: video + altyazı izi"
    );
    const langTag = subtitleLanguageTag(targetLang);
    const stopMuxPulse = startBoundedProgressPulse(
      jobId,
      turkishOnly ? 94 : 95,
      6500,
      (p) =>
        turkishOnly
          ? `5/5 · FFmpeg birleştiriyor — genel ~%${p}`
          : `5/5 · MP4 oluşturuluyor — genel ~%${p}`
    );
    try {
      await muxSoftSubtitles(
        p.inputVideo,
        srtForMux,
        p.finalMp4,
        langTag,
        jobId
      );
    } finally {
      stopMuxPulse();
    }

    const downloadPath = `/api/download/${jobId}`;
    logSection(jobId, "🎉", "İşlem tamamlandı");
    logOk(jobId, `Hazır video indirilebilir: ${downloadPath}`);
    updateJob(jobId, {
      status: "completed",
      progress: 100,
      step: "Tamamlandı",
      stepCode: "completed",
      progressHint: "100% · İndirmeye hazır",
      downloadPath,
      completedAt: Date.now(),
    });
    scheduleJobDeletion(jobId, TTL_MS);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logSection(jobId, "⛔", "İşlem durdu");
    logError(jobId, msg);
    updateJob(jobId, {
      status: "failed",
      progress: 0,
      step: "Başarısız",
      progressHint: "",
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

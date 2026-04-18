import { spawn } from "child_process";
import path from "path";

import {
  logBullet,
  logError,
  logOk,
  logSection,
  logTech,
  logWait,
  logWarn,
} from "@/lib/friendly-job-log";
import { getJob, updateJob } from "@/lib/job-store";
import { formatShellCommand } from "@/lib/shell-cmd";

function ffmpegBin(): string {
  const p = process.env.FFMPEG_PATH?.trim();
  return p ? p : "ffmpeg";
}

type RunFfmpegOptions = {
  /** Başarılı çıkışta stderr satırlarını günlüğe yazma (gürültüyü keser). Varsayılan: true */
  quietStderrOnSuccess?: boolean;
  /** quietStderr kapalıyken en fazla kaç stderr satırı (0 = sınırsız değil, varsayılan 12) */
  maxStderrLines?: number;
  /** Arayüz ipucu + günlük satırı (birkaç saniyede bir) */
  liveJob?: {
    jobId: string;
    /** progressHint ve logda kullanılır, örn. "2/5 ·" */
    hintLine: string;
  };
};

function runFfmpeg(
  args: string[],
  jobId: string,
  label: string,
  opts: RunFfmpegOptions = {}
): Promise<void> {
  const quietOk =
    opts.quietStderrOnSuccess !== undefined ? opts.quietStderrOnSuccess : true;
  const maxStderrLines = opts.maxStderrLines ?? 12;
  const bin = ffmpegBin();
  logTech(jobId, `${label}: ${formatShellCommand(bin, args)}`);

  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let carry = "";
    let linesLogged = 0;

    let hb: ReturnType<typeof setInterval> | undefined;
    const live = opts.liveJob;
    if (live) {
      let elapsed = 0;
      hb = setInterval(() => {
        elapsed += 5;
        logBullet(
          live.jobId,
          `${live.hintLine} FFmpeg hâlâ çalışıyor (${elapsed} sn) — uzun videolarda normaldir.`
        );
        const cur = getJob(live.jobId);
        if (cur?.status === "processing") {
          updateJob(live.jobId, {
            progressHint: `${live.hintLine} Ses/video işleniyor (~${elapsed} sn)`,
          });
        }
      }, 5000);
    }

    proc.stderr?.on("data", (d: Buffer) => {
      const chunk = d.toString();
      stderr += chunk;
      carry += chunk;
      const parts = carry.split("\n");
      carry = parts.pop() ?? "";
      for (const raw of parts) {
        const line = raw.trim();
        if (!line) continue;
        if (quietOk) continue;
        if (linesLogged >= maxStderrLines) continue;
        logTech(jobId, `[${label}] ${line.slice(0, 500)}`);
        linesLogged++;
      }
    });
    proc.on("error", (err: NodeJS.ErrnoException) => {
      if (hb) clearInterval(hb);
      const missing =
        err.code === "ENOENT"
          ? " FFmpeg kurulu değil veya PATH’te yok. https://ffmpeg.org/download.html — veya .env içinde FFMPEG_PATH ile tam yol verin (ör. Windows: FFMPEG_PATH=C:\\ffmpeg\\bin\\ffmpeg.exe)."
          : "";
      logError(
        jobId,
        `FFmpeg başlatılamadı (${err.code ?? "?"}): ${err.message}.${missing}`
      );
      reject(err);
    });
    proc.on("close", (code) => {
      if (hb) clearInterval(hb);
      if (carry.trim() && !quietOk && linesLogged < maxStderrLines) {
        logTech(jobId, `[${label}] ${carry.trim().slice(0, 500)}`);
      }
      if (code === 0) {
        resolve();
      } else {
        const tail = stderr.slice(-2500);
        logWarn(jobId, `FFmpeg hata ile kapandı (kod ${code}). Ayrıntı aşağıda.`);
        logTech(jobId, tail.slice(-2000));
        reject(new Error(`ffmpeg exited with ${code}: ${tail}`));
      }
    });
  });
}

/**
 * Extract mono 16kHz WAV for Whisper.
 */
export async function extractAudio(
  inputVideoPath: string,
  outputWavPath: string,
  jobId: string
): Promise<void> {
  logSection(jobId, "🎬", "2/5 — Videodan ses ayıklanıyor");
  logBullet(
    jobId,
    "Ses ve görüntü ayrılıyor; konuşma tanıma için tek kanallı, 16 kHz WAV üretiliyor."
  );
  logWait(jobId, "FFmpeg çalışıyor…");
  await runFfmpeg(
    [
      "-y",
      "-i",
      inputVideoPath,
      "-vn",
      "-acodec",
      "pcm_s16le",
      "-ar",
      "16000",
      "-ac",
      "1",
      outputWavPath,
    ],
    jobId,
    "ffmpeg-ses",
    {
      quietStderrOnSuccess: true,
      liveJob: { jobId, hintLine: "2/5 ·" },
    }
  );
  logOk(jobId, "Ses videodan ayrıldı; WAV dosyası hazır.");
}

/**
 * Mux soft subtitles (mov_text) into MP4.
 */
export async function muxSoftSubtitles(
  inputVideoPath: string,
  srtPath: string,
  outputPath: string,
  languageTag: string,
  jobId: string
): Promise<void> {
  const absSrt = path.resolve(srtPath);
  logSection(jobId, "📼", "5/5 — Altyazı videoya gömülüyor");
  logBullet(
    jobId,
    "Altyazı izi videoya ekleniyor (yumuşak altyazı; videoyu yeniden kodlamadan mümkün olduğunca kopyalanır)."
  );
  logBullet(jobId, `Altyazı dil etiketi (dosya içi): ${languageTag}`);
  logWait(jobId, "FFmpeg çalışıyor…");
  await runFfmpeg(
    [
      "-y",
      "-i",
      inputVideoPath,
      "-i",
      absSrt,
      "-map",
      "0",
      "-map",
      "1",
      "-c",
      "copy",
      "-c:s",
      "mov_text",
      "-metadata:s:s:0",
      `language=${languageTag}`,
      outputPath,
    ],
    jobId,
    "ffmpeg-mux",
    {
      quietStderrOnSuccess: true,
      liveJob: { jobId, hintLine: "5/5 ·" },
    }
  );
  logOk(jobId, "Video ve altyazı birleştirildi; indirilebilir dosya hazır.");
}

/**
 * Burn-in subtitles (optional alternative). Path must be escaped for ffmpeg filter on Windows/macOS.
 */
export async function burnSubtitles(
  inputVideoPath: string,
  srtPath: string,
  outputPath: string,
  jobId: string
): Promise<void> {
  const escaped = srtPath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  const vf = `subtitles='${escaped}'`;
  logSection(jobId, "🔥", "Altyazı videoya yakılıyor (burn-in)");
  logWait(jobId, "FFmpeg çalışıyor…");
  await runFfmpeg(
    ["-y", "-i", inputVideoPath, "-vf", vf, "-c:a", "copy", outputPath],
    jobId,
    "ffmpeg-burn",
    { quietStderrOnSuccess: true }
  );
  logOk(jobId, "Yakılmış altyazılı video oluşturuldu.");
}

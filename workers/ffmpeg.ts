import { spawn } from "child_process";
import path from "path";

import { appendJobLog } from "@/lib/job-store";
import { formatShellCommand } from "@/lib/shell-cmd";

function ffmpegBin(): string {
  return process.env.FFMPEG_PATH || "ffmpeg";
}

function runFfmpeg(args: string[], jobId: string, label = "ffmpeg"): Promise<void> {
  const bin = ffmpegBin();
  appendJobLog(jobId, `$ ${formatShellCommand(bin, args)}`);

  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let carry = "";
    let linesLogged = 0;
    const maxStderrLines = 80;

    proc.stderr?.on("data", (d: Buffer) => {
      const chunk = d.toString();
      stderr += chunk;
      carry += chunk;
      const parts = carry.split("\n");
      carry = parts.pop() ?? "";
      for (const raw of parts) {
        const line = raw.trim();
        if (!line || linesLogged >= maxStderrLines) continue;
        appendJobLog(jobId, `[${label}] ${line.slice(0, 500)}`);
        linesLogged++;
      }
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (carry.trim()) {
        appendJobLog(jobId, `[${label}] ${carry.trim().slice(0, 500)}`);
      }
      if (code === 0) {
        appendJobLog(jobId, `[${label}] bitti (çıkış kodu 0)`);
        resolve();
      } else {
        const tail = stderr.slice(-2500);
        appendJobLog(jobId, `[${label}] HATA çıkış kodu ${code}`);
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
    "ffmpeg-ses"
  );
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
    "ffmpeg-mux"
  );
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
  await runFfmpeg(
    ["-y", "-i", inputVideoPath, "-vf", vf, "-c:a", "copy", outputPath],
    jobId,
    "ffmpeg-burn"
  );
}

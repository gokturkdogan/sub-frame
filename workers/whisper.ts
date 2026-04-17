import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

import { appendJobLog } from "@/lib/job-store";
import { formatShellCommand } from "@/lib/shell-cmd";
import OpenAI, { toFile } from "openai";

/**
 * Whisper'ın yazdığı satır: [45:12.820 --> 45:13.600]  metin
 * (stdout veya stderr; verbose modda gelir.)
 */
function isWhisperSegmentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("[") && t.includes(" --> ");
}

/**
 * Produce Turkish SRT using OpenAI Whisper API (preferred) or local `whisper` CLI.
 */
export async function transcribeTurkishToSrt(
  audioPath: string,
  outSrtPath: string,
  jobDir: string,
  jobId: string
): Promise<void> {
  if (process.env.OPENAI_API_KEY) {
    const model = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";
    appendJobLog(
      jobId,
      `OpenAI Transcription API: model=${model}, dil=tr, çıktı=srt (dosya yükleniyor…)`
    );
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const buf = await fs.readFile(audioPath);
    const ext = path.extname(audioPath) || ".wav";
    const file = await toFile(buf, `audio${ext}`, {
      type: ext === ".wav" ? "audio/wav" : "application/octet-stream",
    });

    const transcription = await openai.audio.transcriptions.create({
      file,
      model,
      language: "tr",
      response_format: "srt",
    });

    await fs.writeFile(outSrtPath, transcription, "utf-8");
    const bytes = Buffer.byteLength(transcription, "utf8");
    appendJobLog(
      jobId,
      `OpenAI yanıtı alındı, tr.srt yazıldı (${bytes} bayt). Yerel whisper çalıştırılmadı.`
    );
    return;
  }

  const whisperCmd = process.env.WHISPER_CMD || "whisper";
  const model = process.env.WHISPER_MODEL || "base";

  const extraFromEnv = process.env.WHISPER_EXTRA_ARGS?.trim()
    ? process.env.WHISPER_EXTRA_ARGS.trim().split(/\s+/)
    : [];

  const verboseArgs =
    process.env.WHISPER_VERBOSE === "0"
      ? []
      : (["--verbose", "True"] as const);

  const args = [
    audioPath,
    "--language",
    "Turkish",
    "--model",
    model,
    ...verboseArgs,
    ...extraFromEnv,
    "--output_format",
    "srt",
    "--output_dir",
    jobDir,
  ];
  appendJobLog(jobId, `$ ${formatShellCommand(whisperCmd, args)}`);

  let wavBytes = 0;
  try {
    const st = await fs.stat(audioPath);
    wavBytes = st.size;
  } catch {
    /* ignore */
  }
  appendJobLog(
    jobId,
    `Yerel Whisper: model=${model}, ~${(wavBytes / (1024 * 1024)).toFixed(1)} MiB WAV. --verbose True + PYTHONUNBUFFERED ile segment satırları (zaman damgası + metin) loga düşer. FP16 uyarısı normaldir.`
  );

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(whisperCmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    const t0 = Date.now();
    const heartbeatMs = Number(process.env.WHISPER_HEARTBEAT_MS) || 25_000;
    const heartbeat = setInterval(() => {
      const sec = Math.floor((Date.now() - t0) / 1000);
      appendJobLog(
        jobId,
        `[whisper] hâlâ çalışıyor (${sec} sn) — segment logu gelmiyorsa çıktı tamponu veya model yüklemesi sürebilir.`
      );
    }, heartbeatMs);

    const stopHeartbeat = () => clearInterval(heartbeat);

    let err = "";
    let carryOut = "";
    let carryErr = "";
    /** tqdm / uyarı gibi segment olmayan satırlar (sınırlı). */
    let metaLinesLogged = 0;
    const maxMetaLines = 100;

    const handleLine = (raw: string, stream: "stdout" | "stderr"): void => {
      const line = raw.trim();
      if (!line) return;

      if (isWhisperSegmentLine(line)) {
        appendJobLog(jobId, line.slice(0, 2000));
        return;
      }

      if (metaLinesLogged < maxMetaLines) {
        appendJobLog(jobId, `[whisper ${stream}] ${line.slice(0, 800)}`);
        metaLinesLogged++;
      }
    };

    const flush = (buf: string, stream: "stdout" | "stderr"): string => {
      const parts = buf.split("\n");
      const rest = parts.pop() ?? "";
      for (const raw of parts) {
        handleLine(raw, stream);
      }
      return rest;
    };

    proc.stdout?.on("data", (d: Buffer) => {
      carryOut += d.toString();
      carryOut = flush(carryOut, "stdout");
    });
    proc.stderr?.on("data", (d: Buffer) => {
      const t = d.toString();
      err += t;
      carryErr += t;
      carryErr = flush(carryErr, "stderr");
    });
    proc.on("error", (e) => {
      stopHeartbeat();
      reject(e);
    });
    proc.on("close", (code) => {
      stopHeartbeat();
      if (carryOut.trim()) {
        for (const raw of carryOut.split("\n")) {
          handleLine(raw, "stdout");
        }
      }
      if (carryErr.trim()) {
        for (const raw of carryErr.split("\n")) {
          handleLine(raw, "stderr");
        }
      }
      if (code === 0) {
        const totalSec = Math.floor((Date.now() - t0) / 1000);
        appendJobLog(
          jobId,
          `[whisper] bitti (çıkış kodu 0, toplam ~${totalSec} sn)`
        );
        resolve();
      } else {
        appendJobLog(jobId, `[whisper] HATA çıkış ${code}`);
        reject(
          new Error(
            `${whisperCmd} failed (${code}). OPENAI_API_KEY veya whisper CLI gerekli. ${err.slice(-1500)}`
          )
        );
      }
    });
  });

  const base = path.basename(audioPath, path.extname(audioPath));
  const generated = path.join(jobDir, `${base}.srt`);
  await fs.rename(generated, outSrtPath);
  appendJobLog(jobId, `Dosya taşındı: ${base}.srt → tr.srt`);
}

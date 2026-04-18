import { spawn, spawnSync } from "child_process";
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

/** tqdm indirme / frame ilerleme satırı — meta kotasından ayrı tutulur */
function isProgressNoiseLine(line: string): boolean {
  const t = line.trim();
  return (
    /^\d+%\|/.test(t) ||
    /\|\s*\d+(?:\.\d+)?\s*(?:MiB|GiB|KiB|B)\/s/.test(t) ||
    (t.includes("|") && (t.includes("it/s") || t.includes("s/it")))
  );
}

type WhisperPhase = { key: string; label: string };

/** stderr/stdout satırından kabaca hangi aşamada olduğumuzu çıkarır (Whisper CLI çıktısına bağlıdır). */
function whisperPhaseFromLine(line: string): WhisperPhase | null {
  const t = line.trim();
  if (/traceback|error:/i.test(t)) {
    return { key: "error", label: "Python hata çıktısı (Traceback / Error)" };
  }
  if (/detecting language/i.test(t)) {
    return {
      key: "lang_detect",
      label: "Dil tespiti — Whisper ilk ~30 snye bakıyor",
    };
  }
  if (/skipping .* due to/i.test(t)) {
    return { key: "skip_err", label: "Dosya atlanıyor / istisna (stderr)" };
  }
  if (/\b(huggingface|hf\.co|cdn-lfs)\b/i.test(t)) {
    return {
      key: "hf_fetch",
      label: "Model dosyası ağdan çekiliyor (Hugging Face vb.)",
    };
  }
  if (
    /\d+[kKmMgG]?\s*\/\s*[\d.]+\s*G\b/i.test(t) ||
    /\|\s*\d+[kKmMgG]?\s*\/\s*[\d.]+\s*G\b/i.test(t)
  ) {
    return {
      key: "model_dl",
      label: "Model ağırlıkları indiriliyor veya doğrulanıyor (büyük dosya tqdm)",
    };
  }
  if (isProgressNoiseLine(t)) {
    if (/frame/i.test(t)) {
      return {
        key: "mel_frames",
        label: "Ses özeti işleniyor — tqdm (frame ilerlemesi)",
      };
    }
    return {
      key: "tqdm_run",
      label: "İşlem devam ediyor — tqdm ilerleme çubuğu",
    };
  }
  return null;
}

/** Split command line into executable + args (supports quoted segments). */
function splitCommandLine(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && /\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

type PartialCue = {
  start: string;
  end: string;
  text: string;
};

function parseSrtCuesLoose(content: string): PartialCue[] {
  const blocks = content.split(/\r?\n\r?\n/);
  const cues: PartialCue[] = [];
  for (const b of blocks) {
    const lines = b
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (lines.length < 2) continue;
    const arrowIdx = lines.findIndex((l) => l.includes("-->"));
    if (arrowIdx < 0) continue;
    const [startRaw, endRaw] = lines[arrowIdx].split("-->").map((x) => x.trim());
    if (!startRaw || !endRaw) continue;
    const text = lines.slice(arrowIdx + 1).join(" ").trim();
    if (!text) continue;
    cues.push({ start: startRaw, end: endRaw, text });
  }
  return cues;
}

async function detectWhisperModelCache(model: string): Promise<string | null> {
  const cacheName = `${model}.pt`;
  const explicit = process.env.WHISPER_MODEL_DIR?.trim();
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const xdg = process.env.XDG_CACHE_HOME || "";
  const candidates = [
    explicit ? path.join(explicit, cacheName) : "",
    xdg ? path.join(xdg, "whisper", cacheName) : "",
    home ? path.join(home, ".cache", "whisper", cacheName) : "",
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      await fs.access(p);
      return p;
    } catch {
      /* continue */
    }
  }
  return null;
}

/** Whisper ile aynı makinedeki `python` + PyTorch’un CUDA kullanıp kullanmadığı (whisper subprocess’ten önce). */
function probeTorchRuntimeSummary(): string {
  const probe = `import sys
try:
    import torch
    if torch.cuda.is_available():
        print("GPU|" + torch.cuda.get_device_name(0))
    else:
        print("CPU")
except ImportError:
    print("UNKNOWN")
`;
  const explicitPy = process.env.WHISPER_PYTHON?.trim();
  if (explicitPy) {
    const r = spawnSync(explicitPy, ["-c", probe], {
      encoding: "utf8",
      windowsHide: true,
    });
    const line = (r.stdout ?? "").trim().split("\n")[0]?.trim() ?? "";
    if (!r.error && r.status === 0 && line.startsWith("GPU|")) {
      return `GPU — ${line.slice(4)} (PyTorch CUDA; WHISPER_PYTHON)`;
    }
    if (!r.error && r.status === 0 && line === "CPU") {
      return "CPU — PyTorch CUDA kapalı veya GPU yok (WHISPER_PYTHON)";
    }
    if (!r.error && r.status === 0 && line === "UNKNOWN") {
      return "PyTorch algılanamadı (WHISPER_PYTHON)";
    }
  }
  const candidates: [string, string[]][] = [
    ["python", ["-c", probe]],
    ["py", ["-3", "-c", probe]],
    ["python3", ["-c", probe]],
  ];
  for (const [cmd, args] of candidates) {
    const r = spawnSync(cmd, args, {
      encoding: "utf8",
      windowsHide: true,
    });
    if (r.error || r.status !== 0) continue;
    const line = (r.stdout ?? "").trim().split("\n")[0]?.trim() ?? "";
    if (line.startsWith("GPU|")) {
      return `GPU — ${line.slice(4)} (PyTorch CUDA)`;
    }
    if (line === "CPU") {
      return "CPU — PyTorch CUDA kapalı veya GPU yok";
    }
    if (line === "UNKNOWN") {
      return "PyTorch algılanamadı (import yok); cihaz bilinmiyor";
    }
  }
  return "Python çalıştırılamadı — PATH’te python/py yoksa cihaz sorgulanamaz";
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
      `OpenAI Transcription API: model=${model}, dil=tr, çıktı=srt. İşlem OpenAI sunucularında; yerel GPU/CPU kullanılmaz (dosya yükleniyor…)`
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

  const whisperFromEnv = process.env.WHISPER_CMD?.trim();
  const whisperCmdRaw = whisperFromEnv ? whisperFromEnv : "whisper";
  const whisperCmdParts = splitCommandLine(whisperCmdRaw);
  const whisperCmd = whisperCmdParts[0] ?? "whisper";
  const whisperCmdPrefixArgs = whisperCmdParts.slice(1);
  /** Yerel varsayılan: kalite odaklı (RTX 3060 Ti vb. için uygun). Zayıf CPU için WHISPER_MODEL=small|medium */
  const model = process.env.WHISPER_MODEL || "large-v3";

  const extraFromEnv = process.env.WHISPER_EXTRA_ARGS?.trim()
    ? process.env.WHISPER_EXTRA_ARGS.trim().split(/\s+/)
    : [];

  /** Örn. ürün adları, kişi isimleri; yanlış heceleme/karışmayı azaltmaya yardım eder. */
  const initialPrompt = process.env.WHISPER_INITIAL_PROMPT?.trim();
  const initialPromptArgs =
    initialPrompt !== undefined && initialPrompt.length > 0
      ? (["--initial_prompt", initialPrompt] as const)
      : ([] as const);

  const verboseOff = process.env.WHISPER_VERBOSE === "0";
  const verboseArgs = verboseOff ? [] : (["--verbose", "True"] as const);

  const args = [
    ...whisperCmdPrefixArgs,
    audioPath,
    "--language",
    "Turkish",
    "--model",
    model,
    ...initialPromptArgs,
    ...verboseArgs,
    ...extraFromEnv,
    "--output_format",
    "srt",
    "--output_dir",
    jobDir,
  ];

  const runtimeHint = probeTorchRuntimeSummary();
  appendJobLog(
    jobId,
    `Yerel transkripsiyon: Whisper modeli=${model}, beklenen cihaz özeti=${runtimeHint} (whisper gerçek yükü bu Python ortamında çalıştırır)`
  );
  const cachePath = await detectWhisperModelCache(model);
  appendJobLog(
    jobId,
    cachePath
      ? `Whisper model cache bulundu: ${cachePath}`
      : `Whisper model cache bulunamadı (${model}.pt). İlk çalıştırmada indirme yapılabilir.`
  );
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
    `Yerel Whisper: model=${model}, ~${(wavBytes / (1024 * 1024)).toFixed(1)} MiB WAV.${
      initialPrompt ? " WHISPER_INITIAL_PROMPT kullanılıyor." : ""
    } Kalite için genelde base < small < medium < large-v3 (daha yavaş, daha çok RAM/VRAM). --verbose True + PYTHONUNBUFFERED ile segment satırları loga düşer. FP16 uyarısı normaldir.`
  );

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const ffmpegFromEnv = process.env.FFMPEG_PATH?.trim();
    const ffmpegDir = ffmpegFromEnv ? path.dirname(ffmpegFromEnv) : "";
    const existingPath = process.env.PATH || process.env.Path || "";
    const mergedPath = ffmpegDir
      ? `${ffmpegDir}${path.delimiter}${existingPath}`
      : existingPath;
    const proc = spawn(whisperCmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        PATH: mergedPath,
        Path: mergedPath,
      },
    });
    const t0 = Date.now();
    const base = path.basename(audioPath, path.extname(audioPath));
    const generated = path.join(jobDir, `${base}.srt`);
    let whisperPhaseKey = "init";
    let lastPhaseLabel =
      "başladı — model RAM/GPU yüklemesi ve ilk ses penceresi (sessizlik birkaç dakika sürebilir)";
    appendJobLog(jobId, `[whisper faz] ${lastPhaseLabel}`);

    const bumpPhase = (next: WhisperPhase | null) => {
      if (!next || next.key === whisperPhaseKey) return;
      whisperPhaseKey = next.key;
      lastPhaseLabel = next.label;
      appendJobLog(jobId, `[whisper faz] ${next.label}`);
    };

    const heartbeatMs = Number(process.env.WHISPER_HEARTBEAT_MS) || 25_000;

    const whisperHeartbeatDetail = (elapsedSec: number): string => {
      if (whisperPhaseKey !== "init") {
        return `son Whisper çıktısına göre aşama: ${lastPhaseLabel}`;
      }
      if (elapsedSec < 45) {
        return `stderr henüz yeni aşama satırı göstermedi (normal) — muhtemelen model VRAM'e alınıyor veya ilk uzun ses penceresi işleniyor`;
      }
      if (elapsedSec < 120) {
        return `sessiz çıktı uzadı (${elapsedSec}s) — large-v3 için yükleme + ilk decode gecikebilir; yakında tqdm veya [timestamp] segment satırları gelebilir`;
      }
      return `uzun sessizlik (${elapsedSec}s) — uzun WAV + large model için sık görülür; Görev Yöneticisi’nde Python/GPU kullanımı kontrol edilebilir`;
    };

    const heartbeat = setInterval(() => {
      const sec = Math.floor((Date.now() - t0) / 1000);
      appendJobLog(
        jobId,
        `[whisper] çalışıyor (${sec}s) — ${whisperHeartbeatDetail(sec)}`
      );
    }, heartbeatMs);
    let lastCueCount = 0;
    const cuePollMs = Number(process.env.WHISPER_CUE_POLL_MS) || 4000;
    const cuePoll = setInterval(async () => {
      if (settled) return;
      try {
        const partial = await fs.readFile(generated, "utf-8");
        const cues = parseSrtCuesLoose(partial);
        if (cues.length <= lastCueCount) return;
        const newlyAdded = cues.slice(lastCueCount);
        lastCueCount = cues.length;
        for (const cue of newlyAdded) {
          appendJobLog(
            jobId,
            `[whisper cue] ${cue.start} --> ${cue.end} | ${cue.text.slice(0, 300)}`
          );
        }
      } catch {
        /* file henüz oluşmamış olabilir */
      }
    }, cuePollMs);

    const stopTimers = () => {
      clearInterval(heartbeat);
      clearInterval(cuePoll);
    };

    let err = "";
    let carryOut = "";
    let carryErr = "";
    /** tqdm indirme / uyarı — segment kotasından ayrı */
    let progressLinesLogged = 0;
    const maxProgressLines = 500;
    /** tqdm dışı stderr (Traceback vb.) — sınırlı */
    let metaLinesLogged = 0;
    const maxMetaLines = 120;

    const handleLine = (raw: string, stream: "stdout" | "stderr"): void => {
      const line = raw.trim();
      if (!line) return;

      if (isWhisperSegmentLine(line)) {
        bumpPhase({
          key: "transcribe_segments",
          label:
            "Yazıya döküm — segment metinleri üretiliyor (her satır bir zaman aralığı)",
        });
        appendJobLog(jobId, `[whisper segment] ${line.slice(0, 2000)}`);
        return;
      }

      bumpPhase(whisperPhaseFromLine(line));

      if (isProgressNoiseLine(line)) {
        if (progressLinesLogged < maxProgressLines) {
          appendJobLog(jobId, `[whisper ilerleme] ${line.slice(0, 800)}`);
          progressLinesLogged++;
        }
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
    proc.on("error", (err: NodeJS.ErrnoException) => {
      stopTimers();
      if (settled) return;
      settled = true;
      const hint =
        err.code === "ENOENT"
          ? " WHISPER_CMD içine tam executable yolu verin (gerekirse arg ile): örn WHISPER_CMD=\"C:\\Users\\...\\python.exe -m whisper\" veya WHISPER_CMD=C:\\Users\\...\\venv\\Scripts\\whisper.exe"
          : "";
      appendJobLog(
        jobId,
        `[whisper] başlatılamadı (${err.code ?? "?"}): ${err.message}.${hint}`
      );
      reject(err);
    });
    proc.on("close", (code) => {
      stopTimers();
      if (settled) return;
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
        settled = true;
        resolve();
      } else {
        settled = true;
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
  try {
    await fs.access(generated);
  } catch {
    throw new Error(
      `Whisper çıktı dosyası oluşmadı (${generated}). Python/Whisper içinde ffmpeg görünmüyor olabilir. FFMPEG_PATH ayarlıysa yolun process env'e geçtiğini kontrol edin.`
    );
  }
  await fs.rename(generated, outSrtPath);
  appendJobLog(
    jobId,
    `[whisper] bitti: model=${model}, işlem tamamlandı (cihaz özeti iş başında günlükte)`
  );
  appendJobLog(jobId, `Dosya taşındı: ${base}.srt → tr.srt`);
}

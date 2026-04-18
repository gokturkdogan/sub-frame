import { spawn, spawnSync } from "child_process";
import fs from "fs/promises";
import path from "path";

import {
  logBullet,
  logError,
  logNote,
  logOk,
  logSection,
  logTech,
  logWait,
  logWarn,
} from "@/lib/friendly-job-log";
import { getJob, updateJob } from "@/lib/job-store";
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
      label: "Dil kontrolü: sesin başına bakılıyor (yaklaşık ilk 30 sn)",
    };
  }
  if (/skipping .* due to/i.test(t)) {
    return { key: "skip_err", label: "Bir parça atlanıyor (uyarı / istisna)" };
  }
  if (/\b(huggingface|hf\.co|cdn-lfs)\b/i.test(t)) {
    return {
      key: "hf_fetch",
      label: "Model dosyası internetten alınıyor (Hugging Face)",
    };
  }
  if (
    /\d+[kKmMgG]?\s*\/\s*[\d.]+\s*G\b/i.test(t) ||
    /\|\s*\d+[kKmMgG]?\s*\/\s*[\d.]+\s*G\b/i.test(t)
  ) {
    return {
      key: "model_dl",
      label: "Model dosyası indiriliyor veya doğrulanıyor (büyük paket)",
    };
  }
  if (isProgressNoiseLine(t)) {
    if (/frame/i.test(t)) {
      return {
        key: "mel_frames",
        label: "Ses özeti çıkarılıyor (kare kare ilerleme)",
      };
    }
    return {
      key: "tqdm_run",
      label: "Arka planda işlem sürüyor (ilerleme çubuğu)",
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

function whisperVerboseLogs(): boolean {
  return process.env.WHISPER_VERBOSE_LOGS === "1";
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
      return `Ekran kartı (GPU) kullanılabilir: ${line.slice(4)} — PyTorch CUDA (WHISPER_PYTHON)`;
    }
    if (!r.error && r.status === 0 && line === "CPU") {
      return "İşlemci (CPU) modu: PyTorch CUDA kapalı veya uygun GPU yok (WHISPER_PYTHON)";
    }
    if (!r.error && r.status === 0 && line === "UNKNOWN") {
      return "PyTorch bulunamadı; cihaz bilgisi net değil (WHISPER_PYTHON)";
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
      return `Ekran kartı (GPU) kullanılabilir: ${line.slice(4)} — PyTorch CUDA`;
    }
    if (line === "CPU") {
      return "İşlemci (CPU) modu: PyTorch CUDA kapalı veya uygun GPU yok";
    }
    if (line === "UNKNOWN") {
      return "PyTorch yok veya algılanamadı; GPU/CPU seçimi Whisper tarafında belirlenecek";
    }
  }
  return "Python bulunamadı; PATH’te python yoksa GPU/CPU özeti çıkmayabilir";
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
    logSection(jobId, "☁️", "3/5 — Konuşmayı yazıya dökme (OpenAI)");
    logBullet(
      jobId,
      "Ses dosyası OpenAI sunucularına gönderiliyor; bu yolda kendi bilgisayarınızda GPU/CPU kullanılmaz."
    );
    logBullet(jobId, `Kullanılan model: ${model} — dil: Türkçe — çıktı: SRT`);
    logWait(jobId, "Ses yükleniyor ve transkripsiyon isteniyor…");
    logNote(
      jobId,
      "OpenAI Transcription kullanılıyor; formdan seçilen yerel Whisper modeli bu işte uygulanmaz."
    );
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const buf = await fs.readFile(audioPath);
    const ext = path.extname(audioPath) || ".wav";
    const file = await toFile(buf, `audio${ext}`, {
      type: ext === ".wav" ? "audio/wav" : "application/octet-stream",
    });

    let oaiElapsed = 0;
    const oaiHb = setInterval(() => {
      oaiElapsed += 8;
      logBullet(
        jobId,
        `3/5 · OpenAI yanıtı bekleniyor (${oaiElapsed} sn) — büyük dosyada süre uzayabilir.`
      );
      const cur = getJob(jobId);
      if (cur?.status === "processing") {
        updateJob(jobId, {
          progressHint: `3/5 · Bulutta işleniyor (~${oaiElapsed} sn) — transkripsiyon`,
        });
      }
    }, 8000);

    let transcription: string;
    try {
      const res = await openai.audio.transcriptions.create({
        file,
        model,
        language: "tr",
        response_format: "srt",
      });
      transcription = res;
    } finally {
      clearInterval(oaiHb);
    }

    await fs.writeFile(outSrtPath, transcription, "utf-8");
    const bytes = Buffer.byteLength(transcription, "utf8");
    logOk(jobId, `Türkçe altyazı dosyası kaydedildi (${bytes} bayt).`);
    logNote(jobId, "Yerel Whisper çalıştırılmadı; işlem bulutta tamamlandı.");
    return;
  }

  const whisperFromEnv = process.env.WHISPER_CMD?.trim();
  const whisperCmdRaw = whisperFromEnv ? whisperFromEnv : "whisper";
  const whisperCmdParts = splitCommandLine(whisperCmdRaw);
  const whisperCmd = whisperCmdParts[0] ?? "whisper";
  const whisperCmdPrefixArgs = whisperCmdParts.slice(1);
  /** İş başında formdan; yoksa .env WHISPER_MODEL; yoksa large-v3 */
  const model =
    getJob(jobId)?.whisperModel?.trim() ||
    process.env.WHISPER_MODEL ||
    "large-v3";

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
  logSection(jobId, "🖥️", "3/5 — Konuşmayı yazıya dökme (yerel Whisper)");
  logBullet(
    jobId,
    "Ses bu bilgisayarda işlenir; aşağıdaki özet PyTorch’un gördüğü ortamdır (gerçek yük Whisper ile aynı Python’da çalışır)."
  );
  logOk(jobId, `Beklenen donanım özeti: ${runtimeHint}`);
  const cachePath = await detectWhisperModelCache(model);
  if (cachePath) {
    logOk(jobId, `Model önbellekte bulundu; tekrar indirme gerekmez.`);
    logTech(jobId, cachePath);
  } else {
    logNote(
      jobId,
      `Önbellekte ${model}.pt görünmüyor. İlk çalıştırmada model internetten indirilebilir (biraz sürebilir).`
    );
  }
  logBullet(jobId, `Kullanılacak model: ${model}`);
  logTech(jobId, formatShellCommand(whisperCmd, args));

  let wavBytes = 0;
  try {
    const st = await fs.stat(audioPath);
    wavBytes = st.size;
  } catch {
    /* ignore */
  }
  logBullet(
    jobId,
    `Ses dosyası yaklaşık ${(wavBytes / (1024 * 1024)).toFixed(1)} MB.${
      initialPrompt ? " Bağlam için WHISPER_INITIAL_PROMPT kullanılıyor." : ""
    }`
  );
  logNote(
    jobId,
    "Büyük model daha doğru olabilir; daha yavaş ve daha çok bellek kullanır. Uzun sessizlikler bazen normaldir. Ayrıntılı teknik log için ortam değişkeni: WHISPER_VERBOSE_LOGS=1"
  );
  logNote(
    jobId,
    "Geliştirme konsolunda yalnızca son satırlar görünür; tam günlük için sonuç sayfasındaki «İşlem günlüğü» paneline bakın (yukarı kaydırın)."
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
        /** Windows cp125x: Türkçe segment print() UnicodeEncodeError vermesin */
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
        PATH: mergedPath,
        Path: mergedPath,
      },
    });
    const t0 = Date.now();
    const base = path.basename(audioPath, path.extname(audioPath));
    const generated = path.join(jobDir, `${base}.srt`);
    const verbose = whisperVerboseLogs();
    let whisperPhaseKey = "init";
    let lastPhaseLabel =
      "Başlangıç: model belleğe alınıyor veya ilk ses parçası işleniyor (bir süre çıktı gelmeyebilir).";
    logWait(jobId, lastPhaseLabel);

    const bumpPhase = (next: WhisperPhase | null) => {
      if (!next || next.key === whisperPhaseKey) return;
      whisperPhaseKey = next.key;
      lastPhaseLabel = next.label;
      logWait(jobId, `Aşama: ${next.label}`);
    };

    const heartbeatMs = Number(process.env.WHISPER_HEARTBEAT_MS) || 10_000;

    /** Tam stdout birikimi — nabızda “son çıktı” göstermek için */
    let stdoutAccum = "";

    const whisperHeartbeatDetail = (elapsedSec: number): string => {
      if (whisperPhaseKey !== "init") {
        return `Son bilinen adım: ${lastPhaseLabel}`;
      }
      if (elapsedSec < 45) {
        return "Henüz ayrıntılı satır gelmediyse bu normal olabilir; model yükleniyor veya ilk uzun ses parçası işleniyor.";
      }
      if (elapsedSec < 120) {
        return "Bekleme uzadı; büyük modelde ilk çözümleme gecikebilir. Birazdan ilerleme veya zaman satırları görünebilir.";
      }
      return "Uzun süredir sessiz; uzun ses + büyük modelde sık görülür. İsterseniz Görev Yöneticisi’nde Python / GPU kullanımına bakın.";
    };

    /** Aynı kesiti tekrar tekrar basmamak için */
    let lastLoggedPipeDigest = "";
    /** Tamamen sessiz stderr/stdout uyarısını sık basmamak için (sn) */
    let lastEmptyPipeNoticeSec = -9999;

    const digestTail = (a: string, b: string, max = 520): string => {
      const s = `${a}\n${b}`.trim();
      if (!s) return "";
      const t = s.slice(-max).replace(/\s+/g, " ").trim();
      return t.length > 280 ? `…${t.slice(-280)}` : t;
    };

    const heartbeat = setInterval(() => {
      const sec = Math.floor((Date.now() - t0) / 1000);
      logNote(jobId, `Hâlâ çalışıyor (${sec} sn) — ${whisperHeartbeatDetail(sec)}`);

      const pipeTail = digestTail(err, stdoutAccum);
      if (pipeTail && pipeTail !== lastLoggedPipeDigest) {
        lastLoggedPipeDigest = pipeTail;
        logTech(
          jobId,
          `Whisper süreç çıktısı (stderr+stdout son kesit): ${pipeTail}`
        );
      } else if (
        sec >= 60 &&
        !pipeTail &&
        whisperPhaseKey === "init" &&
        sec - lastEmptyPipeNoticeSec >= 90
      ) {
        lastEmptyPipeNoticeSec = sec;
        logBullet(
          jobId,
          `Hâlâ stderr/stdout’ta görünür satır yok (${sec} sn) — model yüklenirken sessiz kalabilir; python.exe CPU/GPU kullanımına bakın veya WHISPER_VERBOSE_LOGS=1 deneyin.`
        );
      }

      const cur = getJob(jobId);
      if (cur?.status === "processing") {
        updateJob(jobId, {
          progressHint: `3/5 · Konuşma yazıya dökülüyor (${sec} sn) — ${lastPhaseLabel}`,
        });
      }
    }, heartbeatMs);
    let lastCueCount = 0;
    let lastCueMilestoneLogged = 0;
    const cuePollMs = Number(process.env.WHISPER_CUE_POLL_MS) || 4000;
    const cuePoll = setInterval(async () => {
      if (settled) return;
      try {
        const partial = await fs.readFile(generated, "utf-8");
        const cues = parseSrtCuesLoose(partial);
        if (cues.length <= lastCueCount) return;
        const newlyAdded = cues.slice(lastCueCount);
        const total = cues.length;
        lastCueCount = total;
        if (verbose) {
          for (const cue of newlyAdded) {
            logTech(
              jobId,
              `${cue.start} → ${cue.end} — ${cue.text.slice(0, 200)}`
            );
          }
        } else {
          const step = 18;
          if (
            total === 1 ||
            total >= lastCueMilestoneLogged + step ||
            (total >= 10 && total % 100 === 0)
          ) {
            logOk(
              jobId,
              `Geçici altyazı dosyasında ${total} satır oluştu (işlem devam ediyor).`
            );
            lastCueMilestoneLogged = total;
          }
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
    const maxProgressLines = verbose ? 500 : 48;
    /** tqdm dışı stderr (Traceback vb.) — sınırlı */
    let metaLinesLogged = 0;
    const maxMetaLines = verbose ? 120 : 48;
    let segmentLinesLogged = 0;
    const maxSegmentLines = verbose ? 10_000 : 24;

    const handleLine = (raw: string, stream: "stdout" | "stderr"): void => {
      const line = raw.trim();
      if (!line) return;

      if (isWhisperSegmentLine(line)) {
        bumpPhase({
          key: "transcribe_segments",
          label:
            "Metin üretimi: konuşma parçaları zaman damgalarıyla yazılıyor",
        });
        if (segmentLinesLogged < maxSegmentLines) {
          logTech(jobId, line.slice(0, 400));
          segmentLinesLogged++;
        } else if (segmentLinesLogged === maxSegmentLines) {
          logNote(
            jobId,
            "Çok sayıda metin satırı var; günlükte yalnızca ilk kısmı gösteriliyor. Tam liste için WHISPER_VERBOSE_LOGS=1"
          );
          segmentLinesLogged++;
        }
        return;
      }

      bumpPhase(whisperPhaseFromLine(line));

      if (isProgressNoiseLine(line)) {
        if (progressLinesLogged < maxProgressLines) {
          logTech(jobId, line.slice(0, 500));
          progressLinesLogged++;
        }
        return;
      }

      if (metaLinesLogged < maxMetaLines) {
        logTech(jobId, `[${stream}] ${line.slice(0, 600)}`);
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
      const chunk = d.toString();
      stdoutAccum += chunk;
      carryOut += chunk;
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
      logError(
        jobId,
        `Whisper başlatılamadı (${err.code ?? "?"}): ${err.message}.${hint}`
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
        logError(
          jobId,
          `Whisper beklenmedik şekilde kapandı (kod ${code}). OPENAI_API_KEY veya yerel whisper gerekli olabilir.`
        );
        if (err.trim()) {
          logTech(jobId, err.slice(-1800));
        }
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
      `Whisper çıktı dosyası oluşmadı (${generated}). Olası nedenler: (1) ffmpeg PATH’te değil — FFMPEG_PATH deneyin. (2) Windows’ta UnicodeEncodeError / charmap — konsol UTF-8 değil; uygulama whisper için PYTHONUTF8=1 ayarlar, güncel sürümle yeniden deneyin veya terminalde chcp 65001.`
    );
  }
  await fs.rename(generated, outSrtPath);
  logOk(jobId, `Yazıya dökme bitti. Kullanılan model: ${model}.`);
  logBullet(jobId, `Çıktı dosyası düzenlendi: ${base}.srt → tr.srt`);
}

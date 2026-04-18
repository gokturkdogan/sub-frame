import fs from "fs/promises";

import { translate } from "google-translate-api-x";

import {
  logBullet,
  logNote,
  logOk,
  logSection,
  logWarn,
} from "@/lib/friendly-job-log";
import { TARGET_LANGUAGES } from "@/lib/lang";
import { updateJob } from "@/lib/job-store";
import { parseOllamaEngine } from "@/lib/translate-models";
import type { SrtCue } from "@/lib/srt";
import { parseSrt, serializeSrt } from "@/lib/srt";

function envNumber(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const DELAY_BETWEEN_MS = envNumber("TRANSLATE_DELAY_MS", 1100);

const MAX_ATTEMPTS = envNumber("TRANSLATE_MAX_RETRIES", 8);
const INITIAL_BACKOFF_MS = envNumber("TRANSLATE_BACKOFF_INITIAL_MS", 1200);

const JITTER_MAX_MS = envNumber("TRANSLATE_JITTER_MAX_MS", 500);

const OLLAMA_BASE_URL =
  process.env.OLLAMA_URL?.replace(/\/$/, "") || "http://127.0.0.1:11434";
/** Küçük LLM’ler (ör. 3B) uzun JSON dizisini sık bozar; 6–8 satır daha güvenilir. */
const OLLAMA_CHUNK_LINES = envNumber("OLLAMA_CHUNK_LINES", 6);
const OLLAMA_CHUNK_DELAY_MS = envNumber("OLLAMA_CHUNK_DELAY_MS", 350);
const OLLAMA_MAX_ATTEMPTS = envNumber("OLLAMA_MAX_ATTEMPTS", 4);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function targetLanguageLabel(code: string): string {
  return TARGET_LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

async function translateLineLibre(
  text: string,
  targetLang: string,
  baseUrl: string
): Promise<string> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      q: text,
      source: "tr",
      target: targetLang,
      format: "text",
    }),
  });
  if (!res.ok) {
    throw new Error(`LibreTranslate HTTP ${res.status}`);
  }
  const data = (await res.json()) as { translatedText?: string };
  if (!data.translatedText) throw new Error("LibreTranslate: missing translatedText");
  return data.translatedText;
}

async function translateLineGoogle(
  text: string,
  targetLang: string,
  jobId: string
): Promise<string> {
  let backoff = INITIAL_BACKOFF_MS;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await translate(text, {
        to: targetLang,
        from: "tr",
        forceBatch: false,
        rejectOnPartialFail: false,
        tld: process.env.GOOGLE_TRANSLATE_TLD || "com",
      });
      const out = result.text?.trim() ?? "";
      if (out.length > 0) return out;
      logWarn(
        jobId,
        `Çeviri boş döndü; tekrar deneniyor (${attempt}/${MAX_ATTEMPTS}).`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logWarn(
        jobId,
        `Çeviri isteği sorun çıkardı (${attempt}/${MAX_ATTEMPTS}): ${msg.slice(0, 200)}`
      );
    }
    if (attempt < MAX_ATTEMPTS) {
      await sleep(backoff);
      backoff = Math.min(Math.floor(backoff * 1.6), 20_000);
    }
  }

  throw new Error(
    "Google çeviri (anahtarsız) istekleri reddetti. .env: TRANSLATE_DELAY_MS=1500 veya 2000 yapın, 10–15 dk sonra tekrar deneyin. Kalıcı çözüm: kendi sunucunuzda LIBRETRANSLATE_URL veya GOOGLE_TRANSLATE_TLD=com.tr deneyin."
  );
}

async function translateTextLine(
  text: string,
  targetLang: string,
  jobId: string,
  engine: string
): Promise<string> {
  if (engine === "libre") {
    const libre = process.env.LIBRETRANSLATE_URL;
    if (!libre?.trim()) {
      throw new Error(
        "LibreTranslate seçildi; .env içinde LIBRETRANSLATE_URL tanımlı olmalı."
      );
    }
    return translateLineLibre(text, targetLang, libre);
  }
  if (parseOllamaEngine(engine)) {
    throw new Error("Ollama motoru toplu çeviri ile kullanılmalı");
  }
  return translateLineGoogle(text, targetLang, jobId);
}

function extractJsonWithT(content: string): { t: string[] } | null {
  const trimmed = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/m, "")
    .trim();
  try {
    const o = JSON.parse(trimmed) as unknown;
    if (
      o &&
      typeof o === "object" &&
      "t" in o &&
      Array.isArray((o as { t: unknown }).t)
    ) {
      return { t: (o as { t: unknown[] }).t.map((x) => String(x ?? "")) };
    }
  } catch {
    /* try brace slice */
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const o = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
      if (
        o &&
        typeof o === "object" &&
        "t" in o &&
        Array.isArray((o as { t: unknown }).t)
      ) {
        return { t: (o as { t: unknown[] }).t.map((x) => String(x ?? "")) };
      }
    } catch {
      return null;
    }
  }
  try {
    const o = JSON.parse(trimmed) as unknown;
    if (Array.isArray(o)) {
      return { t: o.map((x) => String(x ?? "")) };
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function ollamaTranslateChunk(
  lines: string[],
  targetLang: string,
  targetLabel: string,
  model: string,
  jobId: string
): Promise<string[]> {
  const body = {
    model,
    messages: [
      {
        role: "user" as const,
        content: `Translate each Turkish subtitle line to ${targetLabel} (ISO 639-1: ${targetLang}). Preserve order; natural, concise subtitle style.

You MUST respond with a single JSON object only, no markdown, no explanation:
{"t":[${lines.map(() => '""').join(",")}]}
Replace the empty strings with translations in order. The array must have exactly ${lines.length} strings.

Turkish lines (same order):
${JSON.stringify(lines)}`,
      },
    ],
    stream: false,
    /** Ollama: yapılandırılmış çıktı — küçük modellerde JSON tutarlılığını artırır */
    format: "json",
    options: { temperature: 0.2, num_predict: 16_384 },
  };

  let lastErr = "";
  for (let attempt = 1; attempt <= OLLAMA_MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      lastErr = msg;
      logWarn(
        jobId,
        `Ollama bağlantı hatası (${OLLAMA_BASE_URL}): ${msg} — deneme ${attempt}/${OLLAMA_MAX_ATTEMPTS}`
      );
      if (attempt >= OLLAMA_MAX_ATTEMPTS) {
        throw new Error(
          `Ollama'ya bağlanılamadı (${OLLAMA_BASE_URL}). ` +
            `Genelde Ollama çalışmıyordur: https://ollama.com adresinden kurun, uygulamayı açın veya terminalde \`ollama serve\`. ` +
            `Model indirin: \`ollama pull ${model}\`. Test: \`curl ${OLLAMA_BASE_URL}/api/tags\` veya tarayıcıdan aynı adres. ` +
            `Ollama kullanmayacaksanız arayüzde çeviri motoru olarak «Google» seçin.`
        );
      }
      await sleep(800 * attempt);
      continue;
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      lastErr = `Ollama HTTP ${res.status} ${errText.slice(0, 200)}`;
      logWarn(jobId, `${lastErr} (deneme ${attempt}/${OLLAMA_MAX_ATTEMPTS})`);
      await sleep(800 * attempt);
      continue;
    }
    const data = (await res.json()) as { message?: { content?: string } };
    const content = data.message?.content?.trim() ?? "";
    const parsed = extractJsonWithT(content);
    if (
      parsed &&
      parsed.t.length === lines.length
    ) {
      return parsed.t;
    }
    lastErr = `Ollama: beklenen ${lines.length} satır, model çıktısı uyumsuz`;
    logWarn(jobId, `${lastErr} (deneme ${attempt}/${OLLAMA_MAX_ATTEMPTS})`);
    await sleep(600 * attempt);
  }
  throw new Error(
    `${lastErr}. Ollama çalışıyor mu? (${OLLAMA_BASE_URL}) Model yüklü mü: ollama pull ${model}`
  );
}

async function translateSrtWithOllama(
  cues: SrtCue[],
  targetLang: string,
  model: string,
  jobId: string
): Promise<SrtCue[]> {
  const targetLabel = targetLanguageLabel(targetLang);
  const out: SrtCue[] = [];
  const pctLo = 58;
  const pctHi = 76;
  let lineOffset = 0;

  for (let start = 0; start < cues.length; ) {
    const end = Math.min(start + OLLAMA_CHUNK_LINES, cues.length);
    const slice = cues.slice(start, end);
    const turkishLines = slice.map((c) => c.text);

    let translated: string[];
    try {
      translated = await ollamaTranslateChunk(
        turkishLines,
        targetLang,
        targetLabel,
        model,
        jobId
      );
    } catch (e) {
      const mid = Math.floor(turkishLines.length / 2);
      if (mid < 1) throw e;
      logWarn(
        jobId,
        `Ollama parça ikiye bölünüyor (${turkishLines.length} satır)`
      );
      const first = await ollamaTranslateChunk(
        turkishLines.slice(0, mid),
        targetLang,
        targetLabel,
        model,
        jobId
      );
      const second = await ollamaTranslateChunk(
        turkishLines.slice(mid),
        targetLang,
        targetLabel,
        model,
        jobId
      );
      translated = [...first, ...second];
    }

    for (let i = 0; i < slice.length; i++) {
      out.push({ ...slice[i], text: translated[i] ?? slice[i].text });
    }

    lineOffset += slice.length;
    const done = lineOffset;
    const pct =
      cues.length === 0
        ? pctLo
        : pctLo + Math.floor(((pctHi - pctLo) * done) / cues.length);
    const clamped = Math.min(pctHi, pct);
    updateJob(jobId, {
      progress: clamped,
      progressHint: `4/5 · Ollama ${done}/${cues.length} alt yazı · genel ~%${clamped}`,
    });

    start = end;
    if (start < cues.length && OLLAMA_CHUNK_DELAY_MS > 0) {
      await sleep(OLLAMA_CHUNK_DELAY_MS);
    }
  }

  return out;
}

/**
 * Translate each SRT cue from Turkish to `targetLang` (ISO 639-1 code, e.g. en, ru, es).
 * `engine`: google | libre | ollama:model
 */
export async function translateSrtFile(
  inputPath: string,
  outputPath: string,
  targetLang: string,
  jobId: string,
  engine: string
): Promise<void> {
  const raw = await fs.readFile(inputPath, "utf-8");
  const cues = parseSrt(raw);

  const ollama = parseOllamaEngine(engine);
  if (ollama) {
    logSection(jobId, "🌐", "4/5 — Metin çevirisi (Ollama)");
    logBullet(jobId, `Toplam ${cues.length} alt yazı satırı (toplu LLM).`);
    logBullet(jobId, `Hedef dil: ${targetLanguageLabel(targetLang)} (${targetLang})`);
    logBullet(jobId, `Ollama: ${OLLAMA_BASE_URL} · model: ${ollama.model}`);
    logNote(
      jobId,
      "Ollama kapalıysa veya model yoksa bu adım hata verir. Parça parça JSON döner."
    );

    const out = await translateSrtWithOllama(cues, targetLang, ollama.model, jobId);
    const normalized = out.map((c, idx) => ({ ...c, index: idx + 1 }));
    await fs.writeFile(outputPath, serializeSrt(normalized), "utf-8");
    updateJob(jobId, {
      progress: 76,
      progressHint: "4/5 · Çeviri bitti — sırada videoyla birleştirme",
    });
    logOk(jobId, "Çeviri tamamlandı; altyazı dosyası kaydedildi.");
    logBullet(jobId, outputPath);
    return;
  }

  const engineLabel =
    engine === "libre"
      ? `LibreTranslate — ${process.env.LIBRETRANSLATE_URL ?? "(URL yok)"}`
      : `Google çeviri (anahtarsız) — istekler arası yaklaşık ${DELAY_BETWEEN_MS} ms`;

  logSection(jobId, "🌐", "4/5 — Metin çevirisi");
  logBullet(jobId, `Toplam ${cues.length} alt yazı satırı çevrilecek.`);
  logBullet(jobId, `Hedef dil kodu: ${targetLang}`);
  logBullet(jobId, `Çeviri motoru: ${engineLabel}`);
  logNote(
    jobId,
    "Çok hızlı isteklerde servis geçici olarak reddedebilir; otomatik yeniden deneme vardır."
  );

  const out: SrtCue[] = [];
  const logEvery = Math.max(1, Math.min(200, Math.floor(cues.length / 8)));
  const pctLo = 58;
  const pctHi = 76;

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const text = await translateTextLine(cue.text, targetLang, jobId, engine);
    out.push({ ...cue, text });

    const done = i + 1;
    const pct =
      cues.length === 0
        ? pctLo
        : pctLo + Math.floor(((pctHi - pctLo) * done) / cues.length);
    const clamped = Math.min(pctHi, pct);
    updateJob(jobId, {
      progress: clamped,
      progressHint: `4/5 · ${done}/${cues.length} alt yazı çevrildi · genel ~%${clamped} (bu adımın içinde)`,
    });

    if (done % logEvery === 0 || done === cues.length) {
      logOk(jobId, `Çeviri ilerlemesi: ${done} / ${cues.length} satır`);
    }

    if (i + 1 < cues.length && DELAY_BETWEEN_MS > 0) {
      const jitter =
        JITTER_MAX_MS > 0 ? Math.floor(Math.random() * (JITTER_MAX_MS + 1)) : 0;
      await sleep(DELAY_BETWEEN_MS + jitter);
    }
  }

  const normalized = out.map((c, idx) => ({ ...c, index: idx + 1 }));
  await fs.writeFile(outputPath, serializeSrt(normalized), "utf-8");
  updateJob(jobId, {
    progress: 76,
    progressHint: "4/5 · Çeviri bitti — sırada videoyla birleştirme",
  });
  logOk(jobId, "Çeviri tamamlandı; altyazı dosyası kaydedildi.");
  logBullet(jobId, outputPath);
}

import fs from "fs/promises";

import { translate } from "google-translate-api-x";

import { appendJobLog } from "@/lib/job-store";
import type { SrtCue } from "@/lib/srt";
import { parseSrt, serializeSrt } from "@/lib/srt";

function envNumber(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * İstekler arası bekleme (ms). Google anonim uç noktası 300–500ms’te sık sık red verir;
 * varsayılan 1100ms + jitter.
 */
const DELAY_BETWEEN_MS = envNumber("TRANSLATE_DELAY_MS", 1100);

const MAX_ATTEMPTS = envNumber("TRANSLATE_MAX_RETRIES", 8);
const INITIAL_BACKOFF_MS = envNumber("TRANSLATE_BACKOFF_INITIAL_MS", 1200);

/** Her istekten sonra eklenen rastgele gecikme üst sınırı (ms), eşzamanlılık / limiti yumuşatır. */
const JITTER_MAX_MS = envNumber("TRANSLATE_JITTER_MAX_MS", 500);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function translateText(
  text: string,
  targetLang: string,
  jobId: string
): Promise<string> {
  const libre = process.env.LIBRETRANSLATE_URL;
  if (libre) {
    const res = await fetch(`${libre.replace(/\/$/, "")}/translate`, {
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

  let backoff = INITIAL_BACKOFF_MS;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await translate(text, {
        to: targetLang,
        from: "tr",
        /** Tekil uç nokta: paralel batch ile gelen "partial fail" riskini azaltır. */
        forceBatch: false,
        rejectOnPartialFail: false,
        tld: process.env.GOOGLE_TRANSLATE_TLD || "com",
      });
      const out = result.text?.trim() ?? "";
      if (out.length > 0) return out;
      appendJobLog(
        jobId,
        `[çeviri] boş yanıt, tekrar (${attempt}/${MAX_ATTEMPTS})`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendJobLog(
        jobId,
        `[çeviri] deneme ${attempt}/${MAX_ATTEMPTS}: ${msg.slice(0, 200)}`
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

/**
 * Translate each SRT cue from Turkish to `targetLang` (ISO 639-1 code, e.g. en, ru, es).
 */
export async function translateSrtFile(
  inputPath: string,
  outputPath: string,
  targetLang: string,
  jobId: string
): Promise<void> {
  const raw = await fs.readFile(inputPath, "utf-8");
  const cues = parseSrt(raw);
  const out: SrtCue[] = [];

  const engine = process.env.LIBRETRANSLATE_URL
    ? `LibreTranslate (${process.env.LIBRETRANSLATE_URL})`
    : `google-translate-api-x (tekil istek, aralık=${DELAY_BETWEEN_MS}ms)`;
  appendJobLog(
    jobId,
    `Çeviri başlıyor: ${cues.length} alt yazı, hedef=${targetLang}, motor=${engine}`
  );

  const logEvery = Math.max(1, Math.min(200, Math.floor(cues.length / 15)));

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const text = await translateText(cue.text, targetLang, jobId);
    out.push({ ...cue, text });

    const done = i + 1;
    if (done % logEvery === 0 || done === cues.length) {
      appendJobLog(jobId, `Çeviri ilerleme: ${done}/${cues.length} alt yazı`);
    }

    if (i + 1 < cues.length && DELAY_BETWEEN_MS > 0) {
      const jitter =
        JITTER_MAX_MS > 0 ? Math.floor(Math.random() * (JITTER_MAX_MS + 1)) : 0;
      await sleep(DELAY_BETWEEN_MS + jitter);
    }
  }

  const normalized = out.map((c, idx) => ({ ...c, index: idx + 1 }));
  await fs.writeFile(outputPath, serializeSrt(normalized), "utf-8");
  appendJobLog(jobId, `Çeviri bitti, dosya: ${outputPath}`);
}

import fs from "fs/promises";

import { translate } from "google-translate-api-x";

import { appendJobLog } from "@/lib/job-store";
import type { SrtCue } from "@/lib/srt";
import { parseSrt, serializeSrt } from "@/lib/srt";

/** İstekler arası bekleme (ms). Çok düşük = Google rate limit / red. */
const DELAY_BETWEEN_MS =
  Number(process.env.TRANSLATE_DELAY_MS) >= 0
    ? Number(process.env.TRANSLATE_DELAY_MS)
    : 450;

const MAX_ATTEMPTS = Number(process.env.TRANSLATE_MAX_RETRIES) || 6;
const INITIAL_BACKOFF_MS = 900;

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
    "Google çeviri art arda reddetti. TRANSLATE_DELAY_MS artırın, bir süre sonra tekrar deneyin veya LIBRETRANSLATE_URL kullanın."
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
      await sleep(DELAY_BETWEEN_MS);
    }
  }

  const normalized = out.map((c, idx) => ({ ...c, index: idx + 1 }));
  await fs.writeFile(outputPath, serializeSrt(normalized), "utf-8");
  appendJobLog(jobId, `Çeviri bitti, dosya: ${outputPath}`);
}

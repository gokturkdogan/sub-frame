/**
 * Yerel OpenAI Whisper CLI (`pip install openai-whisper`) model adları.
 * İstemci ve sunucu aynı listeyi kullanır; sunucu ek doğrulama yapar.
 */
export type WhisperModelOption = {
  value: string;
  label: string;
  hint: string;
};

export const WHISPER_MODEL_OPTIONS: WhisperModelOption[] = [
  { value: "tiny", label: "tiny", hint: "En hızlı, en düşük doğruluk" },
  { value: "base", label: "base", hint: "Hızlı önizleme" },
  { value: "small", label: "small", hint: "Daha hızlı, orta doğruluk" },
  { value: "medium", label: "medium", hint: "Dengeli (hız / kalite)" },
  { value: "large", label: "large", hint: "Yüksek doğruluk, daha ağır" },
  { value: "large-v2", label: "large-v2", hint: "large sürüm 2" },
  {
    value: "large-v3",
    label: "large-v3 (önerilen)",
    hint: "Genelde en iyi Türkçe; daha yavaş ve çok RAM/VRAM",
  },
];

export const DEFAULT_WHISPER_MODEL = "large-v3";

const ALLOWED = new Set(WHISPER_MODEL_OPTIONS.map((o) => o.value));

export function isAllowedWhisperModel(value: string): boolean {
  return ALLOWED.has(value.trim());
}

/** Sunucu: .env varsayılanı geçerliyse onu, değilse large-v3 */
export function serverDefaultWhisperModel(): string {
  const env = process.env.WHISPER_MODEL?.trim();
  if (env && isAllowedWhisperModel(env)) return env;
  return DEFAULT_WHISPER_MODEL;
}

/** Form veya istemciden gelen değeri güvenli biçimde model adına çevir */
export function normalizeWhisperModelInput(
  raw: string,
  fallback: string
): string {
  const t = raw.trim();
  return isAllowedWhisperModel(t) ? t : fallback;
}

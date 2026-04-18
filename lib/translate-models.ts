export type TranslateEngineOption = {
  value: string;
  label: string;
  hint: string;
};

/** İstemci + sunucu aynı listeyi kullanır. */
export const TRANSLATE_ENGINE_OPTIONS: TranslateEngineOption[] = [
  {
    value: "google",
    label: "Google (google-translate-api-x)",
    hint: "Anahtarsız web çevirisi; yoğun kullanımda limit riski",
  },
  {
    value: "libre",
    label: "LibreTranslate (kendi sunucun)",
    hint: ".env içinde LIBRETRANSLATE_URL gerekli",
  },
  {
    value: "ollama:qwen2.5:3b",
    label: "Ollama · qwen2.5:3b",
    hint: "Lokal; hızlı, daha hafif model",
  },
  {
    value: "ollama:qwen2.5:7b",
    label: "Ollama · qwen2.5:7b",
    hint: "Lokal; RTX 3060 Ti için iyi denge",
  },
  {
    value: "ollama:qwen2.5:14b",
    label: "Ollama · qwen2.5:14b",
    hint: "Lokal; daha ağır, daha güçlü kart önerilir",
  },
];

export const DEFAULT_TRANSLATE_ENGINE = "google";

const ALLOWED = new Set(TRANSLATE_ENGINE_OPTIONS.map((o) => o.value));

export function isAllowedTranslateEngine(value: string): boolean {
  return ALLOWED.has(value.trim());
}

export function serverDefaultTranslateEngine(): string {
  const env = process.env.TRANSLATE_ENGINE?.trim();
  if (env && isAllowedTranslateEngine(env)) return env;
  return DEFAULT_TRANSLATE_ENGINE;
}

export function normalizeTranslateEngineInput(
  raw: string,
  fallback: string
): string {
  const t = raw.trim();
  return isAllowedTranslateEngine(t) ? t : fallback;
}

export function parseOllamaEngine(
  engine: string
): { kind: "ollama"; model: string } | null {
  if (!engine.startsWith("ollama:")) return null;
  const model = engine.slice("ollama:".length).trim();
  if (!model) return null;
  return { kind: "ollama", model };
}

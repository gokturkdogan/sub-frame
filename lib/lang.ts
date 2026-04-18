/** SVG bayraklar — emoji yerine tüm platformlarda tutarlı görünüm (public/flags/) */
export const TARGET_LANGUAGES: { code: string; label: string; flagSrc: string }[] = [
  { code: "tr", label: "Türkçe", flagSrc: "/flags/tr.svg" },
  { code: "en", label: "İngilizce", flagSrc: "/flags/gb.svg" },
  { code: "ru", label: "Rusça", flagSrc: "/flags/ru.svg" },
];

/** Whisper zaten Türkçe SRT üretir; bu dilde çeviri adımı atlanır. */
export function isTurkishSubtitleTarget(targetLang: string): boolean {
  return targetLang.split("-")[0]?.toLowerCase() === "tr";
}

/**
 * ISO 639-2/T three-letter tag for MP4 subtitle metadata (`-metadata:s:s:0 language=`).
 */
export function subtitleLanguageTag(iso639_1: string): string {
  const base = iso639_1.split("-")[0] ?? iso639_1;
  const map: Record<string, string> = {
    en: "eng",
    ru: "rus",
    es: "spa",
    de: "deu",
    fr: "fra",
    it: "ita",
    pt: "por",
    ar: "ara",
    zh: "zho",
    ja: "jpn",
    ko: "kor",
    tr: "tur",
    nl: "nld",
    pl: "pol",
    uk: "ukr",
    hi: "hin",
  };
  return map[base] ?? "und";
}

/**
 * İndirilebilir MP4 için güvenli dosya adı — işlem seçeneklerini içerir.
 * Benzersizlik: job UUID’nin kısaltılmış hâli.
 */

export function sanitizeFilenameSegment(s: string, max = 56): string {
  let t = s
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-");
  t = t.replace(/-+/g, "-").replace(/^-|-$/g, "");
  const out = t.slice(0, max).replace(/-+$/, "") || "subframe";
  return out;
}

export function buildSubframeVideoFilename(opts: {
  jobId: string;
  whisperModel: string;
  targetLang: string;
  translateEngine: string;
  turkishOnly: boolean;
}): string {
  const idCompact = opts.jobId.replace(/-/g, "");
  const shortId = idCompact.slice(0, 8);
  const w = sanitizeFilenameSegment(opts.whisperModel, 40);
  const lang = sanitizeFilenameSegment(opts.targetLang, 12);
  let name = `subframe-${shortId}-w-${w}-lang-${lang}`;
  if (!opts.turkishOnly) {
    const tr = sanitizeFilenameSegment(
      opts.translateEngine.replace(/:/g, "-"),
      48
    );
    name += `-cv-${tr}`;
  }
  return `${name}.mp4`;
}

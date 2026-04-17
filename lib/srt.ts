export type SrtCue = {
  index: number;
  start: string;
  end: string;
  text: string;
};

/**
 * Parse SRT content into cues (supports multi-line cue text).
 */
export function parseSrt(content: string): SrtCue[] {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const blocks = normalized.split(/\n\n+/);
  const cues: SrtCue[] = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length < 2) continue;

    let i = 0;
    const first = lines[0]?.trim() ?? "";
    if (/^\d+$/.test(first)) {
      i = 1;
    }

    const timeLine = lines[i];
    const m = timeLine?.match(
      /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/
    );
    if (!m) continue;

    const textLines = lines.slice(i + 1);
    const text = textLines.join("\n").trim();
    if (!text) continue;

    cues.push({
      index: cues.length + 1,
      start: m[1],
      end: m[2],
      text,
    });
  }

  return cues;
}

export function serializeSrt(cues: SrtCue[]): string {
  return cues
    .map((c, idx) => {
      const n = idx + 1;
      return `${n}\n${c.start} --> ${c.end}\n${c.text}\n`;
    })
    .join("\n");
}

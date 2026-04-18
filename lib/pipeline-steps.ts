/**
 * İşlem hattı — API `stepCode` ile senkron; sonuç sayfası checklist için kullanılır.
 * Hata durumunda `stepCode` son başarılı adımda kalır; `status === "failed"` ile ayırt edilir.
 */
export type PipelineStepCode =
  | "queued"
  | "saving_video"
  | "video_ready"
  | "extract_audio"
  | "transcribe"
  | "translate"
  | "mux"
  | "completed";

export type UiPipelineStep = {
  id: "video" | "audio" | "transcribe" | "translate" | "mux";
  label: string;
  labelWhenSkipped: string;
  dotClass: string;
  ringClass: string;
};

export const UI_PIPELINE_STEPS: UiPipelineStep[] = [
  {
    id: "video",
    label: "Video alındı",
    labelWhenSkipped: "Video alındı",
    dotClass: "fill-sky-500",
    ringClass: "ring-sky-500/45",
  },
  {
    id: "audio",
    label: "Ses videodan çıkarılıyor",
    labelWhenSkipped: "Ses videodan çıkarılıyor",
    dotClass: "fill-cyan-500",
    ringClass: "ring-cyan-500/45",
  },
  {
    id: "transcribe",
    label: "Konuşma yazıya dönüyor",
    labelWhenSkipped: "Konuşma yazıya dönüyor",
    dotClass: "fill-violet-500",
    ringClass: "ring-violet-500/45",
  },
  {
    id: "translate",
    label: "Metin çevriliyor",
    labelWhenSkipped: "Çeviri atlandı (Türkçe hedef)",
    dotClass: "fill-amber-500",
    ringClass: "ring-amber-500/45",
  },
  {
    id: "mux",
    label: "Altyazı videoya gömülüyor",
    labelWhenSkipped: "Altyazı videoya gömülüyor",
    dotClass: "fill-fuchsia-500",
    ringClass: "ring-fuchsia-500/45",
  },
];

/** Aktif satır 0–4; 5 = tamamlandı (hepsi bitti). */
export function currentRowFromCode(code: PipelineStepCode | undefined): number {
  switch (code) {
    case "saving_video":
    case "video_ready":
      return 0;
    case "extract_audio":
      return 1;
    case "transcribe":
      return 2;
    case "translate":
      return 3;
    case "mux":
      return 4;
    case "completed":
      return 5;
    case "queued":
    default:
      return 0;
  }
}

export type RowState = "pending" | "active" | "done" | "skipped";

export function rowState(
  rowIndex: number,
  code: PipelineStepCode | undefined,
  status: string | undefined,
  skipTranslate: boolean | undefined
): RowState {
  if (status === "completed") return "done";

  const cr = currentRowFromCode(code);

  if (rowIndex === 3 && skipTranslate) {
    if (cr <= 2) return "pending";
    if (cr >= 4 || code === "completed") return "skipped";
    return "pending";
  }

  if (status === "failed") {
    if (cr >= 5) return "done";
    if (rowIndex < cr) return "done";
    if (rowIndex === cr) return "active";
    return "pending";
  }

  if (cr === 5 || code === "completed") return "done";

  if (rowIndex < cr) return "done";
  if (rowIndex === cr) return "active";
  return "pending";
}

export function rowLabel(
  rowIndex: number,
  step: UiPipelineStep,
  state: RowState,
  skipTranslate?: boolean
): string {
  if (rowIndex === 3 && skipTranslate && state === "pending") {
    return "Çeviri (Türkçe hedef — bu adım atlanacak)";
  }
  if (rowIndex === 3 && state === "skipped") return step.labelWhenSkipped;
  return step.label;
}

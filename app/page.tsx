"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { AppShell } from "@/components/app-shell";
import { LanguageSelect } from "@/components/language-select";
import { WhisperModelSelect } from "@/components/whisper-model-select";
import { TechStackBadges } from "@/components/tech-stack-badges";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { TARGET_LANGUAGES } from "@/lib/lang";
import {
  DEFAULT_WHISPER_MODEL,
  WHISPER_MODEL_OPTIONS,
} from "@/lib/whisper-models";
import { cn } from "@/lib/utils";
import { Sparkles, Upload, X } from "lucide-react";

export default function HomePage() {
  const router = useRouter();
  const [file, setFile] = React.useState<File | null>(null);
  const [targetLang, setTargetLang] = React.useState("tr");
  const [whisperModel, setWhisperModel] = React.useState(DEFAULT_WHISPER_MODEL);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [videoThumb, setVideoThumb] = React.useState<string | null>(null);
  const [thumbPending, setThumbPending] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const videoObjectUrl = React.useMemo(() => {
    if (!file) return null;
    return URL.createObjectURL(file);
  }, [file]);

  React.useEffect(() => {
    return () => {
      if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl);
    };
  }, [videoObjectUrl]);

  React.useEffect(() => {
    if (!file || !videoObjectUrl) {
      setVideoThumb(null);
      setThumbPending(false);
      return;
    }

    setVideoThumb(null);
    setThumbPending(true);

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = videoObjectUrl;

    let cancelled = false;

    const detach = () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      video.removeAttribute("src");
      video.load();
    };

    const onError = () => {
      if (cancelled) return;
      setVideoThumb(null);
      setThumbPending(false);
      detach();
    };

    const onLoadedMetadata = () => {
      if (cancelled) return;
      const d = video.duration;
      // ~15. saniye: uzun videolarda anlamlı kare; kısa clip’te sürenin sonuna yakın (seek taşmasın).
      const t =
        Number.isFinite(d) && d > 0
          ? Math.min(15, Math.max(0.05, d - 0.05))
          : 0.1;
      video.currentTime = t;
    };

    const onSeeked = () => {
      if (cancelled) return;
      try {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh) {
          setThumbPending(false);
          detach();
          return;
        }
        const maxW = 720;
        const scale = Math.min(1, maxW / vw);
        const cw = Math.round(vw * scale);
        const ch = Math.round(vh * scale);
        const canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          setThumbPending(false);
          detach();
          return;
        }
        ctx.drawImage(video, 0, 0, cw, ch);
        setVideoThumb(canvas.toDataURL("image/jpeg", 0.82));
      } catch {
        setVideoThumb(null);
      } finally {
        setThumbPending(false);
        detach();
      }
    };

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    video.load();

    return () => {
      cancelled = true;
      detach();
    };
  }, [file, videoObjectUrl]);

  const onPick = (f: File | null) => {
    setError(null);
    setFile(f);
  };

  const onClearFile = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setError(null);
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError("Lütfen bir video dosyası seçin.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("targetLang", targetLang);
      body.set("whisperModel", whisperModel);
      const res = await fetch("/api/process", { method: "POST", body });
      const data = (await res.json()) as { jobId?: string; error?: string };
      if (!res.ok) {
        throw new Error(data.error || "İstek başarısız");
      }
      if (!data.jobId) throw new Error("İş kimliği alınamadı");
      router.push(`/result?job=${encodeURIComponent(data.jobId)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bir hata oluştu");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell mainClassName="justify-start pt-11 pb-8 sm:pt-14 sm:pb-10">
      <div className="relative mb-6 space-y-5 text-center sm:mb-8 sm:space-y-6 sm:text-left">
        <div
          className="pointer-events-none absolute -left-24 top-0 size-72 rounded-full bg-gradient-to-tr from-violet-500/25 via-fuchsia-500/15 to-transparent blur-3xl dark:from-violet-600/20 dark:via-fuchsia-500/10 animate-hero-glow"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -right-20 top-24 size-64 rounded-full bg-gradient-to-bl from-fuchsia-500/20 to-violet-600/10 blur-3xl dark:from-fuchsia-500/15 dark:to-violet-500/10 animate-hero-glow [animation-delay:1.2s]"
          aria-hidden
        />

        <div className="relative inline-flex">
          <span className="absolute -inset-1 rounded-full bg-gradient-to-r from-violet-500/40 via-fuchsia-500/30 to-violet-500/40 opacity-60 blur-md animate-border-glow" />
          <div className="relative inline-flex items-center gap-2 rounded-full border border-violet-500/25 bg-background/80 px-4 py-1.5 text-xs font-semibold text-violet-800 shadow-lg shadow-violet-500/10 backdrop-blur-md dark:border-violet-400/30 dark:bg-background/60 dark:text-violet-100">
            <Sparkles className="size-3.5 animate-pulse text-fuchsia-500 dark:text-fuchsia-400" />
            Konuşma → metin → çeviri → MP4
          </div>
        </div>

        <div className="relative space-y-4">
          <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-5xl">
            <span className="bg-gradient-to-r from-foreground via-foreground to-muted-foreground bg-clip-text text-transparent dark:from-white dark:via-white dark:to-white/70">
              Videonuzu
            </span>{" "}
            <span className="bg-gradient-to-r from-violet-600 via-fuchsia-500 to-violet-600 bg-clip-text text-transparent animate-gradient-flow dark:from-violet-400 dark:via-fuchsia-400 dark:to-violet-400">
              altyazılı
            </span>{" "}
            <span className="text-foreground dark:text-white/95">hazırlayın</span>
          </h1>
          <p className="mx-auto max-w-lg text-pretty text-sm leading-relaxed text-muted-foreground sm:mx-0 sm:text-base">
            Türkçe konuşmayı yazıya döker, seçtiğiniz dile çevirir ve yumuşak altyazılı MP4 üretir.
          </p>
        </div>

        <TechStackBadges className="relative pt-1" />
      </div>

      <Card className="group/card relative overflow-visible border-border/50 bg-card/70 shadow-2xl shadow-violet-500/10 ring-1 ring-violet-500/15 backdrop-blur-md transition duration-500 hover:shadow-violet-500/20 dark:bg-card/50 dark:shadow-black/30 dark:ring-violet-400/15">
        <div
          className="pointer-events-none absolute -right-24 -top-24 size-56 rounded-full bg-gradient-to-br from-violet-500/30 to-fuchsia-500/10 blur-3xl transition duration-700 group-hover/card:scale-110 group-hover/card:opacity-90"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-16 -left-16 size-48 rounded-full bg-gradient-to-tr from-fuchsia-500/15 to-transparent blur-2xl"
          aria-hidden
        />

        <CardHeader className="relative space-y-0 pb-3">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
            <CardTitle className="min-w-0 flex-1 text-xl font-semibold tracking-tight sm:text-2xl">
              Video ve dil
            </CardTitle>
            <WhisperModelSelect
              id="whisper-model"
              label="Model"
              options={WHISPER_MODEL_OPTIONS}
              value={whisperModel}
              onChange={setWhisperModel}
              fullWidth
              className="w-full min-w-0 sm:ml-auto sm:max-w-[17.5rem]"
            />
          </div>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent className="relative flex flex-col gap-7 pt-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Video</Label>
              <button
                type="button"
                onDragOver={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                }}
                onDrop={(ev) => {
                  ev.preventDefault();
                  const f = ev.dataTransfer.files?.[0];
                  if (f) onPick(f);
                }}
                onClick={() => inputRef.current?.click()}
                className={cn(
                  "group/dz relative flex w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-violet-400/45 bg-gradient-to-b from-muted/50 to-muted/15 text-muted-foreground shadow-inner transition duration-500 hover:-translate-y-0.5 hover:border-fuchsia-400/55 hover:from-violet-500/10 hover:to-fuchsia-500/5 hover:shadow-[0_0_48px_-12px_rgba(139,92,246,0.45)] dark:border-violet-500/35 dark:from-muted/25 dark:to-muted/5 dark:hover:border-fuchsia-400/40",
                  file
                    ? "gap-0 px-0 py-0"
                    : "gap-4 px-6 py-16 text-center text-sm",
                )}
              >
                <span className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_30%,oklch(0.72_0.19_280/0.12),transparent_55%)] opacity-0 transition duration-500 group-hover/dz:opacity-100" />
                {file ? (
                  <div className="relative flex w-full flex-col">
                    <div className="relative aspect-video w-full overflow-hidden bg-black/30">
                      {thumbPending && !videoThumb ? (
                        <div
                          className="absolute inset-0 flex items-center justify-center bg-muted/50"
                          aria-busy
                        >
                          <span className="text-xs text-muted-foreground">
                            Önizleme hazırlanıyor…
                          </span>
                        </div>
                      ) : videoThumb ? (
                        <img
                          src={videoThumb}
                          alt=""
                          className="absolute inset-0 size-full object-cover"
                        />
                      ) : (
                        <div
                          className="absolute inset-0 bg-muted/40"
                          aria-hidden
                        />
                      )}
                      <div className="absolute right-2 top-2 z-10">
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon"
                          className="size-9 rounded-full border border-border/60 bg-background/85 shadow-md backdrop-blur-sm hover:bg-background"
                          onClick={onClearFile}
                          aria-label="Videoyu kaldır"
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="border-t border-border/50 bg-muted/20 px-4 py-3 text-center text-sm sm:px-6">
                      <span className="font-semibold text-foreground break-all">
                        {file.name}
                      </span>
                    </div>
                  </div>
                ) : (
                  <>
                    <span className="relative flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/25 to-fuchsia-500/15 text-violet-600 shadow-lg shadow-violet-500/20 ring-2 ring-violet-400/20 transition duration-500 group-hover/dz:scale-110 group-hover/dz:shadow-xl group-hover/dz:shadow-violet-500/30 dark:text-violet-300 dark:ring-violet-400/25">
                      <Upload className="size-8" strokeWidth={1.5} />
                    </span>
                    <span className="relative max-w-sm">
                      <span className="font-semibold text-foreground">
                        Sürükleyin veya tıklayın
                      </span>
                      <span className="text-muted-foreground"> — MP4, MOV, MKV…</span>
                    </span>
                  </>
                )}
              </button>
              <input
                ref={inputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(ev) => onPick(ev.target.files?.[0] ?? null)}
              />
            </div>

            <div className="flex flex-col gap-4 border-t border-border/40 bg-gradient-to-t from-muted/30 to-transparent pt-6 sm:flex-row sm:items-end sm:gap-4">
              <LanguageSelect
                id="lang"
                label="Altyazı dili"
                languages={TARGET_LANGUAGES}
                value={targetLang}
                onChange={setTargetLang}
                fullWidth
                className="min-w-0 flex-1"
              />
              <Button
                type="submit"
                disabled={busy}
                size="lg"
                className="group/submit relative h-12 w-full shrink-0 overflow-hidden rounded-xl border border-white/15 bg-gradient-to-r from-violet-600 via-fuchsia-600 to-violet-600 bg-[length:200%_100%] text-base font-semibold tracking-tight text-white shadow-lg shadow-violet-500/25 transition-all duration-300 animate-gradient-flow hover:border-white/35 hover:shadow-[0_0_0_1px_rgba(255,255,255,0.2),0_8px_40px_-4px_rgba(167,139,250,0.55),0_0_60px_-12px_rgba(217,70,239,0.35)] hover:brightness-[1.08] active:scale-[0.98] disabled:hover:shadow-none disabled:hover:brightness-100 dark:border-white/10 dark:text-white dark:shadow-violet-900/40 dark:hover:border-white/30 dark:hover:shadow-[0_0_0_1px_rgba(255,255,255,0.15),0_8px_48px_-4px_rgba(139,92,246,0.45),0_0_80px_-8px_rgba(192,132,252,0.35)] dark:hover:brightness-110 sm:w-auto sm:min-w-[220px]"
              >
                <span
                  className="pointer-events-none absolute inset-0 z-[1] -translate-x-full skew-x-[-12deg] bg-gradient-to-r from-transparent via-white/25 to-transparent opacity-0 transition-all duration-700 ease-out group-hover/submit:translate-x-full group-hover/submit:opacity-100 group-disabled/submit:opacity-0"
                  aria-hidden
                />
                <span className="relative z-[2] drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]">
                  {busy ? "Başlatılıyor…" : "Videoyu işle"}
                </span>
              </Button>
            </div>

            {error ? (
              <p
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                {error}
              </p>
            ) : null}
          </CardContent>
        </form>
      </Card>
    </AppShell>
  );
}

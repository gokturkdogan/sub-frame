"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { AppShell } from "@/components/app-shell";
import { PipelineStatusChecklist } from "@/components/pipeline-status-checklist";
import { TechStackBadges } from "@/components/tech-stack-badges";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import {
  CheckCircle2,
  Download,
  Loader2,
  PartyPopper,
  Terminal,
  XCircle,
} from "lucide-react";

import type { PipelineStepCode } from "@/lib/pipeline-steps";
import { cn } from "@/lib/utils";

type StatusPayload = {
  status: string;
  progress: number;
  step: string;
  progressHint?: string;
  stepCode?: string;
  skipTranslate?: boolean;
  error?: string;
  downloadPath?: string;
  logs?: string[];
};

export function ResultClient() {
  const router = useRouter();
  const params = useSearchParams();
  const jobId = params.get("job");

  const [data, setData] = React.useState<StatusPayload | null>(null);
  /** İş tamamlandıktan sonra /status 404 verse bile (TTL) başarı ekranını koru */
  const sawCompletedRef = React.useRef(false);

  React.useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    sawCompletedRef.current = false;
    let intervalId: number | null = null;

    const poll = async () => {
      try {
        const res = await fetch(`/api/status/${jobId}`);
        if (!res.ok) {
          if (res.status === 404 && sawCompletedRef.current) {
            return;
          }
          if (!cancelled) {
            setData({
              status: "failed",
              progress: 0,
              step: "Bulunamadı",
              error: "Bu iş bulunamadı veya süresi doldu.",
            });
          }
          return;
        }
        const j = (await res.json()) as StatusPayload;
        if (!cancelled) {
          setData(j);
          if (j.status === "completed") {
            sawCompletedRef.current = true;
            if (intervalId !== null) {
              clearInterval(intervalId);
              intervalId = null;
            }
          }
        }
      } catch {
        if (!cancelled) {
          setData({
            status: "failed",
            progress: 0,
            step: "Hata",
            error: "Sunucuya ulaşılamadı.",
          });
        }
      }
    };

    void poll();
    intervalId = window.setInterval(poll, 1500);
    return () => {
      cancelled = true;
      if (intervalId !== null) clearInterval(intervalId);
    };
  }, [jobId]);

  const displayProgress =
    data?.status === "completed"
      ? 100
      : data?.status === "failed"
        ? Math.min(data.progress || 0, 100)
        : Math.min(100, data?.progress ?? 0);

  if (!jobId) {
    return (
      <AppShell mainClassName="justify-center">
        <Card className="border-border/60 bg-card/80 shadow-lg backdrop-blur-sm dark:bg-card/60">
          <CardHeader>
            <div className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <XCircle className="size-6" />
            </div>
            <CardTitle className="text-xl">İş bulunamadı</CardTitle>
            <CardDescription>
              Yeni bir iş oluşturmak için yükleme sayfasına dönün.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Link href="/" className={cn(buttonVariants())}>
              Yüklemeye dön
            </Link>
          </CardFooter>
        </Card>
      </AppShell>
    );
  }

  const done = data?.status === "completed";
  const failed = data?.status === "failed";
  const processing = !done && !failed;
  const downloadHref = data?.downloadPath || `/api/download/${jobId}`;

  return (
    <AppShell mainClassName="justify-center">
      <Card className="relative overflow-hidden border-border/60 bg-card/80 shadow-xl shadow-violet-500/5 ring-1 ring-violet-500/10 backdrop-blur-sm dark:bg-card/60 dark:shadow-black/20 dark:ring-violet-400/10">
        <div
          className={cn(
            "pointer-events-none absolute -right-16 -top-16 size-48 rounded-full blur-3xl",
            done && "bg-emerald-500/15",
            failed && "bg-destructive/10",
            processing && "bg-violet-500/15"
          )}
          aria-hidden
        />

        <CardHeader className="relative space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div
              className={cn(
                "flex size-12 shrink-0 items-center justify-center rounded-2xl ring-1",
                done &&
                  "bg-emerald-500/15 text-emerald-600 ring-emerald-500/25 dark:text-emerald-400",
                failed && "bg-destructive/10 text-destructive ring-destructive/20",
                processing &&
                  "bg-violet-500/10 text-violet-600 ring-violet-500/20 dark:text-violet-400"
              )}
            >
              {done ? (
                <PartyPopper className="size-6" strokeWidth={1.75} />
              ) : failed ? (
                <XCircle className="size-6" strokeWidth={1.75} />
              ) : (
                <Loader2 className="size-6 animate-spin" strokeWidth={1.75} />
              )}
            </div>
            {processing && data ? (
              <span className="inline-flex w-fit items-center rounded-full border border-violet-500/25 bg-violet-500/10 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-violet-700 dark:text-violet-300">
                İşleniyor
              </span>
            ) : null}
            {done ? (
              <span className="inline-flex w-fit items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
                <CheckCircle2 className="size-3" />
                Tamamlandı
              </span>
            ) : null}
            {failed ? (
              <span className="inline-flex w-fit items-center rounded-full border border-destructive/25 bg-destructive/10 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-destructive">
                Hata
              </span>
            ) : null}
          </div>

          <div>
            <CardTitle className="text-xl font-semibold tracking-tight sm:text-2xl">
              {done ? "İndirmeye hazırsınız" : failed ? "İşlem tamamlanamadı" : "Videonuz işleniyor"}
            </CardTitle>
            <CardDescription className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground">
              {done
                ? "MP4 indirilebilir."
                : failed
                  ? "Aşağıdaki hatayı ve adımları kontrol edin."
                  : !data
                    ? "Bağlanıyor…"
                    : "İşlem adımları aşağıda güncellenir."}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="relative space-y-5">
          {data ? (
            <PipelineStatusChecklist
              stepCode={data.stepCode as PipelineStepCode | undefined}
              status={data.status}
              skipTranslate={data.skipTranslate}
            />
          ) : null}

          {!failed ? (
            <div className="space-y-2">
              {(processing || done) && data?.step ? (
                <div className="space-y-1">
                  <p
                    className={cn(
                      "text-sm font-semibold leading-snug",
                      done ? "text-emerald-800 dark:text-emerald-300" : "text-foreground"
                    )}
                  >
                    {data.step}
                  </p>
                  {data.progressHint ? (
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {data.progressHint}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <Progress value={displayProgress} max={100} className="w-full flex-col gap-2">
                <div className="flex w-full items-start justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <ProgressLabel className="text-sm font-medium">
                      Genel ilerleme
                    </ProgressLabel>
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      Yüzde, tüm adımların tahmini toplam yüküdür; uzun süren bir adımda yavaş
                      artması normaldir.
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="text-lg font-bold tabular-nums text-violet-600 dark:text-violet-400">
                      {Math.round(displayProgress)}
                    </span>
                    <span className="text-sm font-semibold text-violet-600/90 dark:text-violet-400/90">
                      %
                    </span>
                  </div>
                </div>
              </Progress>
            </div>
          ) : null}

          {failed ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">
              {data?.error}
            </p>
          ) : !done ? (
            <p className="flex items-center gap-2 rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2.5 text-xs text-muted-foreground sm:text-sm">
              <Loader2 className="size-4 shrink-0 animate-spin text-violet-600 dark:text-violet-400" />
              Uzun sürebilir; bu sekmeyi açık tutun.
            </p>
          ) : null}

          {(data?.logs?.length ?? 0) > 0 ? (
            <div className="space-y-2 pt-1">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Terminal className="size-3.5 shrink-0 text-violet-600 dark:text-violet-400" />
                İşlem günlüğü
              </div>
              <pre
                className="max-h-80 overflow-auto overflow-x-auto rounded-xl border border-border/80 bg-muted/30 p-3 text-left text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-all text-foreground shadow-inner"
                tabIndex={0}
              >
                {(data?.logs ?? []).join("\n")}
              </pre>
            </div>
          ) : null}
        </CardContent>

        <CardFooter className="relative flex flex-col gap-5 border-t border-border/50 bg-muted/20 pt-6">
          <TechStackBadges compact className="justify-center opacity-90" />
          <div className="flex flex-wrap gap-3">
          {done ? (
            <a
              href={downloadHref}
              download
              className={cn(
                buttonVariants({ size: "lg" }),
                "inline-flex items-center gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-600 font-semibold shadow-lg shadow-violet-500/25 hover:opacity-95 dark:shadow-violet-900/40"
              )}
            >
              <Download className="size-4" />
              MP4 indir
            </a>
          ) : null}
          <Button
            type="button"
            variant={done ? "outline" : "default"}
            size={done ? "default" : "lg"}
            className={cn(!done && "bg-gradient-to-r from-violet-600 to-fuchsia-600 font-semibold shadow-md")}
            onClick={() => router.push("/")}
          >
            Yeni yükleme
          </Button>
          </div>
        </CardFooter>
      </Card>
    </AppShell>
  );
}

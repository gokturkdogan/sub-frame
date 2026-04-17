"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { ModeToggle } from "@/components/mode-toggle";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Progress,
  ProgressLabel,
  ProgressTrack,
  ProgressIndicator,
} from "@/components/ui/progress";
import { Download, Film, Loader2, Terminal } from "lucide-react";

import { cn } from "@/lib/utils";

type StatusPayload = {
  status: string;
  progress: number;
  step: string;
  error?: string;
  downloadPath?: string;
  logs?: string[];
};

export function ResultClient() {
  const router = useRouter();
  const params = useSearchParams();
  const jobId = params.get("job");

  const [data, setData] = React.useState<StatusPayload | null>(null);

  React.useEffect(() => {
    if (!jobId) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/status/${jobId}`);
        if (!res.ok) {
          setData({
            status: "failed",
            progress: 0,
            step: "Bulunamadı",
            error: "Bu iş bulunamadı veya süresi doldu.",
          });
          return;
        }
        const j = (await res.json()) as StatusPayload;
        if (!cancelled) setData(j);
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
    const id = window.setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [jobId]);

  /** Yalnızca API’deki `progress`; sahte artış yok (uzun adımlarda yanlış yüzde göstermesin). */
  const displayProgress =
    data?.status === "completed"
      ? 100
      : data?.status === "failed"
        ? Math.min(data.progress || 0, 100)
        : Math.min(100, data?.progress ?? 0);

  if (!jobId) {
    return (
      <div className="flex min-h-screen flex-col">
        <header className="border-b border-border/60 bg-background/80 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <Film className="size-5" />
              SubFrame
            </Link>
            <ModeToggle />
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 py-10">
          <Card>
            <CardHeader>
              <CardTitle>İş bulunamadı</CardTitle>
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
        </main>
      </div>
    );
  }

  const done = data?.status === "completed";
  const failed = data?.status === "failed";
  const downloadHref = data?.downloadPath || `/api/download/${jobId}`;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Film className="size-5" />
            SubFrame
          </Link>
          <ModeToggle />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 py-10">
        <Card className="border-border/80 shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl">
              {done ? "İndirmeye hazır" : failed ? "İşlem başarısız" : "İşleniyor"}
            </CardTitle>
            <CardDescription>
              {done
                ? "Altyazılı MP4 hazır. Bu indirmeden sonra veya saklama süresi dolunca dosya sunucudan silinir."
                : failed
                  ? "İşlem sırasında hata oluştu. Ayrıntılar aşağıda."
                  : !data
                    ? "Başlatılıyor…"
                    : data.step || "Videonuz işleniyor…"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!failed ? (
              <Progress value={displayProgress} max={100} className="w-full">
                <div className="flex w-full items-center justify-between gap-2">
                  <ProgressLabel>İlerleme</ProgressLabel>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {Math.round(displayProgress)}%
                  </span>
                </div>
                <ProgressTrack>
                  <ProgressIndicator />
                </ProgressTrack>
              </Progress>
            ) : null}

            {failed ? (
              <p className="text-sm text-destructive">{data?.error}</p>
            ) : !done ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Uzun videolar zaman alabilir; bu sekmeyi açık tutabilirsiniz.
              </p>
            ) : null}

            {(data?.logs?.length ?? 0) > 0 ? (
              <div className="space-y-2 pt-1">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Terminal className="size-3.5 shrink-0" />
                  İşlem günlüğü (ffmpeg / whisper / çeviri; terminalde de aynı satırlar)
                </div>
                <pre
                  className="max-h-80 overflow-auto overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-left text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-all text-foreground"
                  tabIndex={0}
                >
                  {(data?.logs ?? []).join("\n")}
                </pre>
              </div>
            ) : null}
          </CardContent>
          <CardFooter className="flex flex-wrap gap-3">
            {done ? (
              <a
                href={downloadHref}
                download
                className={cn(buttonVariants({ size: "lg" }), "inline-flex items-center gap-2")}
              >
                <Download className="size-4" />
                MP4 indir
              </a>
            ) : null}
            <Button
              type="button"
              variant={done ? "outline" : "default"}
              onClick={() => router.push("/")}
            >
              Yeni yükleme
            </Button>
          </CardFooter>
        </Card>
      </main>
    </div>
  );
}

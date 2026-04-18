import Link from "next/link";
import type * as React from "react";

import { FloatingAiDecor } from "@/components/floating-ai-decor";
import { ModeToggle } from "@/components/mode-toggle";
import { cn } from "@/lib/utils";
import { Film } from "lucide-react";

type AppShellProps = {
  children: React.ReactNode;
  /** Ana içerik alanı için ek sınıflar */
  mainClassName?: string;
};

export function AppShell({ children, mainClassName }: AppShellProps) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-x-hidden">
      {/* En arkada: taban renk */}
      <div
        className="pointer-events-none fixed inset-0 -z-30 bg-gradient-to-br from-background via-violet-50/40 to-fuchsia-50/30 dark:via-violet-950/25 dark:to-fuchsia-950/20"
        aria-hidden
      />
      {/* Yavaş hareket eden renk blob’ları */}
      <div className="pointer-events-none fixed inset-0 -z-[22] overflow-hidden" aria-hidden>
        <div className="absolute -left-[15%] top-[-10%] h-[min(85vh,720px)] w-[min(95vw,900px)] rounded-full bg-gradient-to-br from-violet-400/30 via-fuchsia-400/18 to-transparent blur-[100px] dark:from-violet-600/25 dark:via-fuchsia-500/12 animate-blob-1" />
        <div className="absolute -right-[10%] bottom-[-5%] h-[min(75vh,640px)] w-[min(85vw,780px)] rounded-full bg-gradient-to-tl from-fuchsia-400/25 via-violet-500/15 to-transparent blur-[90px] dark:from-fuchsia-600/18 dark:via-violet-600/12 animate-blob-2 [animation-delay:-12s]" />
        <div className="absolute left-1/3 top-1/2 h-[50vh] w-[60vw] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r from-amber-400/10 via-violet-400/12 to-fuchsia-400/10 blur-[120px] dark:from-amber-500/8 dark:via-violet-500/10 dark:to-fuchsia-500/8 animate-blob-3 [animation-delay:-5s]" />
      </div>
      {/* İnce renk kayması (aurora hissi) */}
      <div
        className="pointer-events-none fixed inset-0 -z-[21] bg-[radial-gradient(ellipse_120%_80%_at_30%_20%,oklch(0.72_0.22_300/0.14),transparent_50%),radial-gradient(ellipse_100%_60%_at_80%_80%,oklch(0.65_0.2_330/0.1),transparent_45%)] dark:bg-[radial-gradient(ellipse_120%_80%_at_30%_20%,oklch(0.55_0.2_280/0.2),transparent_50%),radial-gradient(ellipse_100%_60%_at_80%_80%,oklch(0.5_0.18_310/0.15),transparent_45%)] animate-mesh-hue"
        aria-hidden
      />
      <FloatingAiDecor />
      <div
        className="pointer-events-none fixed inset-0 -z-20 bg-[radial-gradient(ellipse_90%_55%_at_50%_-12%,oklch(0.72_0.19_280/0.14),transparent_58%)] dark:bg-[radial-gradient(ellipse_90%_55%_at_50%_-12%,oklch(0.55_0.2_280/0.22),transparent_58%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none fixed inset-0 -z-10 bg-[length:48px_48px] bg-[linear-gradient(to_right,oklch(0.5_0_0/0.035)_1px,transparent_1px),linear-gradient(to_bottom,oklch(0.5_0_0/0.035)_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,oklch(1_0_0/0.05)_1px,transparent_1px),linear-gradient(to_bottom,oklch(1_0_0/0.05)_1px,transparent_1px)] animate-grid-drift"
        aria-hidden
      />

      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/70 backdrop-blur-md supports-[backdrop-filter]:bg-background/55">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/"
            className={cn(
              "group flex cursor-pointer items-center gap-3 font-semibold tracking-tight transition-opacity hover:opacity-90"
            )}
          >
            <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white shadow-md shadow-violet-500/25 ring-2 ring-white/20 transition-transform group-hover:scale-[1.02] dark:ring-white/10">
              <Film className="size-[1.125rem]" strokeWidth={2.25} />
            </span>
            <span className="flex flex-col leading-none">
              <span className="text-lg text-foreground dark:text-white/95">SubFrame</span>
              <span className="mt-0.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                Video altyazı
              </span>
            </span>
          </Link>
          <ModeToggle />
        </div>
      </header>

      <main
        className={cn(
          "mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8 sm:px-6 sm:py-12",
          mainClassName
        )}
      >
        {children}
      </main>
    </div>
  );
}

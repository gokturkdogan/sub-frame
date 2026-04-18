"use client";

import {
  type PipelineStepCode,
  UI_PIPELINE_STEPS,
  rowLabel,
  rowState,
} from "@/lib/pipeline-steps";

import { cn } from "@/lib/utils";

type PipelineStatusChecklistProps = {
  stepCode: PipelineStepCode | undefined;
  status: string | undefined;
  skipTranslate: boolean | undefined;
};

/** Sol tarafta renkli nokta — küçük SVG */
function StatusDot({
  state,
  dotClass,
  ringClass,
  failed,
}: {
  state: "pending" | "active" | "done" | "skipped";
  dotClass: string;
  ringClass: string;
  failed: boolean;
}) {
  const activeRing = failed
    ? "ring-2 ring-destructive/60 shadow-[0_0_12px_-2px_var(--color-destructive)]"
    : cn("ring-2", ringClass, "shadow-[0_0_14px_-4px] shadow-current/30");

  if (state === "skipped") {
    return (
      <svg viewBox="0 0 12 12" className="size-3.5 shrink-0" aria-hidden>
        <circle
          cx="6"
          cy="6"
          r="4.5"
          fill="none"
          strokeWidth="1.25"
          strokeDasharray="2 2"
          className="stroke-muted-foreground/55"
        />
        <circle cx="6" cy="6" r="2" className="fill-muted-foreground/35" />
      </svg>
    );
  }

  if (state === "pending") {
    return (
      <svg viewBox="0 0 12 12" className="size-3.5 shrink-0 text-muted-foreground/40" aria-hidden>
        <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }

  if (state === "done") {
    return (
      <svg viewBox="0 0 12 12" className={cn("size-3.5 shrink-0", dotClass)} aria-hidden>
        <circle cx="6" cy="6" r="4.5" className={dotClass} />
      </svg>
    );
  }

  /* active */
  return (
    <span className="relative flex size-4 shrink-0 items-center justify-center">
      <span className="absolute inset-[-2px] rounded-full bg-violet-400/25 animate-ping dark:bg-violet-500/20" />
      <svg
        viewBox="0 0 12 12"
        className={cn("relative size-4 rounded-full", activeRing)}
        aria-hidden
      >
        <circle cx="6" cy="6" r="4.5" className={dotClass} />
      </svg>
    </span>
  );
}

export function PipelineStatusChecklist({
  stepCode,
  status,
  skipTranslate,
}: PipelineStatusChecklistProps) {
  const failed = status === "failed";

  return (
    <ul className="space-y-2.5" aria-label="İşlem adımları">
      {UI_PIPELINE_STEPS.map((step, i) => {
        const state = rowState(i, stepCode, status, skipTranslate);
        const label = rowLabel(i, step, state, skipTranslate);
        const st = state;

        return (
          <li
            key={step.id}
            className={cn(
              "flex items-start gap-3 rounded-lg border border-transparent px-1 py-0.5 transition-colors",
              st === "active" &&
                !failed &&
                "border-violet-500/20 bg-violet-500/5 dark:border-violet-400/15 dark:bg-violet-500/10",
              st === "active" && failed && "border-destructive/25 bg-destructive/5",
              st === "done" && "opacity-95",
              st === "pending" && "opacity-60",
              st === "skipped" && "opacity-80"
            )}
          >
            <span className="mt-0.5 flex shrink-0 items-center justify-center">
              <StatusDot
                state={st}
                dotClass={step.dotClass}
                ringClass={step.ringClass}
                failed={failed && st === "active"}
              />
            </span>
            <span
              className={cn(
                "min-w-0 text-sm leading-snug",
                st === "active" && "font-semibold text-foreground",
                st === "done" && "font-medium text-foreground",
                st === "pending" && "text-muted-foreground",
                st === "skipped" && "italic text-muted-foreground"
              )}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

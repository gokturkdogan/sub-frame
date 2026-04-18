import {
  Brain,
  Bot,
  Cpu,
  Mic,
  Sparkles,
  Video,
  Waves,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

const items: {
  Icon: LucideIcon;
  className: string;
  delay: string;
  dur: string;
}[] = [
  { Icon: Brain, className: "left-[4%] top-[18%] text-violet-500/40 dark:text-violet-400/35", delay: "0s", dur: "22s" },
  { Icon: Cpu, className: "right-[8%] top-[12%] text-fuchsia-500/35 dark:text-fuchsia-400/28", delay: "-4s", dur: "26s" },
  { Icon: Sparkles, className: "left-[12%] bottom-[22%] text-amber-500/30 dark:text-amber-400/25", delay: "-8s", dur: "20s" },
  { Icon: Mic, className: "right-[14%] bottom-[28%] text-violet-500/35 dark:text-violet-400/28", delay: "-2s", dur: "24s" },
  { Icon: Video, className: "left-1/2 top-[8%] -translate-x-1/2 text-fuchsia-500/28 dark:text-fuchsia-400/22", delay: "-6s", dur: "28s" },
  { Icon: Bot, className: "left-[20%] top-[45%] text-violet-500/32 dark:text-violet-400/26", delay: "-10s", dur: "21s" },
  { Icon: Zap, className: "right-[22%] top-[40%] text-amber-400/28 dark:text-amber-300/22", delay: "-3s", dur: "23s" },
  { Icon: Waves, className: "right-[6%] bottom-[12%] text-fuchsia-500/32 dark:text-fuchsia-400/26", delay: "-7s", dur: "25s" },
];

/** AI temalı yüzen ikonlar + hafif animatik desen katmanları */
export function FloatingAiDecor() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-[8] overflow-hidden" aria-hidden>
      {/* Nokta deseni — çok hafif nefes alma */}
      <svg
        className="absolute inset-0 size-full animate-dots-breathe"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="none"
      >
        <defs>
          <pattern id="ai-dots" width="80" height="80" patternUnits="userSpaceOnUse">
            <circle cx="4" cy="4" r="1.5" className="fill-violet-500 dark:fill-violet-400" />
            <circle cx="44" cy="44" r="1" className="fill-fuchsia-500/80 dark:fill-fuchsia-400/80" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#ai-dots)" />
      </svg>

      {/* Yarı saydam gradient leke — yavaş hareket */}
      <div className="absolute inset-0 animate-decor-line opacity-40">
        <svg className="size-full" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
          <defs>
            <radialGradient id="glow-a" cx="30%" cy="30%" r="60%">
              <stop offset="0%" stopColor="oklch(0.65 0.2 280 / 0.15)" />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
            <radialGradient id="glow-b" cx="70%" cy="70%" r="55%">
              <stop offset="0%" stopColor="oklch(0.62 0.22 320 / 0.12)" />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
          </defs>
          <rect width="100%" height="100%" fill="url(#glow-a)" />
          <rect width="100%" height="100%" fill="url(#glow-b)" />
        </svg>
      </div>

      {/* Soyut çizgiler */}
      <svg
        className="absolute inset-0 size-full animate-decor-line opacity-[0.06] dark:opacity-[0.1]"
        viewBox="0 0 400 400"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M0 120 Q100 40 200 120 T400 80"
          fill="none"
          className="stroke-violet-500"
          strokeWidth="0.8"
        />
        <path
          d="M0 280 Q150 200 280 320 T400 240"
          fill="none"
          className="stroke-fuchsia-500/80"
          strokeWidth="0.6"
        />
        <circle
          cx="200"
          cy="200"
          r="120"
          fill="none"
          className="stroke-violet-400/50"
          strokeWidth="0.5"
          strokeDasharray="4 8"
        />
      </svg>

      {items.map(({ Icon, className, delay, dur }, i) => (
        <div
          key={i}
          className={cn(
            "absolute flex size-12 items-center justify-center rounded-2xl border border-violet-500/15 bg-gradient-to-br from-violet-500/10 to-fuchsia-500/8 shadow-lg shadow-violet-500/10 backdrop-blur-[2px] dark:border-white/10 dark:from-violet-500/15 dark:to-fuchsia-500/12 dark:shadow-violet-900/25 sm:size-14",
            className
          )}
          style={{
            animation: `ai-float ${dur} ease-in-out infinite`,
            animationDelay: delay,
          }}
        >
          <Icon className="size-6 sm:size-7" strokeWidth={1.25} />
        </div>
      ))}
    </div>
  );
}

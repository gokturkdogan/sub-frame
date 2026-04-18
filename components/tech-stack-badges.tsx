import techStackData from "@/lib/tech-stack-data.json";

import { cn } from "@/lib/utils";

type TechEntry = (typeof techStackData)[number];

function BrandGlyph({ entry, compact }: { entry: TechEntry; compact?: boolean }) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      className={cn("shrink-0", compact ? "size-5" : "size-6")}
      aria-hidden
    >
      <path fill={`#${entry.hex}`} d={entry.path} />
    </svg>
  );
}

type TechStackBadgesProps = {
  className?: string;
  /** Daha küçük varyant (ör. sonuç sayfası) */
  compact?: boolean;
};

export function TechStackBadges({ className, compact }: TechStackBadgesProps) {
  return (
    <ul
      className={cn(
        "flex list-none flex-wrap justify-center gap-2.5 sm:justify-start sm:gap-3",
        compact && "gap-2",
        className
      )}
      aria-label="Kullanılan teknolojiler"
    >
      {techStackData.map((entry, i) => (
        <li
          key={entry.slug}
          className={cn(
            "group animate-in fade-in zoom-in-95 fill-mode-forwards",
            compact ? "duration-500" : "duration-700"
          )}
          style={{ animationDelay: `${80 + i * 55}ms` }}
        >
          <span
            className={cn(
              "inline-flex cursor-default items-center gap-2.5 rounded-full border border-violet-500/15 bg-gradient-to-br from-background/95 to-violet-500/[0.06] shadow-md shadow-violet-500/10 ring-1 ring-border/60 backdrop-blur-sm transition duration-300 hover:-translate-y-1 hover:border-violet-400/40 hover:shadow-lg hover:shadow-violet-500/20 dark:from-card/90 dark:to-violet-500/10 dark:ring-border/40",
              compact ? "px-2.5 py-1.5 text-xs" : "px-4 py-2 text-sm"
            )}
          >
            <span
              className={cn(
                "flex shrink-0 items-center justify-center rounded-lg bg-white shadow-inner ring-1 ring-black/5 dark:bg-zinc-100",
                compact ? "size-7" : "size-10"
              )}
            >
              <BrandGlyph entry={entry} compact={compact} />
            </span>
            <span
              className={cn(
                "font-semibold tracking-tight text-foreground/90",
                compact && "text-[13px] font-medium"
              )}
            >
              {entry.label}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

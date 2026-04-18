"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Check, ChevronDown } from "lucide-react";

export type LanguageOption = { code: string; label: string; flagSrc: string };

type LanguageSelectProps = {
  id?: string;
  label: string;
  languages: LanguageOption[];
  value: string;
  onChange: (code: string) => void;
  className?: string;
  /** İki sütunlu grid gibi yerleşimde tetikleyiciyi yatayda doldurur */
  fullWidth?: boolean;
};

function LangFlag({ src, title }: { src: string; title: string }) {
  return (
    <span className="relative flex h-7 w-10 shrink-0 overflow-hidden rounded-md bg-muted/50 ring-1 ring-border/55 shadow-inner sm:h-8 sm:w-11">
      <img src={src} alt="" width={44} height={32} className="h-full w-full object-cover" />
      <span className="sr-only">{title}</span>
    </span>
  );
}

export function LanguageSelect({
  id,
  label,
  languages,
  value,
  onChange,
  className,
  fullWidth,
}: LanguageSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties>({});
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLUListElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  const selected = languages.find((l) => l.code === value) ?? languages[0];

  const updateMenuPosition = React.useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMenuStyle({
      position: "fixed",
      top: rect.bottom + 6,
      left: rect.left,
      width: rect.width,
      zIndex: 200,
    });
  }, []);

  React.useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const onScrollOrResize = () => updateMenuPosition();
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, updateMenuPosition]);

  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const listbox =
    open && typeof document !== "undefined"
      ? createPortal(
          <ul
            ref={menuRef}
            id={id ? `${id}-listbox` : undefined}
            role="listbox"
            style={menuStyle}
            aria-activedescendant={value}
            className="overflow-hidden rounded-xl border border-border/80 bg-popover/95 py-1 shadow-xl shadow-violet-500/10 ring-1 ring-violet-500/10 backdrop-blur-md dark:bg-popover/95 dark:shadow-black/40"
          >
            {languages.map((lang) => {
              const isSel = lang.code === value;
              return (
                <li key={lang.code} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSel}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left text-sm transition hover:bg-violet-500/10",
                      isSel && "bg-violet-500/15"
                    )}
                    onClick={() => {
                      onChange(lang.code);
                      setOpen(false);
                    }}
                  >
                    <LangFlag src={lang.flagSrc} title={lang.label} />
                    <span className="flex-1 font-medium">{lang.label}</span>
                    {isSel ? (
                      <Check className="size-4 shrink-0 text-violet-600 dark:text-violet-400" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>,
          document.body
        )
      : null;

  return (
    <div ref={wrapRef} className={cn("relative space-y-2", className)}>
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      <div className={cn("relative", fullWidth ? "w-full" : "max-w-md")}>
        <button
          ref={triggerRef}
          id={id}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={id ? `${id}-listbox` : undefined}
          onClick={() => {
            if (open) {
              setOpen(false);
              return;
            }
            const el = triggerRef.current;
            if (el) {
              const r = el.getBoundingClientRect();
              setMenuStyle({
                position: "fixed",
                top: r.bottom + 6,
                left: r.left,
                width: r.width,
                zIndex: 200,
              });
            }
            setOpen(true);
          }}
          className={cn(
            "flex h-12 w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-border/80 bg-background/90 px-3 text-left shadow-sm ring-violet-500/20 transition hover:border-violet-400/50 hover:bg-muted/30 focus-visible:border-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30 dark:bg-background/60 dark:hover:bg-muted/20",
            open && "border-violet-500/40 ring-2 ring-violet-500/20"
          )}
        >
          <span className="flex min-w-0 flex-1 items-center gap-3">
            <span className="shrink-0 rounded-lg bg-gradient-to-br from-violet-500/15 to-fuchsia-500/10 p-0.5 shadow-inner ring-1 ring-border/60">
              <LangFlag src={selected.flagSrc} title={selected.label} />
            </span>
            <span className="truncate font-medium text-foreground">{selected.label}</span>
          </span>
          <ChevronDown
            className={cn(
              "size-5 shrink-0 text-muted-foreground transition-transform duration-200",
              open && "rotate-180 text-violet-600 dark:text-violet-400"
            )}
            aria-hidden
          />
        </button>
      </div>
      {listbox}
    </div>
  );
}

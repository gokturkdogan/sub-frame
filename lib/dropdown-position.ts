import type { CSSProperties } from "react";

const GAP = 6;
const DEFAULT_MAX_H = 320;

/**
 * Tetikleyiciye göre sabit konumlu liste kutusu; altta yer yoksa yukarı açılır.
 */
export function fixedListboxStyle(
  trigger: HTMLElement,
  maxHeight = DEFAULT_MAX_H
): CSSProperties {
  const rect = trigger.getBoundingClientRect();
  const vh = window.innerHeight;
  const spaceBelow = vh - rect.bottom - GAP;
  const spaceAbove = rect.top - GAP;
  const preferBelow = spaceBelow >= spaceAbove || spaceBelow >= 120;

  if (preferBelow) {
    return {
      position: "fixed",
      left: rect.left,
      width: rect.width,
      top: rect.bottom + GAP,
      maxHeight: Math.min(maxHeight, Math.max(120, spaceBelow - 8)),
      zIndex: 200,
    };
  }

  return {
    position: "fixed",
    left: rect.left,
    width: rect.width,
    bottom: vh - rect.top + GAP,
    maxHeight: Math.min(maxHeight, Math.max(120, spaceAbove - 8)),
    zIndex: 200,
  };
}

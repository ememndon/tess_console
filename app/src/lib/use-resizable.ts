import { useCallback, useEffect, useState } from "react";

// Drag-to-resize for the side panels. Returns the current width plus a mousedown
// handler to attach to an edge grab-strip. Width is clamped to [min,max] and
// persisted in localStorage. `side` says which way a positive drag grows it
// (left rail grows when dragging right; right rail grows when dragging left).
export function useResizable(opts: {
  storageKey: string;
  defaultWidth: number;
  min: number;
  max: number;
  side: "left" | "right";
}) {
  const { storageKey, defaultWidth, min, max, side } = opts;
  const [width, setWidth] = useState(defaultWidth);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const saved = Number(localStorage.getItem(storageKey));
    if (saved && !Number.isNaN(saved)) setWidth(Math.min(max, Math.max(min, saved)));
  }, [storageKey, min, max]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = width;
      let current = startW;
      setDragging(true);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
      const onMove = (ev: MouseEvent) => {
        const delta = side === "left" ? ev.clientX - startX : startX - ev.clientX;
        current = Math.min(max, Math.max(min, startW + delta));
        setWidth(current);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        setDragging(false);
        localStorage.setItem(storageKey, String(current));
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [width, side, min, max, storageKey],
  );

  return { width, dragging, onMouseDown };
}

import React, { useRef } from "react";
import { DEFAULT_DRAWING_COLOR, getDrawingStyle } from "./drawingUtils.js";

const isHexColor = (color) => /^#[0-9a-f]{6}$/i.test(String(color || ""));

const stopEvent = (event) => {
  event.stopPropagation();
};

const stopAndPreventEvent = (event) => {
  event.preventDefault();
  event.stopPropagation();
};

export function DrawingOptionsToolbar({
  drawing,
  style,
  onToggleExtend,
  onColorChange,
  onTextChange,
}) {
  const colorInputRef = useRef(null);
  if (!drawing) return null;

  const drawingStyle = getDrawingStyle(drawing);
  const color = isHexColor(drawingStyle.color)
    ? drawingStyle.color
    : DEFAULT_DRAWING_COLOR;
  const canExtend = drawing.type === "trendline" || drawing.type === "hline";
  const canEditText = drawing.type === "pin";

  return (
    <div
      className="pointer-events-auto absolute z-40 flex items-center justify-end gap-1 rounded-sm bg-background/85 p-1 text-xs text-foreground shadow-sm backdrop-blur"
      style={style}
      onPointerDown={stopEvent}
      onClick={(event) => event.stopPropagation()}
    >
      {canExtend ? (
        <button
          type="button"
          title="Extend line"
          aria-label="Extend line"
          className={`h-6 rounded-sm px-2 text-[11px] font-semibold leading-none hover:bg-accent hover:text-accent-foreground ${
            drawingStyle.extendRight
              ? "bg-primary/15 text-primary ring-1 ring-primary/40"
              : "text-foreground/80"
          }`}
          onPointerDown={stopAndPreventEvent}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleExtend?.();
          }}
        >
          Ext
        </button>
      ) : null}
      {canEditText ? (
        <input
          type="text"
          value={drawingStyle.text}
          placeholder="Text"
          title="Pin text"
          className="h-6 w-24 rounded-sm border border-border/50 bg-background/70 px-1.5 text-xs"
          onPointerDown={stopEvent}
          onClick={stopEvent}
          onChange={(event) => onTextChange?.(event.target.value)}
        />
      ) : null}
      <button
        type="button"
        title="Line color"
        aria-label="Line color"
        className="size-6 rounded-sm border border-border/70 shadow-sm"
        style={{ backgroundColor: color }}
        onPointerDown={stopAndPreventEvent}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (typeof colorInputRef.current?.showPicker === "function") {
            colorInputRef.current.showPicker();
            return;
          }
          colorInputRef.current?.click();
        }}
      />
      <input
        ref={colorInputRef}
        type="color"
        value={color}
        tabIndex={-1}
        className="fixed left-[-1000px] top-[-1000px] size-px opacity-0"
        style={{ pointerEvents: "none" }}
        onPointerDown={(event) => event.stopPropagation()}
        onChange={(event) => onColorChange?.(event.target.value)}
      />
    </div>
  );
}

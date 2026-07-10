import React from "react";
import { EyeIcon } from "@phosphor-icons/react";

const stopEvent = (event) => {
  event.stopPropagation();
};

const stopAndPreventEvent = (event) => {
  event.preventDefault();
  event.stopPropagation();
};

export function MovingAverageOptionsToolbar({
  movingAverage,
  style,
  onChange,
}) {
  if (!movingAverage?.enabled) return null;

  const period = Number.isFinite(Number(movingAverage.period))
    ? Math.max(1, Math.round(Number(movingAverage.period)))
    : 21;
  const type = movingAverage.type === "sma" ? "sma" : "ema";
  const hideBase = Boolean(movingAverage.hideBase);

  return (
    <div
      className="pointer-events-auto absolute z-40 flex items-center gap-1 rounded-sm bg-background/85 p-1 text-xs text-foreground shadow-sm backdrop-blur"
      style={style}
      onPointerDown={stopEvent}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        title={hideBase ? "Show base series" : "Hide base series"}
        aria-label={hideBase ? "Show base series" : "Hide base series"}
        className={`inline-flex size-6 items-center justify-center rounded-sm text-foreground/80 hover:bg-accent hover:text-accent-foreground ${
          hideBase ? "bg-primary/15 text-primary ring-1 ring-primary/40" : ""
        }`}
        onPointerDown={stopAndPreventEvent}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onChange?.({
            ...movingAverage,
            hideBase: !hideBase,
          });
        }}
      >
        <EyeIcon size={14} weight="bold" />
      </button>
      <button
        type="button"
        title="Toggle moving average type"
        aria-label="Toggle moving average type"
        className="h-6 rounded-sm px-2 text-[11px] font-semibold uppercase leading-none text-foreground/80 hover:bg-accent hover:text-accent-foreground"
        onPointerDown={stopAndPreventEvent}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onChange?.({
            ...movingAverage,
            type: type === "sma" ? "ema" : "sma",
          });
        }}
      >
        {type}
      </button>
      <input
        type="number"
        min={1}
        step={1}
        value={period}
        title="Moving average period"
        className="h-6 w-14 rounded-sm border border-border/50 bg-background/70 px-1 text-xs tabular-nums"
        onPointerDown={stopEvent}
        onClick={stopEvent}
        onChange={(event) => {
          const nextPeriod = Math.max(1, Math.round(Number(event.target.value)));
          if (!Number.isFinite(nextPeriod)) return;
          onChange?.({
            ...movingAverage,
            period: nextPeriod,
          });
        }}
      />
    </div>
  );
}

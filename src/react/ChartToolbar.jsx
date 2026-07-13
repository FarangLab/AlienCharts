import React from "react";
import {
  ArrowCounterClockwiseIcon,
  ArrowsInIcon,
  ArrowsOutIcon,
  BroomIcon,
  WaveSineIcon,
  MagnifyingGlassPlusIcon,
  MapPinIcon,
  MinusIcon,
} from "@phosphor-icons/react";

function ToolbarAction({
  title,
  hotkey,
  children,
  onClick,
  active = false,
  className = "",
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className={`relative inline-flex size-6 items-center justify-center rounded-sm text-foreground hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 ${className} ${
        active ? "bg-primary/15 text-primary ring-1 ring-primary/40" : ""
      }`}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick?.();
      }}
    >
      {children}
      {hotkey ? (
        <span className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 text-[10px] font-semibold leading-none text-foreground/50">
          {hotkey}
        </span>
      ) : null}
    </button>
  );
}

export function ChartToolbar({
  isFullscreen = false,
  onFullscreenToggle,
  onReset,
  onRectangleZoomToggle,
  rectangleZoomActive = false,
  onMovingAverageToggle,
  movingAverageActive = false,
  activeDrawingTool = null,
  onDrawingToolToggle,
  hasDrawings = false,
  onClearDrawingsRequest,
  disableDrawings = false,
}) {
  return (
    <div className="absolute left-2 top-12 z-30 flex flex-col gap-0.5 rounded-sm bg-background/80 p-0 pr-3 text-foreground shadow-sm backdrop-blur">
      <ToolbarAction
        title={isFullscreen ? "Exit fullscreen" : "Maximize chart"}
        hotkey="F"
        onClick={onFullscreenToggle}
      >
        {isFullscreen ? (
          <ArrowsInIcon size={16} weight="bold" />
        ) : (
          <ArrowsOutIcon size={16} weight="bold" />
        )}
      </ToolbarAction>
      <ToolbarAction title="Reset chart" hotkey="R" onClick={onReset}>
        <ArrowCounterClockwiseIcon size={16} weight="bold" />
      </ToolbarAction>
      <ToolbarAction
        title="Rectangle zoom"
        hotkey="Z"
        onClick={onRectangleZoomToggle}
        active={rectangleZoomActive}
      >
        <MagnifyingGlassPlusIcon size={16} weight="bold" />
      </ToolbarAction>
      {!disableDrawings && hasDrawings ? (
        <ToolbarAction
          title="Clear drawings"
          className="text-orange-500 dark:text-orange-300 dark:hover:text-orange-300"
          onClick={onClearDrawingsRequest}
        >
          <BroomIcon size={16} weight="bold" />
        </ToolbarAction>
      ) : null}
      {!disableDrawings ? (
        <>
          <div className="my-1 h-px w-full" />
          <ToolbarAction
            title="Draw trendline"
            hotkey="T"
            onClick={() => onDrawingToolToggle?.("trendline")}
            active={activeDrawingTool === "trendline"}
          >
            <MinusIcon className="-rotate-45" size={16} weight="bold" />
          </ToolbarAction>
          <ToolbarAction
            title="Draw horizontal line"
            hotkey="H"
            onClick={() => onDrawingToolToggle?.("hline")}
            active={activeDrawingTool === "hline"}
          >
            <MinusIcon size={16} weight="bold" />
          </ToolbarAction>
          <ToolbarAction
            title="Draw vertical line"
            hotkey="V"
            onClick={() => onDrawingToolToggle?.("vline")}
            active={activeDrawingTool === "vline"}
          >
            <MinusIcon className="rotate-90" size={16} weight="bold" />
          </ToolbarAction>
          <ToolbarAction
            title="Place pin"
            hotkey="P"
            onClick={() => onDrawingToolToggle?.("pin")}
            active={activeDrawingTool === "pin"}
          >
            <MapPinIcon size={16} weight="bold" />
          </ToolbarAction>
        </>
      ) : null}
      {!disableDrawings ? (
        <ToolbarAction
          title="Toggle moving average"
          hotkey="M"
          onClick={onMovingAverageToggle}
          active={movingAverageActive}
        >
          <WaveSineIcon size={16} weight="bold" />
        </ToolbarAction>
      ) : null}
    </div>
  );
}

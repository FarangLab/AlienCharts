import { iconSvg } from "../icons.js";
import {
  DRAWING_TOOLS,
  createDraftDrawing,
  createDrawing,
  getDrawingGeometry,
  getDrawingsForChart,
  hitTestDrawing,
  removeDrawingById,
  updateDrawingById,
} from "../core/drawingUtils.js";
import {
  getCategoryLabel,
  getOrderedSeries,
  resolveChartDescriptors,
} from "../core/chartModel.js";
import { createCoordinateTransform } from "../core/coordinateTransform.js";
import { createRendererRegistry } from "../core/renderers/index.js";
import {
  CHART_HEIGHT,
  RIGHT_AXIS_WIDTH,
  PLOT_PADDING,
  Y_SCALE_MIN,
  Y_SCALE_MAX,
  X_SCALE_MAX_SPAN,
  DEFAULT_CHART_BACKGROUND,
  drawChartLayouts,
  getChartXBounds,
  getPlotPadding,
  getCategoryPixelLength,
  getMinimumCategorySpan,
  getInitialView,
  getYRange,
  applyYScale,
  getNearestPointIndex,
  screenPointToDataPoint,
  dataPointToScreenPoint,
  normalizeRect,
  applyRectangleZoom,
  formatNumber,
  formatCompactNumber,
} from "../core/chartRenderer.js";

const BASE_ROOT_CLASSES = ["aliencharts-root", "relative", "h-full", "overflow-y-auto"];
const EMPTY_OBJECT = Object.freeze({});
let controllerIdSequence = 0;
const DEFAULT_OPTIONS = Object.freeze({
  charts: [],
  columns: 2,
  initialVisiblePoints: null,
  backgroundColor: DEFAULT_CHART_BACKGROUND,
  antialiasLines: false,
  gridLines: false,
  showToolbar: true,
  showLatestValueLine: true,
  showTooltips: true,
  followLatest: false,
  followVisibleLatest: true,
  xAxisLabel: "STEP",
  disableDrawings: false,
  seriesOrderByChart: EMPTY_OBJECT,
  topMarkers: [],
  formatXTick: formatCompactNumber,
  formatXValue: formatNumber,
  formatYValue: formatNumber,
});

const APPEND_ANIMATION = Object.freeze({
  durationMs: 300,
  maxBucketSize: 64,
  maxRevealPoints: 100,
});
const POINTER_SCALE_SENSITIVITY = 0.01;
const WHEEL_SCALE_SENSITIVITY = 0.001;

const scaleValueRange = (scale, delta, sensitivity) =>
  clamp(
    scale * Math.exp(delta * sensitivity),
    Y_SCALE_MIN,
    Y_SCALE_MAX,
  );

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const withAlpha = (color, alpha) => {
  const value = String(color || DEFAULT_CHART_BACKGROUND).trim();
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (!match) return value;
  return `rgba(${Number.parseInt(match[1], 16)}, ${Number.parseInt(match[2], 16)}, ${Number.parseInt(match[3], 16)}, ${alpha})`;
};

const getTextColor = (color) => {
  const value = String(color || "#38bdf8").replace("#", "");
  const normalized = value.length === 3
    ? value.split("").map((part) => part + part).join("")
    : value.padEnd(6, "0").slice(0, 6);
  const number = Number.parseInt(normalized, 16);
  const rgb = [16, 8, 0].map((shift) => ((number >> shift) & 255) / 255);
  const linear = rgb.map((part) => part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2] > 0.45
    ? "#111827"
    : "#ffffff";
};

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toolbarButton = ({ action, title, icon, hotkey = "", active = false, className = "" }) => `
  <button type="button" data-action="${action}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"
    class="relative inline-flex size-6 items-center justify-center rounded-sm text-foreground hover:bg-accent hover:text-accent-foreground ${active ? "bg-primary/15 text-primary ring-1 ring-primary/40" : ""} ${className}">
    ${icon}
    ${hotkey ? `<span class="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 text-[10px] font-semibold leading-none text-foreground/50">${hotkey}</span>` : ""}
  </button>`;

const chartCellHtml = (chart, descriptor, index, backgroundColor) => {
  const padding = getPlotPadding(chart, descriptor);
  const horizontal = descriptor.orientation === "horizontal";
  const valueAxisStyle = horizontal
    ? `left:${padding.left}px;right:${padding.right}px;bottom:0;height:${padding.bottom}px;cursor:ew-resize`
    : `right:0;top:${padding.top}px;bottom:${padding.bottom}px;width:${padding.right}px;cursor:ns-resize`;
  const categoryAxisStyle = horizontal
    ? `left:0;top:${padding.top}px;bottom:${padding.bottom}px;width:${padding.left}px;cursor:ns-resize`
    : `left:${padding.left}px;right:${padding.right}px;bottom:0;height:${padding.bottom}px;cursor:ew-resize`;
  return `
  <div data-chart-index="${index}" class="relative select-none overflow-hidden rounded-sm" style="height:${CHART_HEIGHT}px;background-color:${escapeHtml(backgroundColor)}">
    <div class="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-8 items-center px-2 backdrop-blur" data-header>
      <div class="flex min-w-0 items-center gap-1 rounded-sm px-1 text-sm font-semibold text-foreground" data-title-wrap>
        ${chart.pinned ? iconSvg("pushPinSimple", { size: 14, className: "shrink-0 text-foreground/80" }) : ""}
        <span class="truncate">${escapeHtml(chart.title)}</span>
      </div>
    </div>
    <div data-grid-lines class="pointer-events-none absolute text-border/40"></div>
    <div data-latest-lines></div>
    <div data-y-axis class="absolute z-20" style="${valueAxisStyle}"></div>
    <div data-x-axis class="absolute z-20" style="${categoryAxisStyle}"></div>
    <div data-toolbar></div>
  </div>`;
};

const makeSurface = (canvas, gl) => ({
  canvas,
  gl,
  renderers: createRendererRegistry(gl),
});

const destroySurface = (surface) => {
  if (!surface) return;
  surface.renderers.destroy();
  surface.gl.getExtension("WEBGL_lose_context")?.loseContext();
};

class AppendAnimator {
  constructor(requestRender) {
    this.requestRender = requestRender;
    this.latest = new Map();
    this.animations = new Map();
    this.frame = null;
  }

  scan(charts, descriptors) {
    const now = performance.now();
    charts.forEach((chart) => {
      const descriptor = descriptors.get(chart.id);
      if (!descriptor?.capabilities.appendAnimation) return;
      chart.series.forEach((series) => {
        if (!series.length) return;
        const next = {
          x: series.rawX[series.length - 1],
          y: series.rawY[series.length - 1],
          length: series.length,
        };
        const previous = this.latest.get(series.id);
        if (previous && next.x > previous.x) {
          this.animations.set(series.id, {
            fromX: previous.x,
            fromY: previous.y,
            toX: next.x,
            toY: next.y,
            appendedCount: next.length - previous.length,
            startedAt: now,
            duration: APPEND_ANIMATION.durationMs,
          });
        }
        this.latest.set(series.id, next);
      });
    });
    if (this.animations.size) this.start();
  }

  start() {
    if (this.frame != null) return;
    const tick = () => {
      const now = performance.now();
      this.animations.forEach((animation, id) => {
        if (now - animation.startedAt >= animation.duration) this.animations.delete(id);
      });
      this.requestRender();
      this.frame = this.animations.size ? requestAnimationFrame(tick) : null;
    };
    this.frame = requestAnimationFrame(tick);
  }

  getPoint({ seriesId, visiblePoints, now }) {
    if (visiblePoints.bucketSize > APPEND_ANIMATION.maxBucketSize) return null;
    const animation = this.animations.get(seriesId);
    if (!animation || visiblePoints.x[0] > animation.fromX || visiblePoints.x[visiblePoints.pointCount - 1] < animation.toX) return null;
    let stableCount = 0;
    while (stableCount < visiblePoints.pointCount && visiblePoints.x[stableCount] <= animation.fromX) stableCount += 1;
    if (!stableCount) return null;
    const rawProgress = clamp((now - animation.startedAt) / animation.duration, 0, 1);
    const progress = 1 - (1 - rawProgress) ** 2;
    if (animation.appendedCount > APPEND_ANIMATION.maxRevealPoints) {
      return {
        index: stableCount,
        pointCount: stableCount + 1,
        x: animation.fromX + (animation.toX - animation.fromX) * progress,
        y: animation.fromY + (animation.toY - animation.fromY) * progress,
      };
    }
    const appendedCount = visiblePoints.pointCount - stableCount;
    const position = progress * appendedCount;
    const revealed = Math.min(appendedCount, Math.floor(position));
    const nextIndex = Math.min(visiblePoints.pointCount - 1, stableCount + revealed);
    const previousIndex = Math.max(stableCount - 1, nextIndex - 1);
    const partial = position - revealed;
    const partialPoint = revealed < appendedCount;
    return {
      index: nextIndex,
      pointCount: Math.min(visiblePoints.pointCount, nextIndex + 1),
      x: partialPoint ? visiblePoints.x[previousIndex] + (visiblePoints.x[nextIndex] - visiblePoints.x[previousIndex]) * partial : visiblePoints.x[nextIndex],
      y: partialPoint ? visiblePoints.y[previousIndex] + (visiblePoints.y[nextIndex] - visiblePoints.y[previousIndex]) * partial : visiblePoints.y[nextIndex],
    };
  }

  destroy() {
    if (this.frame != null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.animations.clear();
  }
}

class ChartGridController {
  constructor(container, options) {
    if (!(container instanceof HTMLElement)) throw new TypeError("createChartGrid requires an HTMLElement target");
    this.container = container;
    this.controllerId = `aliencharts-${controllerIdSequence += 1}`;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    if (!Array.isArray(this.options.charts)) throw new TypeError("charts must be an array");
    this.chartDescriptors = resolveChartDescriptors(this.options.charts);
    this.destroyed = false;
    this.frame = null;
    this.structureDirty = true;
    this.focusedChartId = null;
    this.fullscreenChartId = null;
    this.rectangleZoomChartId = null;
    this.rectangleZoomRect = null;
    this.crosshair = null;
    this.drag = null;
    this.draftDrawing = null;
    this.drawingSession = null;
    this.drawings = Array.isArray(options.drawings) ? [...options.drawings] : [];
    this.activeDrawingTool = options.activeDrawingTool ?? null;
    this.selectedDrawingId = options.selectedDrawingId ?? null;
    this.movingAverageByChart = { ...(options.movingAverageByChart || {}) };
    this.viewStates = new Map();
    this.yScales = new Map();
    this.yOffsets = new Map();
    this.latestX = new Map();
    this.axisOverlays = {};
    this.layouts = [];
    this.fullscreenLayouts = [];
    this.addedClasses = BASE_ROOT_CLASSES.filter((name) => !container.classList.contains(name));
    BASE_ROOT_CLASSES.forEach((name) => container.classList.add(name));

    this.canvas = document.createElement("canvas");
    this.canvas.className = "pointer-events-none absolute left-0 top-0 z-10 block";
    this.grid = document.createElement("div");
    this.grid.className = "relative z-0 grid gap-1 pt-1";
    this.overlays = document.createElement("div");
    this.overlays.className = "pointer-events-none absolute left-0 top-0 z-20";
    this.overlays.style.width = "100%";
    container.append(this.canvas, this.grid, this.overlays);

    const gl = this.canvas.getContext("webgl2", { antialias: true, alpha: true, depth: false, stencil: false });
    if (!gl) {
      this.cleanupDom();
      throw new Error("AlienCharts requires WebGL2 support");
    }
    this.surface = makeSurface(this.canvas, gl);
    this.fullscreenSurface = null;
    this.animator = new AppendAnimator(() => this.requestRender());
    this.animator.scan(this.options.charts, this.chartDescriptors);
    this.bound = {
      click: (event) => this.handleClick(event),
      input: (event) => this.handleInput(event),
      change: (event) => this.handleInput(event),
      pointerdown: (event) => this.handlePointerDown(event),
      pointermove: (event) => this.handlePointerMove(event),
      pointerup: (event) => this.handlePointerUp(event),
      pointerleave: () => this.clearCrosshair(),
      contextmenu: (event) => this.handleContextMenu(event),
      wheel: (event) => this.handleWheel(event),
      scroll: () => this.requestRender(),
      keydown: (event) => this.handleKeyDown(event),
    };
    Object.entries(this.bound).forEach(([name, handler]) => {
      const target = name === "keydown" ? window : container;
      target.addEventListener(name, handler, name === "wheel" ? { passive: false } : undefined);
    });
    this.resizeObserver = new ResizeObserver(() => this.requestRender());
    this.resizeObserver.observe(container);
    this.initializeChartState();
    this.requestRender();
  }

  assertAlive() {
    if (this.destroyed) throw new Error("AlienCharts controller has been destroyed");
  }

  initializeChartState() {
    const ids = new Set(this.options.charts.map((chart) => chart.id));
    [this.viewStates, this.yScales, this.yOffsets, this.latestX].forEach((map) => {
      [...map.keys()].forEach((id) => { if (!ids.has(id)) map.delete(id); });
    });
    this.options.charts.forEach((chart) => {
      if (!this.viewStates.has(chart.id)) this.viewStates.set(chart.id, getInitialView(chart, this.options.initialVisiblePoints));
      if (!this.yScales.has(chart.id)) this.yScales.set(chart.id, 1);
      if (!this.yOffsets.has(chart.id)) this.yOffsets.set(chart.id, 0);
      if (!this.latestX.has(chart.id)) this.latestX.set(chart.id, getChartXBounds(chart).maxX);
    });
    if (this.focusedChartId && !ids.has(this.focusedChartId)) this.focusedChartId = null;
    if (this.fullscreenChartId && !ids.has(this.fullscreenChartId)) this.closeFullscreen();
  }

  requestRender() {
    if (this.destroyed || this.frame != null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.render();
    });
  }

  setOptions(next) {
    this.assertAlive();
    if (!next || typeof next !== "object") return;
    const previousCharts = this.options.charts;
    const previousActiveDrawingTool = this.activeDrawingTool;
    const nextOptions = { ...this.options, ...next };
    if (!Array.isArray(nextOptions.charts)) throw new TypeError("charts must be an array");
    const nextDescriptors = resolveChartDescriptors(nextOptions.charts);
    const descriptorLayoutChanged = nextOptions.charts.some((chart) => {
      const previous = this.chartDescriptors.get(chart.id);
      const current = nextDescriptors.get(chart.id);
      return (
        previous?.rendererType !== current?.rendererType ||
        previous?.orientation !== current?.orientation ||
        previous?.categorical !== current?.categorical
      );
    });
    this.options = nextOptions;
    this.chartDescriptors = nextDescriptors;
    if (hasOwn(next, "drawings")) this.drawings = Array.isArray(next.drawings) ? [...next.drawings] : [];
    if (hasOwn(next, "activeDrawingTool")) {
      this.activeDrawingTool = next.activeDrawingTool ?? null;
      if (this.activeDrawingTool !== previousActiveDrawingTool) {
        this.draftDrawing = null;
        this.drawingSession = null;
      }
    }
    if (hasOwn(next, "selectedDrawingId")) this.selectedDrawingId = next.selectedDrawingId ?? null;
    if (hasOwn(next, "movingAverageByChart")) this.movingAverageByChart = { ...(next.movingAverageByChart || {}) };
    if (previousCharts !== this.options.charts || descriptorLayoutChanged || hasOwn(next, "columns") || hasOwn(next, "backgroundColor") || hasOwn(next, "gridLines")) this.structureDirty = true;
    this.initializeChartState();
    this.requestRender();
  }

  setCharts(charts) {
    this.setOptions({ charts });
  }

  invalidate() {
    this.assertAlive();
    this.followAppendedData();
    this.animator.scan(this.options.charts, this.chartDescriptors);
    this.requestRender();
  }

  followAppendedData() {
    this.options.charts.forEach((chart) => {
      const previous = this.latestX.get(chart.id);
      const next = getChartXBounds(chart).maxX;
      if (Number.isFinite(previous) && Number.isFinite(next) && next !== previous) {
        const state = this.viewStates.get(chart.id) || getInitialView(chart, this.options.initialVisiblePoints);
        const span = state.xMax - state.xMin;
        const nearEdge = previous >= state.xMax - span * 0.15 && previous >= state.xMin && previous <= state.xMax;
        if (this.options.followLatest || (this.options.followVisibleLatest && nearEdge)) {
          const delta = next - previous;
          this.viewStates.set(chart.id, { xMin: state.xMin + delta, xMax: state.xMax + delta });
        }
      }
      this.latestX.set(chart.id, next);
    });
  }

  jumpToLatest(chartId) {
    this.assertAlive();
    this.options.charts.forEach((chart) => {
      if (chartId != null && chart.id !== chartId) return;
      const maxX = getChartXBounds(chart).maxX;
      if (!Number.isFinite(maxX)) return;
      const state = this.viewStates.get(chart.id) || getInitialView(chart, this.options.initialVisiblePoints);
      const span = Math.max(
        getMinimumCategorySpan(chart),
        state.xMax - state.xMin,
      );
      const nextMax = maxX + span * 0.1;
      this.viewStates.set(chart.id, { xMin: nextMax - span, xMax: nextMax });
    });
    this.requestRender();
  }

  scrollToTop(options = {}) {
    this.assertAlive();
    this.container.scrollTo({ ...options, top: 0 });
  }

  renderStructure() {
    this.grid.style.gridTemplateColumns = `repeat(${Math.max(1, Number(this.options.columns) || 1)}, minmax(18rem, 1fr))`;
    this.grid.innerHTML = this.options.charts.map((chart, index) =>
      chartCellHtml(
        chart,
        this.chartDescriptors.get(chart.id),
        index,
        this.options.backgroundColor,
      )).join("");
    this.chartNodes = [...this.grid.querySelectorAll("[data-chart-index]")];
    this.chartNodes.forEach((node) => {
      node.querySelector("[data-header]").style.backgroundColor = withAlpha(this.options.backgroundColor, 0.82);
    });
    this.structureDirty = false;
  }

  getLayouts(fullscreen = false) {
    const nodes = fullscreen ? (this.fullscreenNode ? [this.fullscreenNode] : []) : this.chartNodes || [];
    const charts = fullscreen
      ? this.options.charts.filter((chart) => chart.id === this.fullscreenChartId)
      : this.options.charts;
    const host = fullscreen ? this.fullscreenOverlay : this.container;
    const hostRect = host.getBoundingClientRect();
    return nodes.map((node, index) => {
      const rect = node.getBoundingClientRect();
      const x = rect.left - hostRect.left + host.scrollLeft;
      const y = rect.top - hostRect.top + host.scrollTop;
      const chart = charts[index];
      const descriptor = this.chartDescriptors.get(chart.id);
      const padding = getPlotPadding(chart, descriptor);
      const layout = {
        chart,
        descriptor,
        rect: { x, y, width: rect.width, height: rect.height },
        plot: {
          x: x + padding.left,
          y: y + padding.top,
          width: Math.max(1, rect.width - padding.left - padding.right),
          height: Math.max(1, rect.height - padding.top - padding.bottom),
        },
        visible: fullscreen || (rect.bottom >= hostRect.top && rect.top <= hostRect.bottom),
        node,
        fullscreen,
      };
      return layout;
    });
  }

  render() {
    const focusState = this.captureControlFocus();
    if (this.structureDirty) this.renderStructure();
    this.layouts = this.getLayouts(false);
    this.axisOverlays = this.drawSurface(this.surface, this.layouts, this.container.scrollWidth, this.container.scrollHeight);
    this.updateCells(this.layouts, this.axisOverlays, false);
    if (this.fullscreenChartId) {
      this.fullscreenLayouts = this.getLayouts(true);
      const axes = this.drawSurface(this.fullscreenSurface, this.fullscreenLayouts, this.fullscreenOverlay.clientWidth, this.fullscreenOverlay.clientHeight);
      this.updateCells(this.fullscreenLayouts, axes, true);
    }
    this.renderOverlays();
    this.restoreControlFocus(focusState);
  }

  captureControlFocus() {
    const active = document.activeElement;
    if (!(active instanceof HTMLInputElement)) return null;
    const selector = active.matches("[data-moving-period]")
      ? "[data-moving-period]"
      : active.matches("[data-pin-text]")
        ? "[data-pin-text]"
        : active.matches("[data-drawing-color]")
          ? "[data-drawing-color]"
          : null;
    if (!selector) return null;
    const fullscreen = Boolean(active.closest("[data-aliencharts-fullscreen]"));
    let selectionStart = null;
    let selectionEnd = null;
    if (active.type === "text") {
      selectionStart = active.selectionStart;
      selectionEnd = active.selectionEnd;
    }
    return { selector, fullscreen, selectionStart, selectionEnd };
  }

  restoreControlFocus(state) {
    if (!state) return;
    const host = state.fullscreen ? this.fullscreenOverlay : this.container;
    const input = host?.querySelector(state.selector);
    if (!(input instanceof HTMLInputElement)) return;
    input.focus({ preventScroll: true });
    if (input.type === "text" && state.selectionStart != null) {
      input.setSelectionRange(state.selectionStart, state.selectionEnd);
    }
  }

  drawSurface(surface, layouts, width, height) {
    if (!surface) return {};
    return drawChartLayouts({
      canvas: surface.canvas,
      width: Math.max(1, width),
      height: Math.max(1, height),
      gl: surface.gl,
      rendererRegistry: surface.renderers,
      antialiasLines: this.options.antialiasLines,
      layouts,
      viewStateRef: { current: this.viewStates },
      yScaleRef: { current: this.yScales },
      yCenterOffsetRef: { current: this.yOffsets },
      initialVisiblePoints: this.options.initialVisiblePoints,
      getAppendAnimatedPoint: (payload) => this.animator.getPoint(payload),
      movingAverageByChart: this.movingAverageByChart,
      seriesOrderByChart: this.options.seriesOrderByChart,
    });
  }

  updateCells(layouts, axes, fullscreen) {
    layouts.forEach(({ chart, descriptor, node }) => {
      const axis = axes[chart.id];
      const padding = getPlotPadding(chart, descriptor);
      const horizontal = axis?.orientation === "horizontal";
      node.querySelector("[data-title-wrap]").classList.toggle("ring-1", this.focusedChartId === chart.id);
      node.querySelector("[data-title-wrap]").classList.toggle("ring-primary/70", this.focusedChartId === chart.id);
      const grid = node.querySelector("[data-grid-lines]");
      const gridOptions = this.options.gridLines === true ? {} : this.options.gridLines || {};
      grid.style.display = this.options.gridLines ? "block" : "none";
      Object.assign(grid.style, {
        left: `${padding.left}px`, right: `${padding.right}px`, top: `${padding.top}px`, bottom: `${padding.bottom}px`,
        backgroundImage: "linear-gradient(to right, transparent calc(100% - 1px), currentColor calc(100% - 1px)), linear-gradient(to bottom, transparent calc(100% - 1px), currentColor calc(100% - 1px))",
        backgroundSize: `${Math.max(8, Number(gridOptions.xSpacing) || 80)}px 100%, 100% ${Math.max(8, Number(gridOptions.ySpacing) || 48)}px`,
      });
      const yAxis = node.querySelector("[data-y-axis]");
      yAxis.style.backgroundColor = withAlpha(this.options.backgroundColor, 0.78);
      yAxis.innerHTML = (axis?.ticks || []).map((tick) => horizontal
        ? `<div class="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-center text-[11px] font-medium tabular-nums text-foreground/70" style="left:${tick.left}px">${escapeHtml(this.options.formatYValue(tick.value))}</div>`
        : `<div class="pointer-events-none absolute left-1/2 -translate-x-1/2 -translate-y-1/2 text-center text-[11px] font-medium tabular-nums text-foreground/70" style="top:${tick.top}px">${escapeHtml(this.options.formatYValue(tick.value))}</div>`).join("") +
        (axis?.latestValues || []).map((latest) => `<div class="pointer-events-none absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-sm px-1.5 py-0.5 text-center text-[10px] font-bold tabular-nums shadow-sm" style="top:${latest.top}px;background:${latest.color};color:${getTextColor(latest.color)}">${escapeHtml(this.options.formatYValue(latest.value))}</div>`).join("");
      const xAxis = node.querySelector("[data-x-axis]");
      xAxis.style.backgroundColor = withAlpha(this.options.backgroundColor, 0.7);
      xAxis.innerHTML = (axis?.xTicks || []).map((tick) => {
        const label = tick.categorical
          ? tick.label
          : this.options.formatXTick(tick.value);
        if (horizontal && tick.categorical) {
          return `<div data-category-label title="${escapeHtml(label)}" class="pointer-events-none absolute inset-x-2 -translate-y-1/2 truncate text-right text-[11px] font-medium text-foreground/70" style="top:${tick.top}px">${escapeHtml(label)}</div>`;
        }
        if (tick.categorical) {
          return `<div data-category-label title="${escapeHtml(label)}" class="pointer-events-none absolute top-1/2 w-24 -translate-x-1/2 -translate-y-1/2 truncate text-center text-[11px] font-medium text-foreground/70" style="left:${tick.left}px">${escapeHtml(label)}</div>`;
        }
        return horizontal
          ? `<div class="pointer-events-none absolute left-1/2 -translate-x-1/2 -translate-y-1/2 text-center text-[11px] font-medium tabular-nums text-foreground/70" style="top:${tick.top}px">${escapeHtml(label)}</div>`
          : `<div class="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-center text-[11px] font-medium tabular-nums text-foreground/70" style="left:${tick.left}px">${escapeHtml(label)}</div>`;
      }).join("");
      const latestLayer = node.querySelector("[data-latest-lines]");
      latestLayer.innerHTML = this.options.showLatestValueLine ? (axis?.latestValues || []).filter((item) => item.left >= 0 && item.left <= axis.plotWidth).map((item) => `<div class="pointer-events-none absolute z-10 opacity-70" style="left:${padding.left + item.left}px;top:${padding.top + item.top}px;height:1px;width:${Math.max(0, axis.plotWidth - item.left)}px;background-image:repeating-linear-gradient(to right,${item.color} 0 4px,transparent 4px 8px)"></div>`).join("") : "";
      this.updateToolbar(node, chart, axis, fullscreen);
    });
  }

  updateToolbar(node, chart, axis, fullscreen) {
    const target = node.querySelector("[data-toolbar]");
    const focused = fullscreen || this.focusedChartId === chart.id;
    const descriptor = this.chartDescriptors.get(chart.id);
    const drawingsAvailable = descriptor.capabilities.drawings;
    const movingAverageAvailable = descriptor.capabilities.movingAverage;
    const padding = getPlotPadding(chart, descriptor);
    let html = "";
    if (axis?.showJumpLatest) html += `<button type="button" data-action="jump-latest" aria-label="Jump to latest" class="absolute z-30 inline-flex size-7 items-center justify-center rounded-sm text-foreground hover:bg-accent" style="right:${padding.right + 6}px;bottom:${padding.bottom + 6}px;background:${withAlpha(this.options.backgroundColor, 0.7)}">${iconSvg("arrowLineRight", { className: axis.orientation === "horizontal" ? "rotate-90" : "" })}</button>`;
    if (focused && this.options.showToolbar) {
      const moving = movingAverageAvailable && Boolean(this.movingAverageByChart[chart.id]?.enabled);
      const hasDrawings = getDrawingsForChart(this.drawings, chart.id).length > 0;
      html += `<div class="absolute left-2 top-12 z-30 flex flex-col gap-0.5 rounded-sm bg-background/80 pr-3 text-foreground shadow-sm backdrop-blur">`;
      html += toolbarButton({ action: "fullscreen", title: fullscreen ? "Exit fullscreen" : "Maximize chart", hotkey: "F", icon: iconSvg(fullscreen ? "arrowsIn" : "arrowsOut") });
      html += toolbarButton({ action: "reset", title: "Reset chart", hotkey: "R", icon: iconSvg("arrowCounterClockwise") });
      html += toolbarButton({ action: "rectangle-zoom", title: "Rectangle zoom", hotkey: "Z", active: this.rectangleZoomChartId === chart.id, icon: iconSvg("magnifyingGlassPlus") });
      if (drawingsAvailable && !this.options.disableDrawings && hasDrawings) html += toolbarButton({ action: "clear-drawings", title: "Clear drawings", className: "text-orange-500", icon: iconSvg("broom") });
      if ((drawingsAvailable || movingAverageAvailable) && !this.options.disableDrawings) {
        html += '<div class="my-1 h-px w-full"></div>';
        if (drawingsAvailable) {
          html += toolbarButton({ action: "tool-trendline", title: "Draw trendline", hotkey: "T", active: this.activeDrawingTool === "trendline", icon: iconSvg("minus", { className: "-rotate-45" }) });
          html += toolbarButton({ action: "tool-hline", title: "Draw horizontal line", hotkey: "H", active: this.activeDrawingTool === "hline", icon: iconSvg("minus") });
          html += toolbarButton({ action: "tool-vline", title: "Draw vertical line", hotkey: "V", active: this.activeDrawingTool === "vline", icon: iconSvg("minus", { className: "rotate-90" }) });
          html += toolbarButton({ action: "tool-pin", title: "Place pin", hotkey: "P", active: this.activeDrawingTool === "pin", icon: iconSvg("mapPin") });
        }
        if (movingAverageAvailable) html += toolbarButton({ action: "moving-average", title: "Toggle moving average", hotkey: "M", active: moving, icon: iconSvg("waveSine") });
      }
      html += "</div>";
      if (movingAverageAvailable && !this.options.disableDrawings && moving) html += this.movingAverageOptionsHtml(chart);
    }
    target.innerHTML = html;
  }

  movingAverageOptionsHtml(chart) {
    const moving = this.movingAverageByChart[chart.id] || { enabled: true, period: 21, type: "ema", hideBase: false };
    return `<div data-moving-options class="absolute right-16 top-2 z-40 flex items-center gap-1 rounded-sm bg-background/85 p-1 text-xs text-foreground shadow-sm">
      <button type="button" data-action="toggle-base" title="${moving.hideBase ? "Show" : "Hide"} base series" aria-label="${moving.hideBase ? "Show" : "Hide"} base series" class="inline-flex size-6 items-center justify-center rounded-sm ${moving.hideBase ? "bg-primary/15 text-primary ring-1 ring-primary/40" : ""}">${iconSvg("eye", { size: 14 })}</button>
      <button type="button" data-action="moving-type" title="Toggle moving average type" class="h-6 rounded-sm px-2 text-[11px] font-semibold uppercase">${moving.type === "sma" ? "sma" : "ema"}</button>
      <input data-moving-period type="number" min="1" step="1" value="${Math.max(1, Number(moving.period) || 21)}" title="Moving average period" class="h-6 w-14 rounded-sm border border-border/50 px-1 text-xs" />
    </div>`;
  }

  renderOverlays() {
    const surface = this.fullscreenChartId ? this.fullscreenOverlay : this.container;
    const overlay = this.fullscreenChartId ? this.fullscreenOverlays : this.overlays;
    const layouts = this.fullscreenChartId ? this.fullscreenLayouts : this.layouts;
    if (!overlay) return;
    overlay.style.height = `${surface.scrollHeight}px`;
    let html = this.drawingOverlayHtml(layouts);
    html += this.topMarkersHtml(layouts);
    html += this.crosshairHtml();
    html += this.rectangleOverlayHtml();
    html += this.drawingOptionsHtml(layouts);
    overlay.innerHTML = html;
  }

  drawingOverlayHtml(layouts) {
    const drawings = this.draftDrawing ? [...this.drawings, this.draftDrawing] : this.drawings;
    if (!drawings.length) return "";
    const drawableLayouts = layouts
      .map((layout, index) => ({
        layout,
        index,
        drawings: layout.descriptor.capabilities.drawings
          ? getDrawingsForChart(drawings, layout.chart.id)
          : [],
      }))
      .filter((entry) => entry.drawings.length > 0);
    if (!drawableLayouts.length) return "";

    const definitions = drawableLayouts.map(({ layout, index }) => {
      const clipId = `${this.controllerId}-drawing-clip-${layout.fullscreen ? "fullscreen" : "grid"}-${index}`;
      return `<clipPath id="${clipId}"><rect data-drawing-clip="${escapeHtml(layout.chart.id)}" x="${layout.plot.x}" y="${layout.plot.y}" width="${layout.plot.width}" height="${layout.plot.height}"/></clipPath>`;
    }).join("");

    const body = drawableLayouts.map(({ layout, index, drawings: chartDrawings }) => {
      const clipId = `${this.controllerId}-drawing-clip-${layout.fullscreen ? "fullscreen" : "grid"}-${index}`;
      const chartBody = chartDrawings.map((drawing) => {
        const geometry = getDrawingGeometry({ drawing, layout, projectPoint: (point) => this.projectPoint(point, layout) });
        if (!geometry) return "";
        const selected = drawing.id === this.selectedDrawingId || drawing.id === "__draft__";
        if (drawing.type === "pin") {
          const text = escapeHtml(geometry.style.text?.trim() || "");
          return `<g opacity="${drawing.id === "__draft__" ? 0.72 : 1}"><g transform="translate(${geometry.start.x} ${geometry.start.y})"><path d="M0 -11 C-6 -11 -10 -6 -10 -1 C-10 6 -2 12 0 15 C2 12 10 6 10 -1 C10 -6 6 -11 0 -11 Z" fill="${geometry.style.color}" stroke="var(--background,#fff)" stroke-width="1.5"/><circle cy="-2" r="3" fill="var(--background,#fff)"/></g>${text ? `<text x="${geometry.start.x + 14}" y="${geometry.start.y}" fill="${geometry.style.color}" stroke="var(--background,#fff)" stroke-width="3" paint-order="stroke" font-size="12" font-weight="600">${text}</text>` : ""}${selected ? `<circle cx="${geometry.start.x}" cy="${geometry.start.y}" r="4" fill="${geometry.style.color}" stroke="var(--background,#fff)"/>` : ""}</g>`;
        }
        return `<g><line data-drawing-line x1="${geometry.lineStart.x}" y1="${geometry.lineStart.y}" x2="${geometry.lineEnd.x}" y2="${geometry.lineEnd.y}" stroke="${geometry.style.color}" stroke-width="${geometry.style.lineWidth}" stroke-dasharray="${geometry.style.dashPattern.join(" ")}" opacity="${drawing.id === "__draft__" ? 0.72 : 1}"/>${selected ? `<circle data-drawing-anchor="start" cx="${geometry.start.x}" cy="${geometry.start.y}" r="4" fill="${geometry.style.color}" stroke="var(--background,#fff)"/>${drawing.type === "trendline" ? `<circle data-drawing-anchor="end" cx="${geometry.end.x}" cy="${geometry.end.y}" r="4" fill="${geometry.style.color}" stroke="var(--background,#fff)"/>` : ""}` : ""}</g>`;
      }).join("");
      return `<g data-drawing-chart="${escapeHtml(layout.chart.id)}" clip-path="url(#${clipId})">${chartBody}</g>`;
    }).join("");
    return `<svg class="pointer-events-none absolute left-0 top-0 z-20 block overflow-visible" style="width:100%;height:100%"><defs>${definitions}</defs>${body}</svg>`;
  }

  topMarkersHtml(layouts) {
    if (!this.options.topMarkers?.length) return "";
    return layouts.flatMap((layout) => !layout.descriptor.capabilities.markers
      ? []
      : this.options.topMarkers.map((marker, markerIndex) => {
      const value = Number(marker.x ?? marker.step);
      const state = this.viewStates.get(layout.chart.id);
      const ratio = (value - state.xMin) / (state.xMax - state.xMin);
      if (!Number.isFinite(value) || ratio < 0 || ratio > 1) return "";
      return `<button type="button" data-marker-index="${markerIndex}" class="pointer-events-auto absolute z-30 -translate-x-1/2 rounded-full" style="left:${layout.plot.x + ratio * layout.plot.width}px;top:${layout.plot.y + 4}px" title="${escapeHtml(marker.title || "")}" aria-label="${escapeHtml(marker.ariaLabel || marker.title || "Chart marker")}"><span class="block size-2.5 rounded-full border border-background shadow-sm" style="background:${marker.color || "#f97316"}"></span></button>`;
    })).join("");
  }

  crosshairHtml() {
    const crosshair = this.options.showTooltips ? this.crosshair : null;
    if (!crosshair) return "";
    return `<div class="pointer-events-none absolute z-20 border-l border-foreground/40" style="left:${crosshair.x}px;top:0;height:100%"></div><div class="pointer-events-none absolute z-20 border-t border-foreground/40" style="top:${crosshair.y}px;left:0;width:100%"></div>
      ${crosshair.points.map((point) => `<div class="pointer-events-none absolute z-30 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background" style="left:${point.x}px;top:${point.y}px;background:${point.color}"></div>`).join("")}
      <div data-crosshair-tooltip class="pointer-events-none absolute z-30 w-[220px] rounded-sm border border-border/70 bg-popover/80 px-2 py-1.5 text-xs text-popover-foreground shadow-sm backdrop-blur-sm" style="left:${crosshair.tooltipX}px;top:${crosshair.tooltipY}px"><div class="mb-1 font-medium">${escapeHtml(this.options.xAxisLabel)}: ${escapeHtml(crosshair.categoryLabel ?? this.options.formatXValue(crosshair.xValue))}</div>${crosshair.points.map((point) => `<div class="grid grid-cols-[auto_1fr] gap-x-2"><span class="mt-1 size-2 rounded-full" style="background:${point.color}"></span><div class="min-w-0"><div class="truncate text-muted-foreground">${escapeHtml(point.name)}</div><div class="tabular-nums">${escapeHtml(this.options.formatYValue(point.yValue))}</div></div></div>`).join("")}</div>`;
  }

  rectangleOverlayHtml() {
    const rect = this.rectangleZoomRect && normalizeRect(this.rectangleZoomRect.start, this.rectangleZoomRect.end);
    return rect ? `<div class="pointer-events-none absolute z-40 rounded-sm border border-primary/70 bg-primary/10" style="left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px"></div>` : "";
  }

  drawingOptionsHtml(layouts) {
    const drawing = this.drawings.find((item) => item.id === this.selectedDrawingId);
    if (!drawing) return "";
    const layout = layouts.find((item) => item.chart.id === drawing.chartId);
    if (!layout || !layout.descriptor.capabilities.drawings) return "";
    const style = drawing.style || {};
    const canExtend = drawing.type === "trendline" || drawing.type === "hline";
    const canText = drawing.type === "pin";
    const left = Math.max(
      layout.rect.x + 42,
      layout.rect.x + layout.rect.width - PLOT_PADDING.right - 8,
    );
    return `<div data-drawing-options class="pointer-events-auto absolute z-40 flex items-center gap-1 rounded-sm bg-background/85 p-1 text-xs text-foreground shadow-sm backdrop-blur" style="left:${left}px;top:${layout.plot.y + 6}px;transform:translateX(-100%)">
      ${canExtend ? `<button type="button" data-action="extend-drawing" class="h-6 rounded-sm px-2 text-[11px] font-semibold ${style.extendRight ? "bg-primary/15 text-primary ring-1 ring-primary/40" : ""}">Ext</button>` : ""}
      ${canText ? `<input data-pin-text type="text" value="${escapeHtml(style.text || "")}" placeholder="Text" class="h-6 w-24 rounded-sm border border-border/50 px-1.5 text-xs"/>` : ""}
      <input data-drawing-color type="color" value="${/^#[0-9a-f]{6}$/i.test(style.color || "") ? style.color : "#60a5fa"}" title="Line color" class="size-6 rounded-sm border border-border/70"/>
    </div>`;
  }

  projectPoint(point, layout) {
    const state = this.viewStates.get(layout.chart.id);
    const range = this.getRange(layout, state);
    return this.getTransform(layout, state, range).dataToScreen(point);
  }

  getRange(layout, state = this.viewStates.get(layout.chart.id)) {
    return applyYScale(
      getYRange(
        layout.chart,
        state.xMin,
        state.xMax,
        getCategoryPixelLength(
          layout.chart,
          layout.plot,
          layout.descriptor,
        ),
        layout.descriptor,
      ),
      this.yScales.get(layout.chart.id),
      this.yOffsets.get(layout.chart.id),
    );
  }

  getTransform(layout, state, range) {
    return createCoordinateTransform({
      orientation: layout.descriptor.orientation,
      categoryRange: { min: state.xMin, max: state.xMax },
      valueRange: { min: range.minY, max: range.maxY },
      plot: layout.plot,
    });
  }

  pointForEvent(event, host) {
    const rect = host.getBoundingClientRect();
    return { x: event.clientX - rect.left + host.scrollLeft, y: event.clientY - rect.top + host.scrollTop };
  }

  eventContext(event) {
    const cell = event.target.closest?.("[data-chart-index]");
    if (!cell) return null;
    const fullscreen = Boolean(cell.closest("[data-aliencharts-fullscreen]"));
    const layouts = fullscreen ? this.fullscreenLayouts : this.layouts;
    const index = Number(cell.dataset.chartIndex);
    const layout = fullscreen ? layouts[0] : layouts[index];
    const host = fullscreen ? this.fullscreenOverlay : this.container;
    return layout ? { layout, host, point: this.pointForEvent(event, host), fullscreen } : null;
  }

  handleClick(event) {
    const marker = event.target.closest?.("[data-marker-index]");
    if (marker) {
      event.stopPropagation();
      this.options.onTopMarkerClick?.(this.options.topMarkers[Number(marker.dataset.markerIndex)]);
      return;
    }
    const button = event.target.closest?.("[data-action]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const context = this.eventContext(event);
    const chartId = context?.layout.chart.id || this.focusedChartId || this.fullscreenChartId;
    switch (button.dataset.action) {
      case "fullscreen": this.fullscreenChartId ? this.closeFullscreen() : this.openFullscreen(chartId); break;
      case "reset": this.resetChart(chartId); break;
      case "jump-latest": this.jumpToLatest(chartId); break;
      case "rectangle-zoom": this.rectangleZoomChartId = this.rectangleZoomChartId === chartId ? null : chartId; this.activeDrawingTool = null; this.emit("onActiveDrawingToolChange", null); this.requestRender(); break;
      case "clear-drawings": this.options.onClearDrawingsRequest ? this.emit("onClearDrawingsRequest", chartId) : this.setDrawings(this.drawings.filter((item) => item.chartId !== chartId)); break;
      case "moving-average": this.toggleMovingAverage(chartId); break;
      case "tool-trendline": this.toggleDrawingTool("trendline"); break;
      case "tool-hline": this.toggleDrawingTool("hline"); break;
      case "tool-vline": this.toggleDrawingTool("vline"); break;
      case "tool-pin": this.toggleDrawingTool("pin"); break;
      case "toggle-base": this.updateMovingAverage(chartId, { hideBase: !this.movingAverageByChart[chartId]?.hideBase }); break;
      case "moving-type": this.updateMovingAverage(chartId, { type: this.movingAverageByChart[chartId]?.type === "sma" ? "ema" : "sma" }); break;
      case "extend-drawing": this.updateSelectedDrawing((drawing) => ({ ...drawing, style: { ...drawing.style, extendRight: drawing.style?.extendRight === false } })); break;
      default: break;
    }
  }

  handleInput(event) {
    if (event.target.matches("[data-moving-period]")) {
      const context = this.eventContext(event);
      this.updateMovingAverage(context?.layout.chart.id, { period: Math.max(1, Math.round(Number(event.target.value) || 1)) });
    } else if (event.target.matches("[data-pin-text]")) {
      this.updateSelectedDrawing((drawing) => ({ ...drawing, style: { ...drawing.style, text: event.target.value } }));
    } else if (event.target.matches("[data-drawing-color]")) {
      this.updateSelectedDrawing((drawing) => ({ ...drawing, style: { ...drawing.style, color: event.target.value } }));
    }
  }

  handlePointerDown(event) {
    if (event.target.closest?.("button,input")) return;
    if (event.button !== 0) return;
    const context = this.eventContext(event);
    if (!context) return;
    const { layout, point } = context;
    this.activePointerContext = context;
    this.focusedChartId = layout.chart.id;
    const inPlot = point.x >= layout.plot.x && point.x <= layout.plot.x + layout.plot.width && point.y >= layout.plot.y && point.y <= layout.plot.y + layout.plot.height;
    if (inPlot && this.activeDrawingTool && !this.options.disableDrawings && layout.descriptor.capabilities.drawings) {
      const dataPoint = screenPointToDataPoint({ point, chart: layout.chart, descriptor: layout.descriptor, plot: layout.plot, initialVisiblePoints: this.options.initialVisiblePoints, viewStateRef: { current: this.viewStates }, yScaleRef: { current: this.yScales }, yCenterOffsetRef: { current: this.yOffsets } });
      if (["hline", "vline", "pin"].includes(this.activeDrawingTool)) {
        this.commitDrawing(layout.chart.id, this.activeDrawingTool, dataPoint, dataPoint);
      } else if (this.drawingSession?.chartId === layout.chart.id) {
        this.commitDrawing(layout.chart.id, "trendline", this.drawingSession.start, dataPoint);
      } else {
        this.drawingSession = { chartId: layout.chart.id, type: "trendline", start: dataPoint };
        this.draftDrawing = createDraftDrawing({ chartId: layout.chart.id, type: "trendline", start: dataPoint, end: dataPoint });
      }
    } else if (inPlot && this.rectangleZoomChartId === layout.chart.id) {
      this.drag = { type: "rectangle", layout, start: point };
      this.rectangleZoomRect = { start: point, end: point };
    } else if (inPlot) {
      const hit = layout.descriptor.capabilities.drawings
        ? this.hitDrawing(point, layout)
        : null;
      if (hit) {
        this.selectedDrawingId = hit.drawing.id;
        this.emit("onSelectedDrawingIdChange", hit.drawing.id);
        if (hit.endpoint != null || ["hline", "vline", "pin"].includes(hit.drawing.type)) {
          this.drag = { type: "drawing-edit", layout, drawingId: hit.drawing.id, endpoint: hit.endpoint };
        }
      } else {
        this.selectedDrawingId = null;
        this.emit("onSelectedDrawingIdChange", null);
        this.drag = { type: "pan", layout, start: point, state: { ...this.viewStates.get(layout.chart.id) }, yOffset: this.yOffsets.get(layout.chart.id) || 0 };
      }
    } else if (
      layout.descriptor.orientation === "vertical" &&
      point.x >= layout.plot.x + layout.plot.width
    ) {
      this.drag = { type: "y-scale", layout, start: point, scale: this.yScales.get(layout.chart.id) || 1 };
    } else if (
      layout.descriptor.orientation === "horizontal" &&
      point.y >= layout.plot.y + layout.plot.height
    ) {
      this.drag = { type: "y-scale", layout, start: point, scale: this.yScales.get(layout.chart.id) || 1 };
    } else if (
      layout.descriptor.orientation === "vertical" &&
      point.y >= layout.plot.y + layout.plot.height
    ) {
      this.drag = { type: "x-scale", layout, start: point, state: { ...this.viewStates.get(layout.chart.id) } };
    } else if (
      layout.descriptor.orientation === "horizontal" &&
      point.x <= layout.plot.x
    ) {
      this.drag = { type: "x-scale", layout, start: point, state: { ...this.viewStates.get(layout.chart.id) } };
    }
    context.host.setPointerCapture?.(event.pointerId);
    this.pointerCaptureTarget = context.host;
    this.requestRender();
  }

  handlePointerMove(event) {
    if (event.target.closest?.("button,input") && !this.drag && !this.drawingSession) return;
    const context = this.eventContext(event) || (this.activePointerContext && (this.drag || this.drawingSession)
      ? { ...this.activePointerContext, point: this.pointForEvent(event, this.activePointerContext.host) }
      : null);
    if (!context) return this.clearCrosshair();
    const { layout, point } = context;
    if (this.drawingSession) {
      if (layout.chart.id !== this.drawingSession.chartId) return;
      const end = screenPointToDataPoint({ point, chart: layout.chart, descriptor: layout.descriptor, plot: layout.plot, initialVisiblePoints: this.options.initialVisiblePoints, viewStateRef: { current: this.viewStates }, yScaleRef: { current: this.yScales }, yCenterOffsetRef: { current: this.yOffsets } });
      this.draftDrawing = createDraftDrawing({ ...this.drawingSession, end });
      this.requestRender();
      return;
    }
    if (this.drag) {
      const { chart, descriptor, plot } = this.drag.layout;
      if (this.drag.type === "drawing-edit") {
        const dataPoint = screenPointToDataPoint({ point, chart, descriptor, plot, initialVisiblePoints: this.options.initialVisiblePoints, viewStateRef: { current: this.viewStates }, yScaleRef: { current: this.yScales }, yCenterOffsetRef: { current: this.yOffsets } });
        const next = updateDrawingById(this.drawings, this.drag.drawingId, (drawing) => {
          if (drawing.type === "hline") {
            const deltaX = (drawing.end?.x ?? drawing.start.x) - drawing.start.x;
            return { ...drawing, start: { x: dataPoint.x, y: dataPoint.y }, end: { x: dataPoint.x + deltaX, y: dataPoint.y } };
          }
          if (drawing.type === "vline") return { ...drawing, start: { ...drawing.start, x: dataPoint.x }, end: { ...drawing.end, x: dataPoint.x } };
          if (drawing.type === "pin") return { ...drawing, start: dataPoint, end: dataPoint };
          if (this.drag.endpoint === "start" || this.drag.endpoint === "end") return { ...drawing, [this.drag.endpoint]: dataPoint };
          return drawing;
        });
        this.drawings = next;
        this.emit("onDrawingsChange", [...next]);
        this.requestRender();
        return;
      }
      if (this.drag.type === "rectangle") this.rectangleZoomRect = { start: this.drag.start, end: point };
      if (this.drag.type === "pan") {
        const span = this.drag.state.xMax - this.drag.state.xMin;
        const baseRange = getYRange(
          chart,
          this.drag.state.xMin,
          this.drag.state.xMax,
          getCategoryPixelLength(chart, plot, descriptor),
          descriptor,
        );
        const rangeSpan = (baseRange.maxY - baseRange.minY) * (this.yScales.get(chart.id) || 1);
        const transform = createCoordinateTransform({
          orientation: descriptor.orientation,
          categoryRange: {
            min: this.drag.state.xMin,
            max: this.drag.state.xMax,
          },
          valueRange: { min: 0, max: rangeSpan },
          plot,
        });
        const categoryDelta = transform.categoryDragDelta(
          this.drag.start,
          point,
        );
        const valueDelta = transform.valueOffsetDelta(
          this.drag.start,
          point,
        );
        this.viewStates.set(chart.id, { xMin: this.drag.state.xMin - categoryDelta, xMax: this.drag.state.xMax - categoryDelta });
        this.yOffsets.set(chart.id, this.drag.yOffset + valueDelta);
      }
      if (this.drag.type === "y-scale") {
        const transform = createCoordinateTransform({
          orientation: descriptor.orientation,
          categoryRange: { min: 0, max: 1 },
          valueRange: { min: 0, max: 1 },
          plot,
        });
        const delta = transform.valueScaleDelta(this.drag.start, point);
        this.yScales.set(
          chart.id,
          scaleValueRange(
            this.drag.scale,
            delta,
            POINTER_SCALE_SENSITIVITY,
          ),
        );
      }
      if (this.drag.type === "x-scale") {
        const center = (this.drag.state.xMin + this.drag.state.xMax) / 2;
        const transform = createCoordinateTransform({
          orientation: descriptor.orientation,
          categoryRange: { min: 0, max: 1 },
          valueRange: { min: 0, max: 1 },
          plot,
        });
        const delta = transform.categoryScaleDelta(this.drag.start, point);
        const span = clamp(
          (this.drag.state.xMax - this.drag.state.xMin) *
            Math.exp(delta * 0.01),
          getMinimumCategorySpan(chart),
          X_SCALE_MAX_SPAN,
        );
        this.viewStates.set(chart.id, { xMin: center - span / 2, xMax: center + span / 2 });
      }
      if (this.drag.type === "pan") this.updateCrosshair(point, layout);
      else this.requestRender();
      return;
    }
    this.updateCrosshair(point, layout, context.fullscreen);
  }

  handlePointerUp(event) {
    if (event.target.closest?.("button,input") && !this.drag && !this.drawingSession) return;
    const context = this.eventContext(event) || (this.activePointerContext
      ? { ...this.activePointerContext, point: this.pointForEvent(event, this.activePointerContext.host) }
      : null);
    if (this.drag?.type === "rectangle" && this.rectangleZoomRect) {
      const normalized = normalizeRect(this.rectangleZoomRect.start, this.rectangleZoomRect.end);
      if (normalized?.width >= 4 && normalized?.height >= 4) {
        const layout = this.drag.layout;
        applyRectangleZoom({
          chart: layout.chart,
          descriptor: layout.descriptor,
          plot: layout.plot,
          start: this.rectangleZoomRect.start,
          end: this.rectangleZoomRect.end,
          initialVisiblePoints: this.options.initialVisiblePoints,
          viewStateRef: { current: this.viewStates },
          yScaleRef: { current: this.yScales },
          yCenterOffsetRef: { current: this.yOffsets },
          yManualScaleRef: { current: new Set() },
        });
      }
      this.rectangleZoomChartId = null;
      this.rectangleZoomRect = null;
    }
    this.drag = null;
    this.pointerCaptureTarget?.releasePointerCapture?.(event.pointerId);
    this.pointerCaptureTarget = null;
    this.activePointerContext = null;
    this.requestRender();
  }

  handleWheel(event) {
    const context = this.eventContext(event);
    if (!context) return;
    const { layout, point } = context;
    const inPlot = point.x >= layout.plot.x && point.x <= layout.plot.x + layout.plot.width && point.y >= layout.plot.y && point.y <= layout.plot.y + layout.plot.height;
    if (!inPlot) return;
    event.preventDefault();
    if (event.shiftKey) {
      const wheelDelta = event.deltaY || event.deltaX;
      const currentScale = this.yScales.get(layout.chart.id) || 1;
      this.yScales.set(
        layout.chart.id,
        scaleValueRange(
          currentScale,
          wheelDelta,
          WHEEL_SCALE_SENSITIVITY,
        ),
      );
      this.requestRender();
      return;
    }
    const state = this.viewStates.get(layout.chart.id);
    const range = this.getRange(layout, state);
    const ratio = clamp(
      this.getTransform(layout, state, range).categoryRatio(point),
      0,
      1,
    );
    const anchor = state.xMin + ratio * (state.xMax - state.xMin);
    const zoom = Math.exp(event.deltaY * 0.001);
    const span = clamp(
      (state.xMax - state.xMin) * zoom,
      getMinimumCategorySpan(layout.chart),
      X_SCALE_MAX_SPAN,
    );
    this.viewStates.set(layout.chart.id, { xMin: anchor - ratio * span, xMax: anchor + (1 - ratio) * span });
    this.requestRender();
  }

  handleContextMenu(event) {
    const context = this.eventContext(event);
    if (!context || !this.options.onChartContextMenu) return;
    event.preventDefault();
    const { layout, point } = context;
    const inPlot = point.x >= layout.plot.x && point.x <= layout.plot.x + layout.plot.width && point.y >= layout.plot.y && point.y <= layout.plot.y + layout.plot.height;
    const data = inPlot ? screenPointToDataPoint({ point, chart: layout.chart, descriptor: layout.descriptor, plot: layout.plot, initialVisiblePoints: this.options.initialVisiblePoints, viewStateRef: { current: this.viewStates }, yScaleRef: { current: this.yScales }, yCenterOffsetRef: { current: this.yOffsets } }) : null;
    this.options.onChartContextMenu({ chart: layout.chart, event, point: data });
  }

  updateCrosshair(point, layout) {
    const inPlot = point.x >= layout.plot.x && point.x <= layout.plot.x + layout.plot.width && point.y >= layout.plot.y && point.y <= layout.plot.y + layout.plot.height;
    if (!inPlot || !this.options.showTooltips) return this.clearCrosshair();
    const state = this.viewStates.get(layout.chart.id);
    const orientation = layout.descriptor.orientation;
    const range = this.getRange(layout, state);
    const transform = this.getTransform(layout, state, range);
    const xValue = transform.screenToData(point).x;
    const tooltipSeries = getOrderedSeries(
      layout.chart,
      this.options.seriesOrderByChart,
    );
    const points = tooltipSeries.map((series, seriesIndex) => {
      const visible = series.getVisiblePoints(state.xMin, state.xMax, transform.categoryPixelLength);
      if (!visible.pointCount) return null;
      const index = getNearestPointIndex(visible.x, xValue);
      const category = this.surface.renderers.getTooltipCategory(
        layout.descriptor.rendererType,
        {
          visiblePoints: visible,
          pointIndex: index,
          seriesIndex,
          seriesCount: tooltipSeries.length,
          categoryMin: state.xMin,
          categoryMax: state.xMax,
        },
      );
      const data = { x: category, y: visible.y[index] };
      const screen = transform.dataToScreen(data);
      return { id: series.id, name: series.name, color: series.color, x: screen.x, y: screen.y, xValue: visible.x[index], yValue: data.y };
    }).filter(Boolean);
    if (!points.length) return this.clearCrosshair();
    const nearest = points.reduce((best, item) => {
      const itemDistance = orientation === "horizontal"
        ? Math.abs(item.y - point.y)
        : Math.abs(item.x - point.x);
      const bestDistance = orientation === "horizontal"
        ? Math.abs(best.y - point.y)
        : Math.abs(best.x - point.x);
      return itemDistance < bestDistance ? item : best;
    });
    this.crosshair = {
      x: point.x,
      y: point.y,
      xValue: nearest.xValue,
      categoryLabel: getCategoryLabel(layout.chart, nearest.xValue),
      points,
      tooltipX: point.x + 232 > layout.rect.x + layout.rect.width ? point.x - 232 : point.x + 12,
      tooltipY: clamp(point.y + 12, layout.plot.y, layout.rect.y + layout.rect.height - 96),
    };
    this.requestRender();
  }

  clearCrosshair() {
    if (!this.crosshair) return;
    this.crosshair = null;
    this.requestRender();
  }

  hitDrawing(point, layout) {
    for (const drawing of getDrawingsForChart(this.drawings, layout.chart.id)) {
      const hit = hitTestDrawing({ point, drawing, layout, projectPoint: (data) => this.projectPoint(data, layout) });
      if (hit) return hit;
    }
    return null;
  }

  commitDrawing(chartId, type, start, end) {
    const drawing = createDrawing({ chartId, type, start, end, createDrawingId: this.options.createDrawingId });
    this.setDrawings([...this.drawings, drawing]);
    this.selectedDrawingId = drawing.id;
    this.activeDrawingTool = null;
    this.draftDrawing = null;
    this.drawingSession = null;
    this.emit("onSelectedDrawingIdChange", drawing.id);
    this.emit("onActiveDrawingToolChange", null);
  }

  setDrawings(drawings) {
    this.drawings = drawings;
    this.emit("onDrawingsChange", [...drawings]);
    this.requestRender();
  }

  updateSelectedDrawing(updater) {
    if (!this.selectedDrawingId) return;
    this.setDrawings(updateDrawingById(this.drawings, this.selectedDrawingId, updater));
  }

  toggleDrawingTool(tool) {
    if (!DRAWING_TOOLS.has(tool) || this.options.disableDrawings) return;
    this.activeDrawingTool = this.activeDrawingTool === tool ? null : tool;
    this.rectangleZoomChartId = null;
    this.draftDrawing = null;
    this.drawingSession = null;
    this.emit("onActiveDrawingToolChange", this.activeDrawingTool);
    this.requestRender();
  }

  toggleMovingAverage(chartId) {
    if (!chartId || this.options.disableDrawings) return;
    const chart = this.options.charts.find((item) => item.id === chartId);
    if (!chart || !this.chartDescriptors.get(chartId)?.capabilities.movingAverage) return;
    const current = this.movingAverageByChart[chartId] || { period: 21, type: "ema", hideBase: false };
    this.movingAverageByChart = { ...this.movingAverageByChart, [chartId]: { ...current, enabled: !current.enabled } };
    this.emit("onMovingAverageToggle", chartId);
    this.requestRender();
  }

  updateMovingAverage(chartId, changes) {
    if (!chartId) return;
    const next = { enabled: true, period: 21, type: "ema", hideBase: false, ...(this.movingAverageByChart[chartId] || {}), ...changes };
    this.movingAverageByChart = { ...this.movingAverageByChart, [chartId]: next };
    this.emit("onMovingAverageChange", chartId, { ...next });
    this.requestRender();
  }

  resetChart(chartId) {
    const chart = this.options.charts.find((item) => item.id === chartId);
    if (!chart) return;
    this.viewStates.set(chartId, getInitialView(chart, this.options.initialVisiblePoints));
    this.yScales.set(chartId, 1);
    this.yOffsets.set(chartId, 0);
    this.requestRender();
  }

  openFullscreen(chartId) {
    const chart = this.options.charts.find((item) => item.id === chartId);
    if (!chart || this.fullscreenChartId) return;
    this.fullscreenChartId = chartId;
    const overlay = document.createElement("div");
    overlay.dataset.alienchartsFullscreen = "";
    overlay.className = "aliencharts-root fixed inset-0 z-[60] bg-background p-2";
    overlay.innerHTML = `<canvas class="pointer-events-none absolute left-0 top-0 z-10 block"></canvas><div data-fullscreen-cell>${chartCellHtml(chart, this.chartDescriptors.get(chart.id), 0, this.options.backgroundColor)}</div><div data-fullscreen-overlays class="pointer-events-none absolute left-0 top-0 z-20" style="width:100%;height:100%"></div>`;
    document.body.append(overlay);
    this.fullscreenOverlay = overlay;
    this.fullscreenNode = overlay.querySelector("[data-chart-index]");
    this.fullscreenNode.style.height = "calc(100vh - 16px)";
    this.fullscreenOverlays = overlay.querySelector("[data-fullscreen-overlays]");
    const canvas = overlay.querySelector("canvas");
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: true, depth: false, stencil: false });
    if (!gl) { overlay.remove(); this.fullscreenChartId = null; return; }
    this.fullscreenSurface = makeSurface(canvas, gl);
    this.fullscreenListeners = Object.entries(this.bound).filter(([name]) => name !== "keydown" && name !== "scroll");
    this.fullscreenListeners.forEach(([name, handler]) => overlay.addEventListener(name, handler, name === "wheel" ? { passive: false } : undefined));
    this.resizeObserver.observe(overlay);
    this.requestRender();
  }

  closeFullscreen() {
    if (!this.fullscreenChartId) return;
    if (this.fullscreenOverlay) this.resizeObserver?.unobserve(this.fullscreenOverlay);
    this.fullscreenListeners?.forEach(([name, handler]) => this.fullscreenOverlay?.removeEventListener(name, handler));
    this.fullscreenListeners = null;
    destroySurface(this.fullscreenSurface);
    this.fullscreenOverlay?.remove();
    this.fullscreenSurface = null;
    this.fullscreenOverlay = null;
    this.fullscreenNode = null;
    this.fullscreenOverlays = null;
    this.fullscreenLayouts = [];
    this.fullscreenChartId = null;
    this.requestRender();
  }

  handleKeyDown(event) {
    const editable = event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName));
    if (editable) return;
    const chartId = this.fullscreenChartId || this.focusedChartId;
    const chart = this.options.charts.find((item) => item.id === chartId);
    const capabilities =
      chart && this.chartDescriptors.get(chartId)?.capabilities;
    const key = event.key.toLowerCase();
    if (["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key) && !this.fullscreenChartId) {
      this.moveFocus(key.replace("arrow", "")); event.preventDefault(); return;
    }
    if (key === "r") { this.resetChart(chartId); event.preventDefault(); }
    else if (key === "z") { this.rectangleZoomChartId = this.rectangleZoomChartId === chartId ? null : chartId; event.preventDefault(); this.requestRender(); }
    else if (key === "m" && capabilities?.movingAverage) { this.toggleMovingAverage(chartId); event.preventDefault(); }
    else if (["t", "h", "v", "p"].includes(key) && capabilities?.drawings) { this.toggleDrawingTool({ t: "trendline", h: "hline", v: "vline", p: "pin" }[key]); event.preventDefault(); }
    else if ((key === "delete" || key === "backspace") && this.selectedDrawingId) { this.setDrawings(removeDrawingById(this.drawings, this.selectedDrawingId)); this.selectedDrawingId = null; this.emit("onSelectedDrawingIdChange", null); event.preventDefault(); }
    else if (key === "escape" && (this.activeDrawingTool || this.draftDrawing || this.rectangleZoomChartId)) { this.activeDrawingTool = null; this.draftDrawing = null; this.drawingSession = null; this.rectangleZoomChartId = null; this.rectangleZoomRect = null; this.emit("onActiveDrawingToolChange", null); this.requestRender(); event.preventDefault(); }
    else if (key === "f" || (key === "escape" && this.fullscreenChartId)) { this.fullscreenChartId ? this.closeFullscreen() : this.openFullscreen(chartId); event.preventDefault(); }
  }

  moveFocus(direction) {
    const charts = this.options.charts;
    if (!charts.length) return;
    let index = Math.max(0, charts.findIndex((chart) => chart.id === this.focusedChartId));
    const columns = Math.max(1, Number(this.options.columns) || 1);
    if (direction === "left") index = Math.max(Math.floor(index / columns) * columns, index - 1);
    if (direction === "right") index = Math.min(charts.length - 1, index + 1);
    if (direction === "up") index = Math.max(0, index - columns);
    if (direction === "down") index = Math.min(charts.length - 1, index + columns);
    this.focusedChartId = charts[index].id;
    this.chartNodes[index]?.scrollIntoView({ block: "nearest", inline: "nearest" });
    this.requestRender();
  }

  emit(name, ...args) {
    this.options[name]?.(...args);
  }

  cleanupDom() {
    this.canvas?.remove();
    this.grid?.remove();
    this.overlays?.remove();
    this.addedClasses?.forEach((name) => this.container.classList.remove(name));
  }

  destroy() {
    if (this.destroyed) return;
    this.closeFullscreen();
    this.destroyed = true;
    if (this.frame != null) cancelAnimationFrame(this.frame);
    this.animator.destroy();
    this.resizeObserver.disconnect();
    Object.entries(this.bound).forEach(([name, handler]) => {
      const target = name === "keydown" ? window : this.container;
      target.removeEventListener(name, handler);
    });
    destroySurface(this.surface);
    this.cleanupDom();
  }
}

export const createChartGrid = (container, options = {}) => new ChartGridController(container, options);

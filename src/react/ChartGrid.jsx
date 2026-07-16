import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { ArrowLineRightIcon, PushPinSimpleIcon } from "@phosphor-icons/react";
import { createSeries } from "../core/lodSeries.js";
import { createMockCharts } from "../core/mockData.js";
import { ChartToolbar } from "./ChartToolbar.jsx";
import { DrawingOptionsToolbar } from "./DrawingOptionsToolbar.jsx";
import { DrawingOverlay } from "./DrawingOverlay.jsx";
import { MovingAverageOptionsToolbar } from "./MovingAverageOptionsToolbar.jsx";
import {
  DRAWING_TOOLS,
  getDrawingsForChart,
  hitTestDrawing,
  updateDrawingById,
} from "./drawingUtils.js";
import { useAppendAnimations } from "./useAppendAnimations.js";
import { useDrawingInteractions } from "./useDrawingInteractions.js";

const CHART_HEIGHT = 360;
const RIGHT_AXIS_WIDTH = 58;
const PLOT_PADDING = {
  left: 38,
  right: RIGHT_AXIS_WIDTH,
  top: 34,
  bottom: 28,
};
const FOLLOW_VISIBLE_RIGHT_EDGE_RATIO = 0.15;
const Y_SCALE_MIN = 0.05;
const Y_SCALE_MAX = 40;
const Y_AXIS_TICK_COUNT = 5;
const X_AXIS_TICK_COUNT = 5;
const X_SCALE_MIN_SPAN = 10;
const X_SCALE_MAX_SPAN = 1000000000;
const JUMP_LATEST_RIGHT_PADDING_RATIO = 0.1;
const INITIAL_GPU_VERTEX_CAPACITY = 4096;
const AA_VERTEX_FLOAT_STRIDE = 6;
const AA_LINE_WIDTH_PX = 1.5;
const AA_EDGE_WIDTH_PX = 1;
const DASH_LENGTH_PX = 7;
const DASH_GAP_PX = 5;
const TOOLTIP_WIDTH = 220;
const TOOLTIP_OFFSET = 12;
const DEFAULT_GRID_X_SPACING = 80;
const DEFAULT_GRID_Y_SPACING = 48;
const DEFAULT_CHART_BACKGROUND = "#f5f9ff";
const EMPTY_ARRAY = [];
const EMPTY_OBJECT = {};

const withAlpha = (color, alpha) => {
  const value = String(color || DEFAULT_CHART_BACKGROUND).trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) {
    const r = Number.parseInt(value.slice(1, 3), 16);
    const g = Number.parseInt(value.slice(3, 5), 16);
    const b = Number.parseInt(value.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    const r = Number.parseInt(value[1] + value[1], 16);
    const g = Number.parseInt(value[2] + value[2], 16);
    const b = Number.parseInt(value[3] + value[3], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return value;
};

const hexToRgb = (color) => {
  const value = String(color || "#38bdf8").replace("#", "");
  const normalized =
    value.length === 3
      ? value
          .split("")
          .map((char) => char + char)
          .join("")
      : value.padEnd(6, "0").slice(0, 6);
  const number = Number.parseInt(normalized, 16);
  return [
    ((number >> 16) & 255) / 255,
    ((number >> 8) & 255) / 255,
    (number & 255) / 255,
  ];
};

const getReadableTextColor = (backgroundColor) => {
  const [r, g, b] = hexToRgb(backgroundColor);
  const toLinear = (value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  const luminance =
    0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return luminance > 0.45 ? "#111827" : "#ffffff";
};

const getSeriesLabelTextColor = (series) => {
  if (series.__labelTextColorFor !== series.color) {
    series.__labelTextColorFor = series.color;
    series.__labelTextColor = getReadableTextColor(series.color);
  }
  return series.__labelTextColor;
};

const getSelectedDrawingLayout = (layouts, drawings, selectedDrawingId) => {
  if (!selectedDrawingId || !Array.isArray(drawings)) return null;
  const drawing = drawings.find((candidate) => candidate?.id === selectedDrawingId);
  if (!drawing) return null;
  const layout = layouts.find(
    (candidate) => candidate.visible && candidate.chart.id === drawing.chartId,
  );
  return layout ? { drawing, layout } : null;
};

const getDrawingOptionsToolbarStyle = (layout) => ({
  left: Math.max(
    layout.rect.x + 42,
    layout.rect.x + layout.rect.width - PLOT_PADDING.right - 8,
  ),
  top: layout.rect.y + PLOT_PADDING.top + 6,
  transform: "translateX(-100%)",
});

const getMovingAverageOptionsToolbarStyle = (layout) => ({
  left: Math.max(
    layout.rect.x + 120,
    layout.rect.x + layout.rect.width - PLOT_PADDING.right - 8,
  ),
  top: layout.rect.y + 8,
  transform: "translateX(-100%)",
});

const getChartContextMenuPoint = ({
  point,
  chart,
  layout,
  initialVisiblePoints,
  viewStateRef,
  yScaleRef,
  yCenterOffsetRef,
}) => {
  const inPlot =
    point.x >= layout.plot.x &&
    point.x <= layout.plot.x + layout.plot.width &&
    point.y >= layout.plot.y &&
    point.y <= layout.plot.y + layout.plot.height;
  if (!inPlot) {
    return {
      x: point.x,
      y: point.y,
      inPlot: false,
      data: null,
    };
  }
  return {
    x: point.x,
    y: point.y,
    inPlot: true,
    data: screenPointToDataPoint({
      point,
      chart,
      plot: layout.plot,
      initialVisiblePoints,
      viewStateRef,
      yScaleRef,
      yCenterOffsetRef,
    }),
  };
};

const createProgram = (gl) => {
  const vertexSource = `#version 300 es
    in vec2 a_xy;
    uniform vec2 u_resolution;
    uniform vec4 u_rect;
    uniform vec2 u_xRange;
    uniform vec2 u_yRange;

    void main() {
      float xDenom = max(0.000000000001, abs(u_xRange.y - u_xRange.x));
      float yDenom = max(0.000000000001, abs(u_yRange.y - u_yRange.x));
      float nx = (a_xy.x - u_xRange.x) / xDenom;
      float ny = (a_xy.y - u_yRange.x) / yDenom;
      float px = u_rect.x + nx * u_rect.z;
      float py = u_rect.y + (1.0 - ny) * u_rect.w;
      vec2 zeroToOne = vec2(px, py) / u_resolution;
      vec2 clip = zeroToOne * 2.0 - 1.0;
      gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    }
  `;
  const fragmentSource = `#version 300 es
    precision highp float;
    uniform vec3 u_color;
    out vec4 outColor;

    void main() {
      outColor = vec4(u_color, 1.0);
    }
  `;

  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || "Shader compile failed");
    }
    return shader;
  };

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "Program link failed");
  }
  return program;
};

const createAntialiasProgram = (gl) => {
  const vertexSource = `#version 300 es
    in vec2 a_start;
    in vec2 a_end;
    in float a_side;
    in float a_along;
    uniform vec2 u_resolution;
    uniform vec4 u_rect;
    uniform vec2 u_xRange;
    uniform vec2 u_yRange;
    uniform float u_lineHalfWidth;
    uniform float u_edgeWidth;
    out float v_side;

    vec2 toPixel(vec2 value) {
      float xDenom = max(0.000000000001, abs(u_xRange.y - u_xRange.x));
      float yDenom = max(0.000000000001, abs(u_yRange.y - u_yRange.x));
      float nx = (value.x - u_xRange.x) / xDenom;
      float ny = (value.y - u_yRange.x) / yDenom;
      return vec2(
        u_rect.x + nx * u_rect.z,
        u_rect.y + (1.0 - ny) * u_rect.w
      );
    }

    void main() {
      vec2 startPx = toPixel(a_start);
      vec2 endPx = toPixel(a_end);
      vec2 delta = endPx - startPx;
      float segmentLength = max(0.000001, length(delta));
      vec2 direction = delta / segmentLength;
      vec2 normal = vec2(-direction.y, direction.x);
      float expand = u_lineHalfWidth + u_edgeWidth;
      float cap = min(expand, segmentLength * 0.5);
      vec2 px = mix(startPx, endPx, a_along)
        + direction * ((a_along * 2.0 - 1.0) * cap)
        + normal * a_side * expand;
      vec2 zeroToOne = px / u_resolution;
      vec2 clip = zeroToOne * 2.0 - 1.0;
      v_side = a_side;
      gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    }
  `;
  const fragmentSource = `#version 300 es
    precision highp float;
    uniform vec3 u_color;
    uniform float u_lineHalfWidth;
    uniform float u_edgeWidth;
    in float v_side;
    out vec4 outColor;

    void main() {
      float expand = u_lineHalfWidth + u_edgeWidth;
      float distanceFromCenter = abs(v_side) * expand;
      float alpha = 1.0 - smoothstep(u_lineHalfWidth, expand, distanceFromCenter);
      outColor = vec4(u_color, alpha);
    }
  `;

  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || "Shader compile failed");
    }
    return shader;
  };

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "Program link failed");
  }
  return program;
};

const createSeriesBufferCache = () => new Map();

const getNextVertexCapacity = (currentCapacity, requiredCapacity) => {
  let nextCapacity = Math.max(
    INITIAL_GPU_VERTEX_CAPACITY,
    currentCapacity || 0,
  );
  while (nextCapacity < requiredCapacity) {
    nextCapacity *= 2;
  }
  return nextCapacity;
};

const getSeriesBuffer = (gl, cache, seriesId, pointCount) => {
  const requiredVertexFloats = pointCount * 2;
  let entry = cache.get(seriesId);
  if (!entry) {
    entry = {
      buffer: gl.createBuffer(),
      gpuCapacity: 0,
      vertices: new Float32Array(
        getNextVertexCapacity(0, requiredVertexFloats),
      ),
    };
    cache.set(seriesId, entry);
  }

  if (entry.vertices.length < requiredVertexFloats) {
    entry.vertices = new Float32Array(
      getNextVertexCapacity(entry.vertices.length, requiredVertexFloats),
    );
  }

  if (entry.gpuCapacity < entry.vertices.length) {
    entry.gpuCapacity = entry.vertices.length;
    gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      entry.gpuCapacity * Float32Array.BYTES_PER_ELEMENT,
      gl.DYNAMIC_DRAW,
    );
  }

  return entry;
};

const getAntialiasSeriesBuffer = (gl, cache, seriesId, pointCount) => {
  const segmentCount = Math.max(0, pointCount - 1);
  const requiredVertexFloats = segmentCount * 6 * AA_VERTEX_FLOAT_STRIDE;
  let entry = cache.get(seriesId);
  if (!entry) {
    entry = {
      buffer: gl.createBuffer(),
      gpuCapacity: 0,
      vertices: new Float32Array(
        getNextVertexCapacity(0, requiredVertexFloats),
      ),
    };
    cache.set(seriesId, entry);
  }

  if (entry.vertices.length < requiredVertexFloats) {
    entry.vertices = new Float32Array(
      getNextVertexCapacity(entry.vertices.length, requiredVertexFloats),
    );
  }

  if (entry.gpuCapacity < entry.vertices.length) {
    entry.gpuCapacity = entry.vertices.length;
    gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      entry.gpuCapacity * Float32Array.BYTES_PER_ELEMENT,
      gl.DYNAMIC_DRAW,
    );
  }

  return entry;
};

const deleteSeriesBuffers = (gl, cache) => {
  cache.forEach((entry) => {
    if (entry.buffer) gl.deleteBuffer(entry.buffer);
  });
  cache.clear();
};

const fillSeriesPoints = ({ vertices, visiblePoints, pointCount, animatedPoint }) => {
  for (let i = 0; i < pointCount; i += 1) {
    if (animatedPoint && i === animatedPoint.index) {
      vertices[i * 2] = animatedPoint.x;
      vertices[i * 2 + 1] = animatedPoint.y;
      continue;
    }
    vertices[i * 2] = visiblePoints.x[i];
    vertices[i * 2 + 1] = visiblePoints.y[i];
  }
};

const projectDataToPixel = ({ x, y, state, yRange, plot }) => ({
  x: plot.x + ((x - state.xMin) / (state.xMax - state.xMin)) * plot.width,
  y: plot.y + ((yRange.maxY - y) / (yRange.maxY - yRange.minY)) * plot.height,
});

const toViewportLayout = (layout, scrollLeft, scrollTop) => ({
  ...layout,
  rect: {
    ...layout.rect,
    x: layout.rect.x - scrollLeft,
    y: layout.rect.y - scrollTop,
  },
  plot: {
    ...layout.plot,
    x: layout.plot.x - scrollLeft,
    y: layout.plot.y - scrollTop,
  },
});

const writeLineVertex = (vertices, offset, x, y) => {
  vertices[offset] = x;
  vertices[offset + 1] = y;
};

const fillDashedSeriesSegments = ({
  vertices,
  visiblePoints,
  pointCount,
  state,
  yRange,
  plot,
}) => {
  let offset = 0;
  let distance = 0;
  const dashTotal = DASH_LENGTH_PX + DASH_GAP_PX;

  for (let i = 0; i < pointCount - 1; i += 1) {
    const start = {
      x: visiblePoints.x[i],
      y: visiblePoints.y[i],
    };
    const end = {
      x: visiblePoints.x[i + 1],
      y: visiblePoints.y[i + 1],
    };
    const startPx = projectDataToPixel({ ...start, state, yRange, plot });
    const endPx = projectDataToPixel({ ...end, state, yRange, plot });
    const pixelLength = Math.hypot(endPx.x - startPx.x, endPx.y - startPx.y);
    if (!Number.isFinite(pixelLength) || pixelLength <= 0) continue;

    let consumed = 0;
    while (consumed < pixelLength) {
      const phase = distance % dashTotal;
      const boundary =
        phase < DASH_LENGTH_PX ? DASH_LENGTH_PX - phase : dashTotal - phase;
      const step = Math.min(boundary, pixelLength - consumed);
      if (phase < DASH_LENGTH_PX) {
        if (offset + 4 > vertices.length) {
          return offset / 2;
        }
        const t0 = consumed / pixelLength;
        const t1 = (consumed + step) / pixelLength;
        writeLineVertex(
          vertices,
          offset,
          start.x + (end.x - start.x) * t0,
          start.y + (end.y - start.y) * t0,
        );
        offset += 2;
        writeLineVertex(
          vertices,
          offset,
          start.x + (end.x - start.x) * t1,
          start.y + (end.y - start.y) * t1,
        );
        offset += 2;
      }
      consumed += step;
      distance += step;
    }
  }

  return offset / 2;
};

const getSeriesPoint = (visiblePoints, animatedPoint, index) => {
  if (animatedPoint && index === animatedPoint.index) {
    return { x: animatedPoint.x, y: animatedPoint.y };
  }
  return { x: visiblePoints.x[index], y: visiblePoints.y[index] };
};

const getSinglePointSegment = ({ series, state, yRange, plot }) => {
  if (series.length !== 1) return null;
  const x = series.rawX[0];
  const y = series.rawY[0];
  if (x < state.xMin || x > state.xMax || y < yRange.minY || y > yRange.maxY) {
    return null;
  }
  // WebGL line strips need two vertices; true one-point series render as a tiny segment.
  const halfWidth = ((state.xMax - state.xMin) / Math.max(1, plot.width)) * 3;
  return {
    x: new Float64Array([x - halfWidth, x + halfWidth]),
    y: new Float32Array([y, y]),
    bucketSize: 1,
    pointCount: 2,
    endpoint: { x, y },
  };
};

const writeAntialiasVertex = (
  vertices,
  offset,
  start,
  end,
  side,
  along,
) => {
  vertices[offset] = start.x;
  vertices[offset + 1] = start.y;
  vertices[offset + 2] = end.x;
  vertices[offset + 3] = end.y;
  vertices[offset + 4] = side;
  vertices[offset + 5] = along;
};

const fillAntialiasSeriesSegments = ({
  vertices,
  visiblePoints,
  pointCount,
  animatedPoint,
}) => {
  let offset = 0;
  for (let i = 0; i < pointCount - 1; i += 1) {
    const start = getSeriesPoint(visiblePoints, animatedPoint, i);
    const end = getSeriesPoint(visiblePoints, animatedPoint, i + 1);
    writeAntialiasVertex(vertices, offset, start, end, -1, 0);
    offset += AA_VERTEX_FLOAT_STRIDE;
    writeAntialiasVertex(vertices, offset, start, end, 1, 0);
    offset += AA_VERTEX_FLOAT_STRIDE;
    writeAntialiasVertex(vertices, offset, start, end, -1, 1);
    offset += AA_VERTEX_FLOAT_STRIDE;
    writeAntialiasVertex(vertices, offset, start, end, -1, 1);
    offset += AA_VERTEX_FLOAT_STRIDE;
    writeAntialiasVertex(vertices, offset, start, end, 1, 0);
    offset += AA_VERTEX_FLOAT_STRIDE;
    writeAntialiasVertex(vertices, offset, start, end, 1, 1);
    offset += AA_VERTEX_FLOAT_STRIDE;
  }
  return offset / AA_VERTEX_FLOAT_STRIDE;
};

const lowerBound = (array, value) => {
  let lo = 0;
  let hi = array.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (array[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

const getNearestPointIndex = (xValues, xValue) => {
  if (!xValues.length) return -1;
  const nextIndex = lowerBound(xValues, xValue);
  if (nextIndex <= 0) return 0;
  if (nextIndex >= xValues.length) return xValues.length - 1;
  const previousIndex = nextIndex - 1;
  return Math.abs(xValues[nextIndex] - xValue) <
    Math.abs(xValue - xValues[previousIndex])
    ? nextIndex
    : previousIndex;
};

const getChartXBounds = (chart) => {
  let minX = Infinity;
  let maxX = -Infinity;
  chart.series.forEach((series) => {
    if (series.length === 0) return;
    minX = Math.min(minX, series.rawX[0]);
    maxX = Math.max(maxX, series.rawX[series.length - 1]);
  });
  return { minX, maxX };
};

const getOrderedSeries = (chart, seriesOrderByChart) => {
  const series = Array.isArray(chart?.series) ? chart.series : [];
  const order = seriesOrderByChart?.[chart?.id];
  if (!Array.isArray(order) || order.length !== series.length) {
    return series;
  }
  const used = new Set();
  const ordered = [];
  order.forEach((seriesIndex) => {
    if (!Number.isInteger(seriesIndex)) return;
    if (seriesIndex < 0 || seriesIndex >= series.length) return;
    if (used.has(seriesIndex)) return;
    used.add(seriesIndex);
    ordered.push(series[seriesIndex]);
  });
  if (ordered.length !== series.length) return series;
  return ordered;
};

const getDefaultSeriesOrderIndices = (chart) =>
  (Array.isArray(chart?.series) ? chart.series : []).map((_, index) => index);

const normalizeMovingAverage = (movingAverage) => {
  if (!movingAverage?.enabled) return null;
  return {
    enabled: true,
    period: Number.isFinite(Number(movingAverage.period))
      ? Math.max(1, Math.round(Number(movingAverage.period)))
      : 21,
    type: movingAverage.type === "sma" ? "sma" : "ema",
  };
};

const getMovingAverageCacheKey = (series, movingAverage) =>
  `${series.id}::ma:${movingAverage.type}:${movingAverage.period}`;

const calculateMovingAverageChunk = ({
  sourceY,
  startIndex,
  period,
  type,
  previousAverage,
}) => {
  const out = new Float32Array(Math.max(0, sourceY.length - startIndex));
  if (out.length === 0) return out;

  if (type === "sma") {
    let sum = 0;
    const firstWindowStart = Math.max(0, startIndex - period + 1);
    for (let i = firstWindowStart; i < startIndex; i += 1) {
      sum += sourceY[i];
    }
    for (let sourceIndex = startIndex; sourceIndex < sourceY.length; sourceIndex += 1) {
      sum += sourceY[sourceIndex];
      const removeIndex = sourceIndex - period;
      if (removeIndex >= firstWindowStart) {
        sum -= sourceY[removeIndex];
      }
      const safePeriod = Math.min(period, sourceIndex + 1);
      out[sourceIndex - startIndex] = sum / safePeriod;
    }
    return out;
  }

  const multiplier = 2 / (period + 1);
  let prev = Number.isFinite(previousAverage)
    ? previousAverage
    : sourceY[startIndex];
  for (let sourceIndex = startIndex; sourceIndex < sourceY.length; sourceIndex += 1) {
    prev = sourceY[sourceIndex] * multiplier + prev * (1 - multiplier);
    out[sourceIndex - startIndex] = prev;
  }
  return out;
};

const getMovingAverageSeriesForChart = ({
  chart,
  movingAverage,
  cache,
}) => {
  const normalized = normalizeMovingAverage(movingAverage);
  if (!normalized || !cache) return [];

  return chart.series
    .map((series) => {
      if (series.length === 0) return null;
      const cacheKey = getMovingAverageCacheKey(series, normalized);
      const cached = cache.get(cacheKey);
      if (
        cached &&
        cached.sourceSeries === series &&
        cached.sourceLength <= series.length
      ) {
        const appendStart = cached.sourceLength;
        if (appendStart < series.length) {
          const appendedY = calculateMovingAverageChunk({
            sourceY: series.rawY.subarray(0, series.length),
            startIndex: appendStart,
            period: normalized.period,
            type: normalized.type,
            previousAverage:
              appendStart > 0 ? cached.series.rawY[appendStart - 1] : undefined,
          });
          cached.series.append(
            series.rawX.subarray(appendStart, series.length),
            appendedY,
          );
          cached.sourceLength = series.length;
        }
        cached.series.color = series.color;
        cached.series.name = `${series.name} ${normalized.type.toUpperCase()} ${normalized.period}`;
        return cached.series;
      }

      const y = calculateMovingAverageChunk({
        sourceY: series.rawY.subarray(0, series.length),
        startIndex: 0,
        period: normalized.period,
        type: normalized.type,
      });
      const maSeries = createSeries({
        id: cacheKey,
        name: `${series.name} ${normalized.type.toUpperCase()} ${normalized.period}`,
        color: series.color,
        x: series.rawX.subarray(0, series.length),
        y,
      });
      cache.set(cacheKey, {
        sourceSeries: series,
        sourceLength: series.length,
        series: maSeries,
      });
      return maSeries;
    })
    .filter(Boolean);
};

const getInitialView = (chart, initialVisiblePoints = null) => {
  const { minX, maxX } = getChartXBounds(chart);
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
    return { xMin: 0, xMax: 1 };
  }
  if (minX === maxX) {
    const span =
      Number.isFinite(initialVisiblePoints) && initialVisiblePoints > 0
        ? Math.max(10, initialVisiblePoints)
        : 10;
    const rightPadding = span * JUMP_LATEST_RIGHT_PADDING_RATIO;
    const nextMax = maxX + rightPadding;
    return { xMin: nextMax - span, xMax: nextMax };
  }
  let span = maxX - minX;
  if (Number.isFinite(initialVisiblePoints) && initialVisiblePoints > 0) {
    span = Math.min(span, initialVisiblePoints);
    const rightPadding = span * JUMP_LATEST_RIGHT_PADDING_RATIO;
    const nextMax = maxX + rightPadding;
    return { xMin: nextMax - span, xMax: nextMax };
  }
  const rightPadding = span * JUMP_LATEST_RIGHT_PADDING_RATIO;
  return { xMin: minX, xMax: maxX + rightPadding };
};

const getYRange = (chart, xMin, xMax, width) => {
  let minY = Infinity;
  let maxY = -Infinity;
  let renderedPoints = 0;
  let bucketSize = 1;

  chart.series.forEach((series) => {
    const visible = series.getVisiblePoints(xMin, xMax, width);
    renderedPoints += visible.pointCount;
    bucketSize = Math.max(bucketSize, visible.bucketSize);
    for (let i = 0; i < visible.y.length; i += 1) {
      const value = visible.y[i];
      if (value < minY) minY = value;
      if (value > maxY) maxY = value;
    }
  });

  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return { minY: 0, maxY: 1, renderedPoints, bucketSize };
  }
  const fixedMinY = Number(chart.yRange?.min);
  const fixedMaxY = Number(chart.yRange?.max);
  if (Number.isFinite(fixedMinY) && Number.isFinite(fixedMaxY) && fixedMinY < fixedMaxY) {
    return { minY: fixedMinY, maxY: fixedMaxY, renderedPoints, bucketSize };
  }
  if (minY === maxY) {
    minY -= 1;
    maxY += 1;
  }
  const pad = (maxY - minY) * 0.08;
  return { minY: minY - pad, maxY: maxY + pad, renderedPoints, bucketSize };
};

const applyYScale = (yRange, scale = 1, centerOffset = 0) => {
  const clampedScale = Math.min(Y_SCALE_MAX, Math.max(Y_SCALE_MIN, scale));
  const center = (yRange.minY + yRange.maxY) / 2 + centerOffset;
  const halfRange = ((yRange.maxY - yRange.minY) * clampedScale) / 2;
  return {
    ...yRange,
    minY: center - halfRange,
    maxY: center + halfRange,
  };
};

const getLatestYBounds = (chart) => {
  let minY = Infinity;
  let maxY = -Infinity;
  chart.series.forEach((series) => {
    if (series.length === 0) return;
    const value = series.rawY[series.length - 1];
    if (value < minY) minY = value;
    if (value > maxY) maxY = value;
  });
  return { minY, maxY };
};

const getPlotWidth = (node) =>
  node
    ? Math.max(1, node.offsetWidth - PLOT_PADDING.left - PLOT_PADDING.right)
    : 1;

const trimFormattedNumber = (value) =>
  value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");

const formatNumber = (value) => {
  if (!Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  if (abs !== 0 && abs < 0.0001) return value.toExponential(2);
  if (abs < 1) return trimFormattedNumber(value.toPrecision(5));
  if (abs >= 100000) return value.toFixed(0);
  if (abs >= 1000) return trimFormattedNumber(value.toFixed(1));
  if (abs >= 10) return trimFormattedNumber(value.toFixed(2));
  return trimFormattedNumber(value.toFixed(4));
};

const formatCompactNumber = (value) => {
  if (!Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  if (abs >= 1000000000) return `${(value / 1000000000).toFixed(abs >= 10000000000 ? 0 : 1)}B`;
  if (abs >= 1000000) return `${(value / 1000000).toFixed(abs >= 10000000 ? 0 : 1)}M`;
  if (abs >= 1000) return `${(value / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  return formatNumber(value);
};

const normalizeRect = (start, end) => {
  if (!start || !end) return null;
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  return {
    left,
    top,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
};

const clampPointToPlot = (point, plot) => ({
  x: Math.min(plot.x + plot.width, Math.max(plot.x, point.x)),
  y: Math.min(plot.y + plot.height, Math.max(plot.y, point.y)),
});

const applyRectangleZoom = ({
  chart,
  plot,
  start,
  end,
  initialVisiblePoints,
  viewStateRef,
  yScaleRef,
  yCenterOffsetRef,
  yManualScaleRef,
}) => {
  const clampedStart = clampPointToPlot(start, plot);
  const clampedEnd = clampPointToPlot(end, plot);
  const rect = normalizeRect(clampedStart, clampedEnd);
  if (!rect || rect.width < 6 || rect.height < 6) return false;

  const state =
    viewStateRef.current.get(chart.id) ||
    getInitialView(chart, initialVisiblePoints);
  const currentYRange = applyYScale(
    getYRange(chart, state.xMin, state.xMax, plot.width),
    yScaleRef.current.get(chart.id) ?? 1,
    yCenterOffsetRef.current.get(chart.id) ?? 0,
  );

  const leftRatio = (rect.left - plot.x) / plot.width;
  const rightRatio = (rect.left + rect.width - plot.x) / plot.width;
  const topRatio = (rect.top - plot.y) / plot.height;
  const bottomRatio = (rect.top + rect.height - plot.y) / plot.height;
  const nextMin = state.xMin + leftRatio * (state.xMax - state.xMin);
  const nextMax = state.xMin + rightRatio * (state.xMax - state.xMin);
  if (nextMax - nextMin < X_SCALE_MIN_SPAN) return false;

  const selectedMaxY =
    currentYRange.maxY - topRatio * (currentYRange.maxY - currentYRange.minY);
  const selectedMinY =
    currentYRange.maxY -
    bottomRatio * (currentYRange.maxY - currentYRange.minY);
  const selectedSpan = selectedMaxY - selectedMinY;
  if (!Number.isFinite(selectedSpan) || selectedSpan <= 0) return false;

  viewStateRef.current.set(chart.id, { xMin: nextMin, xMax: nextMax });

  const baseYRange = getYRange(chart, nextMin, nextMax, plot.width);
  const baseSpan = baseYRange.maxY - baseYRange.minY;
  if (Number.isFinite(baseSpan) && baseSpan > 0) {
    const selectedCenter = (selectedMinY + selectedMaxY) / 2;
    const baseCenter = (baseYRange.minY + baseYRange.maxY) / 2;
    const nextScale = Math.min(
      Y_SCALE_MAX,
      Math.max(Y_SCALE_MIN, selectedSpan / baseSpan),
    );
    yScaleRef.current.set(chart.id, nextScale);
    yCenterOffsetRef.current.set(chart.id, selectedCenter - baseCenter);
    yManualScaleRef.current.add(chart.id);
  }

  return true;
};

const getChartState = (chart, initialVisiblePoints, viewStateRef) =>
  viewStateRef.current.get(chart.id) ||
  getInitialView(chart, initialVisiblePoints);

const getScaledYRangeForLayout = ({
  chart,
  state,
  plot,
  yScaleRef,
  yCenterOffsetRef,
}) =>
  applyYScale(
    getYRange(chart, state.xMin, state.xMax, plot.width),
    yScaleRef.current.get(chart.id) ?? 1,
    yCenterOffsetRef.current.get(chart.id) ?? 0,
  );

const screenPointToDataPoint = ({
  point,
  chart,
  plot,
  initialVisiblePoints,
  viewStateRef,
  yScaleRef,
  yCenterOffsetRef,
}) => {
  const state = getChartState(chart, initialVisiblePoints, viewStateRef);
  const yRange = getScaledYRangeForLayout({
    chart,
    state,
    plot,
    yScaleRef,
    yCenterOffsetRef,
  });
  const xRatio = (point.x - plot.x) / plot.width;
  const yRatio = (point.y - plot.y) / plot.height;
  return {
    x: state.xMin + xRatio * (state.xMax - state.xMin),
    y: yRange.maxY - yRatio * (yRange.maxY - yRange.minY),
  };
};

const dataPointToScreenPoint = ({ point, state, yRange, plot }) => {
  const xRatio = (point.x - state.xMin) / (state.xMax - state.xMin);
  const yRatio = (yRange.maxY - point.y) / (yRange.maxY - yRange.minY);
  return {
    x: plot.x + xRatio * plot.width,
    y: plot.y + yRatio * plot.height,
  };
};

const projectDataPointToScreenPoint = ({
  point,
  layout,
  initialVisiblePoints,
  viewStateRef,
  yScaleRef,
  yCenterOffsetRef,
}) => {
  const state = getChartState(layout.chart, initialVisiblePoints, viewStateRef);
  const yRange = getScaledYRangeForLayout({
    chart: layout.chart,
    state,
    plot: layout.plot,
    yScaleRef,
    yCenterOffsetRef,
  });
  return dataPointToScreenPoint({
    point,
    state,
    yRange,
    plot: layout.plot,
  });
};

const createAxisOverlay = ({
  chart,
  plot,
  state,
  yRange,
  seriesEndpoints,
  seriesOrderByChart = {},
}) => {
  const { maxX } = getChartXBounds(chart);
  const ticks = Array.from({ length: Y_AXIS_TICK_COUNT }, (_, index) => {
    const ratio = Y_AXIS_TICK_COUNT === 1 ? 0 : index / (Y_AXIS_TICK_COUNT - 1);
    const value = yRange.maxY - ratio * (yRange.maxY - yRange.minY);
    return {
      id: `${chart.id}-tick-${index}`,
      value,
      top: ratio * plot.height,
    };
  });

  const xTicks = Array.from({ length: X_AXIS_TICK_COUNT }, (_, index) => {
    const ratio = X_AXIS_TICK_COUNT === 1 ? 0 : index / (X_AXIS_TICK_COUNT - 1);
    return {
      id: `${chart.id}-x-tick-${index}`,
      value: state.xMin + ratio * (state.xMax - state.xMin),
      left: 18 + ratio * Math.max(1, plot.width - 36),
    };
  });

  const latestValues = getOrderedSeries(chart, seriesOrderByChart)
    .map((series) => {
      if (series.length === 0) return null;
      const value = series.rawY[series.length - 1];
      const x = series.rawX[series.length - 1];
      const endpoint = seriesEndpoints.get(series.id) || { x, y: value };
      const ratio = (yRange.maxY - endpoint.y) / (yRange.maxY - yRange.minY);
      const xRatio = (endpoint.x - state.xMin) / (state.xMax - state.xMin);
      return {
        id: series.id,
        color: series.color,
        textColor: getSeriesLabelTextColor(series),
        value: endpoint.y,
        rawValue: value,
        x,
        left: xRatio * plot.width,
        top: ratio * plot.height,
      };
    })
    .filter(
      (value) =>
        value &&
        Number.isFinite(value.top) &&
        value.top >= -10 &&
        value.top <= plot.height + 10,
    );

  return {
    ticks,
    xTicks,
    latestValues,
    plotWidth: plot.width,
    showJumpLatest:
      Number.isFinite(maxX) && (maxX < state.xMin || maxX > state.xMax),
  };
};

function ChartCell({
  chart,
  setRef,
  axisOverlay,
  focused,
  onFocus,
  onFullscreenToggle,
  onReset,
  onJumpLatest,
  onRectangleZoomToggle,
  rectangleZoomActive = false,
  movingAverage = null,
  onMovingAverageToggle,
  activeDrawingTool = null,
  onDrawingToolToggle,
  hasDrawings = false,
  onClearDrawingsRequest,
  disableDrawings = false,
  gridLines = false,
  showToolbar = true,
  showLatestValueLine = true,
  height = CHART_HEIGHT,
  isFullscreen = false,
  backgroundColor = DEFAULT_CHART_BACKGROUND,
  formatXTick = formatCompactNumber,
  formatYValue = formatNumber,
}) {
  const headerBackground = withAlpha(backgroundColor, 0.82);
  const controlBackground = withAlpha(backgroundColor, 0.78);
  const mutedControlBackground = withAlpha(backgroundColor, 0.7);
  const jumpLatestStyle =
    typeof height === "number"
      ? {
          right: RIGHT_AXIS_WIDTH + 6,
          top: height - PLOT_PADDING.bottom - 34,
        }
      : {
          right: RIGHT_AXIS_WIDTH + 6,
          bottom: PLOT_PADDING.bottom + 6,
        };
  const gridOptions = gridLines === true ? EMPTY_OBJECT : gridLines;
  const gridXSpacing = Math.max(
    8,
    Number(gridOptions?.xSpacing) || DEFAULT_GRID_X_SPACING,
  );
  const gridYSpacing = Math.max(
    8,
    Number(gridOptions?.ySpacing) || DEFAULT_GRID_Y_SPACING,
  );

  return (
    <div
      ref={setRef}
      className="relative select-none overflow-hidden rounded-sm"
      style={{ height, backgroundColor }}
      onPointerDown={() => onFocus(chart.id)}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-8 items-center justify-between px-2 backdrop-blur"
        style={{ backgroundColor: headerBackground }}
      >
        <div
          className={`flex min-w-0 items-center gap-1 rounded-sm px-1 text-sm font-semibold text-foreground ${
            focused ? "ring-1 ring-primary/70" : ""
          }`}
        >
          {chart.pinned ? (
            <PushPinSimpleIcon
              size={14}
              weight="fill"
              className="shrink-0 text-foreground/80"
            />
          ) : null}
          <span className="truncate">{chart.title}</span>
        </div>
      </div>
      {gridLines ? (
        <div
          className="pointer-events-none absolute text-border/40"
          style={{
            left: PLOT_PADDING.left,
            right: PLOT_PADDING.right,
            top: PLOT_PADDING.top,
            bottom: PLOT_PADDING.bottom,
            backgroundImage:
              "linear-gradient(to right, transparent calc(100% - 1px), currentColor calc(100% - 1px)), linear-gradient(to bottom, transparent calc(100% - 1px), currentColor calc(100% - 1px))",
            backgroundSize: `${gridXSpacing}px 100%, 100% ${gridYSpacing}px`,
          }}
        />
      ) : null}
      {axisOverlay?.showJumpLatest ? (
        <button
          type="button"
          aria-label="Jump to latest"
          className="absolute z-30 inline-flex size-7 items-center justify-center rounded-sm text-foreground hover:bg-accent hover:text-accent-foreground"
          style={{
            ...jumpLatestStyle,
            backgroundColor: mutedControlBackground,
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onJumpLatest(chart.id);
          }}
        >
          <ArrowLineRightIcon size={16} weight="bold" />
        </button>
      ) : null}
      {focused && showToolbar ? (
        <ChartToolbar
          isFullscreen={isFullscreen}
          onFullscreenToggle={onFullscreenToggle}
          onReset={() => onReset?.(chart.id)}
          onRectangleZoomToggle={() => onRectangleZoomToggle?.(chart.id)}
          rectangleZoomActive={rectangleZoomActive}
          onMovingAverageToggle={() => onMovingAverageToggle?.(chart.id)}
          movingAverageActive={Boolean(movingAverage?.enabled)}
          activeDrawingTool={activeDrawingTool}
          onDrawingToolToggle={onDrawingToolToggle}
          hasDrawings={hasDrawings}
          onClearDrawingsRequest={() => onClearDrawingsRequest?.(chart.id)}
          disableDrawings={disableDrawings}
        />
      ) : null}
      {showLatestValueLine && axisOverlay?.latestValues.map((latest) =>
        latest.left >= 0 && latest.left <= axisOverlay.plotWidth ? (
          <div
            key={`${latest.id}-connector`}
            className="pointer-events-none absolute z-10 opacity-70"
            style={{
              left: PLOT_PADDING.left + latest.left,
              top: PLOT_PADDING.top + latest.top,
              height: 1,
              width: Math.max(0, axisOverlay.plotWidth - latest.left),
              backgroundImage: `repeating-linear-gradient(to right, ${latest.color} 0 4px, transparent 4px 8px)`,
            }}
          />
        ) : null,
      )}
      <div
        className="absolute right-0 z-20 cursor-ns-resize"
        style={{
          top: PLOT_PADDING.top,
          bottom: PLOT_PADDING.bottom,
          width: RIGHT_AXIS_WIDTH,
          backgroundColor: controlBackground,
          cursor: "ns-resize",
        }}
      >
        {axisOverlay?.ticks.map((tick) => (
          <div
            key={tick.id}
            className="pointer-events-none absolute left-1/2 -translate-x-1/2 -translate-y-1/2 text-center text-[11px] font-medium tabular-nums text-foreground/70 dark:text-foreground/80"
            style={{ top: tick.top }}
          >
            {formatYValue(tick.value)}
          </div>
        ))}
        {axisOverlay?.latestValues.map((latest) => (
          <div
            key={latest.id}
            className="pointer-events-none absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-sm px-1.5 py-0.5 text-center text-[10px] font-bold tabular-nums shadow-sm"
            style={{
              top: latest.top,
              backgroundColor: latest.color,
              color: latest.textColor,
            }}
          >
            {formatYValue(latest.value)}
          </div>
        ))}
      </div>
      <div
        className="absolute bottom-0 z-20 cursor-ew-resize"
        style={{
          left: PLOT_PADDING.left,
          right: RIGHT_AXIS_WIDTH,
          height: PLOT_PADDING.bottom,
          backgroundColor: mutedControlBackground,
          cursor: "ew-resize",
        }}
      >
        {axisOverlay?.xTicks.map((tick) => (
          <div
            key={tick.id}
            className="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-center text-[11px] font-medium tabular-nums text-foreground/70 dark:text-foreground/80"
            style={{ left: tick.left }}
          >
            {formatXTick(tick.value)}
          </div>
        ))}
      </div>
    </div>
  );
}

function CrosshairOverlay({
  crosshair,
  height = "100%",
  xAxisLabel = "STEP",
  formatXValue = formatNumber,
  formatYValue = formatNumber,
}) {
  if (!crosshair) return null;

  return (
    <>
      <div
        className="pointer-events-none absolute z-20 border-l border-foreground/40"
        style={{
          left: crosshair.x,
          top: 0,
          height,
        }}
      />
      <div
        className="pointer-events-none absolute z-20 border-t border-foreground/40"
        style={{ left: 0, top: crosshair.y, width: "100%" }}
      />
      {crosshair.points.map((point) => (
        <div
          key={point.id}
          className="pointer-events-none absolute z-30 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background shadow-sm"
          style={{
            left: point.x,
            top: point.y,
            backgroundColor: point.color,
          }}
        />
      ))}
      <div
        className="pointer-events-none absolute z-30 w-[220px] rounded-sm border border-border/70 bg-popover/80 px-2 py-1.5 text-xs text-popover-foreground shadow-sm backdrop-blur-sm"
        style={{
          left: crosshair.tooltipX,
          top: crosshair.tooltipY,
        }}
      >
        <div className="mb-1 font-medium">
          {xAxisLabel}: {formatXValue(crosshair.xValue)}
        </div>
        {crosshair.points.map((point) => (
          <div
            key={`${point.id}-tooltip`}
            className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5"
          >
            <span
              className="mt-1 size-2 rounded-full"
              style={{ backgroundColor: point.color }}
            />
            <div className="min-w-0">
              <div className="truncate text-muted-foreground">{point.name}</div>
              <div className="tabular-nums">{formatYValue(point.yValue)}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function RectangleZoomOverlay({ rect }) {
  if (!rect) return null;
  const normalized = normalizeRect(rect.start, rect.end);
  if (!normalized) return null;

  return (
    <div
      className="pointer-events-none absolute z-40 rounded-sm border border-primary/70 bg-primary/10"
      style={{
        left: normalized.left,
        top: normalized.top,
        width: normalized.width,
        height: normalized.height,
      }}
    />
  );
}

function TopMarkersOverlay({
  layouts,
  markers,
  viewStateRef,
  initialVisiblePoints,
  onMarkerClick,
  height = "100%",
}) {
  const safeMarkers = Array.isArray(markers) ? markers : [];
  if (!safeMarkers.length || !layouts.length) return null;

  const markerItems = layouts.flatMap((layout) => {
    const state =
      viewStateRef.current.get(layout.chart.id) ||
      getInitialView(layout.chart, initialVisiblePoints);
    const span = state.xMax - state.xMin;
    if (!Number.isFinite(span) || span <= 0) return [];

    return safeMarkers
      .map((marker) => {
        const xValue = Number(marker?.x ?? marker?.step);
        if (!Number.isFinite(xValue)) return null;
        const ratio = (xValue - state.xMin) / span;
        if (ratio < 0 || ratio > 1) return null;
        return {
          marker,
          key: `${layout.chart.id}-${marker.id ?? xValue}-${xValue}`,
          left: layout.plot.x + ratio * layout.plot.width,
          top: layout.plot.y + 4,
        };
      })
      .filter(Boolean);
  });

  if (!markerItems.length) return null;

  return (
    <div
      className="pointer-events-none absolute left-0 top-0 z-30"
      style={{ width: "100%", height }}
    >
      {markerItems.map((item) => (
        <button
          key={item.key}
          type="button"
          className="pointer-events-auto absolute -translate-x-1/2 rounded-full"
          style={{ left: item.left, top: item.top }}
          title={item.marker.title || ""}
          aria-label={item.marker.ariaLabel || item.marker.title || "Chart marker"}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onMarkerClick?.(item.marker);
          }}
        >
          <span
            className="block size-2.5 rounded-full border border-background shadow-sm"
            style={{ backgroundColor: item.marker.color || "#f97316" }}
          />
        </button>
      ))}
    </div>
  );
}

const drawChartLayouts = ({
  canvas,
  width,
  height,
  gl,
  program,
  antialiasProgram,
  antialiasLines = false,
  layouts,
  viewStateRef,
  yScaleRef,
  yCenterOffsetRef,
  seriesBufferCache,
  antialiasSeriesBufferCache,
  initialVisiblePoints,
  getAppendAnimatedPoint,
  movingAverageByChart = EMPTY_OBJECT,
  movingAverageCache,
  seriesOrderByChart = EMPTY_OBJECT,
}) => {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pixelWidth = Math.max(1, Math.floor(width * dpr));
  const pixelHeight = Math.max(1, Math.floor(height * dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  gl.viewport(0, 0, pixelWidth, pixelHeight);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const activeAntialiasLines = antialiasLines && antialiasProgram;
  const activeProgram = activeAntialiasLines ? antialiasProgram : program;
  gl.useProgram(activeProgram);

  const uResolution = gl.getUniformLocation(activeProgram, "u_resolution");
  const uRect = gl.getUniformLocation(activeProgram, "u_rect");
  const uXRange = gl.getUniformLocation(activeProgram, "u_xRange");
  const uYRange = gl.getUniformLocation(activeProgram, "u_yRange");
  const uColor = gl.getUniformLocation(activeProgram, "u_color");

  let aXy = -1;
  let aStart = -1;
  let aEnd = -1;
  let aSide = -1;
  let aAlong = -1;
  let uLineHalfWidth = null;
  let uEdgeWidth = null;

  if (activeAntialiasLines) {
    aStart = gl.getAttribLocation(activeProgram, "a_start");
    aEnd = gl.getAttribLocation(activeProgram, "a_end");
    aSide = gl.getAttribLocation(activeProgram, "a_side");
    aAlong = gl.getAttribLocation(activeProgram, "a_along");
    uLineHalfWidth = gl.getUniformLocation(activeProgram, "u_lineHalfWidth");
    uEdgeWidth = gl.getUniformLocation(activeProgram, "u_edgeWidth");
    gl.enableVertexAttribArray(aStart);
    gl.enableVertexAttribArray(aEnd);
    gl.enableVertexAttribArray(aSide);
    gl.enableVertexAttribArray(aAlong);
    gl.uniform1f(uLineHalfWidth, (AA_LINE_WIDTH_PX * dpr) / 2);
    gl.uniform1f(uEdgeWidth, AA_EDGE_WIDTH_PX * dpr);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  } else {
    aXy = gl.getAttribLocation(activeProgram, "a_xy");
    gl.enableVertexAttribArray(aXy);
    gl.disable(gl.BLEND);
  }

  gl.uniform2f(uResolution, pixelWidth, pixelHeight);

  const now = performance.now();
  const nextAxisOverlays = {};

  layouts.forEach(({ chart, plot, visible }) => {
    if (!visible) return;
    if (activeAntialiasLines) {
      gl.useProgram(activeProgram);
      gl.uniform2f(uResolution, pixelWidth, pixelHeight);
    }
    const state =
      viewStateRef.current.get(chart.id) ||
      getInitialView(chart, initialVisiblePoints);
    const scaledPlot = {
      x: plot.x * dpr,
      y: plot.y * dpr,
      width: plot.width * dpr,
      height: plot.height * dpr,
    };
    const yRange = applyYScale(
      getYRange(chart, state.xMin, state.xMax, plot.width),
      yScaleRef.current.get(chart.id) ?? 1,
      yCenterOffsetRef.current.get(chart.id) ?? 0,
    );
    const seriesEndpoints = new Map();
    const chartMovingAverage = movingAverageByChart?.[chart.id];
    const hideBaseSeries =
      Boolean(chartMovingAverage?.enabled) && Boolean(chartMovingAverage?.hideBase);

    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(
      Math.floor(scaledPlot.x),
      Math.floor(pixelHeight - scaledPlot.y - scaledPlot.height),
      Math.ceil(scaledPlot.width),
      Math.ceil(scaledPlot.height),
    );
    gl.uniform4f(
      uRect,
      scaledPlot.x,
      scaledPlot.y,
      scaledPlot.width,
      scaledPlot.height,
    );
    gl.uniform2f(uXRange, state.xMin, state.xMax);
    gl.uniform2f(uYRange, yRange.minY, yRange.maxY);

    if (!hideBaseSeries) getOrderedSeries(chart, seriesOrderByChart).forEach((series) => {
      let visiblePoints = series.getVisiblePoints(
        state.xMin,
        state.xMax,
        plot.width,
      );
      let singlePointEndpoint = null;
      if (visiblePoints.pointCount < 2) {
        const singlePointSegment = getSinglePointSegment({
          series,
          state,
          yRange,
          plot,
        });
        if (!singlePointSegment) return;
        visiblePoints = singlePointSegment;
        singlePointEndpoint = singlePointSegment.endpoint;
      }
      const animatedPoint = singlePointEndpoint
        ? null
        : getAppendAnimatedPoint({
            seriesId: series.id,
            visiblePoints,
            now,
          });
      const pointCount = animatedPoint?.pointCount ?? visiblePoints.pointCount;
      if (animatedPoint) {
        seriesEndpoints.set(series.id, {
          x: animatedPoint.x,
          y: animatedPoint.y,
        });
      } else if (singlePointEndpoint) {
        seriesEndpoints.set(series.id, singlePointEndpoint);
      }

      const [r, g, b] = hexToRgb(series.color);
      gl.uniform3f(uColor, r, g, b);

      if (activeAntialiasLines) {
        const bufferEntry = getAntialiasSeriesBuffer(
          gl,
          antialiasSeriesBufferCache,
          series.id,
          pointCount,
        );
        const drawVertexCount = fillAntialiasSeriesSegments({
          vertices: bufferEntry.vertices,
          visiblePoints,
          pointCount,
          animatedPoint,
        });
        const stride = AA_VERTEX_FLOAT_STRIDE * Float32Array.BYTES_PER_ELEMENT;
        gl.bindBuffer(gl.ARRAY_BUFFER, bufferEntry.buffer);
        gl.vertexAttribPointer(aStart, 2, gl.FLOAT, false, stride, 0);
        gl.vertexAttribPointer(
          aEnd,
          2,
          gl.FLOAT,
          false,
          stride,
          2 * Float32Array.BYTES_PER_ELEMENT,
        );
        gl.vertexAttribPointer(
          aSide,
          1,
          gl.FLOAT,
          false,
          stride,
          4 * Float32Array.BYTES_PER_ELEMENT,
        );
        gl.vertexAttribPointer(
          aAlong,
          1,
          gl.FLOAT,
          false,
          stride,
          5 * Float32Array.BYTES_PER_ELEMENT,
        );
        gl.bufferSubData(
          gl.ARRAY_BUFFER,
          0,
          bufferEntry.vertices,
          0,
          drawVertexCount * AA_VERTEX_FLOAT_STRIDE,
        );
        gl.drawArrays(gl.TRIANGLES, 0, drawVertexCount);
        return;
      }

      const bufferEntry = getSeriesBuffer(
        gl,
        seriesBufferCache,
        series.id,
        pointCount,
      );
      fillSeriesPoints({
        vertices: bufferEntry.vertices,
        visiblePoints,
        pointCount,
        animatedPoint,
      });
      gl.bindBuffer(gl.ARRAY_BUFFER, bufferEntry.buffer);
      gl.vertexAttribPointer(aXy, 2, gl.FLOAT, false, 0, 0);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        bufferEntry.vertices,
        0,
        pointCount * 2,
      );
      gl.drawArrays(gl.LINE_STRIP, 0, pointCount);
    });
    const movingAverageSeries = getMovingAverageSeriesForChart({
      chart,
      movingAverage: chartMovingAverage,
      cache: movingAverageCache,
    });
    const orderedMovingAverageSeries = getOrderedSeries(
      { ...chart, series: movingAverageSeries },
      seriesOrderByChart,
    );
    let maAXy = aXy;
    let maUColor = uColor;
    if (movingAverageSeries.length > 0 && activeAntialiasLines) {
      gl.useProgram(program);
      const maUResolution = gl.getUniformLocation(program, "u_resolution");
      const maURect = gl.getUniformLocation(program, "u_rect");
      const maUXRange = gl.getUniformLocation(program, "u_xRange");
      const maUYRange = gl.getUniformLocation(program, "u_yRange");
      maUColor = gl.getUniformLocation(program, "u_color");
      maAXy = gl.getAttribLocation(program, "a_xy");
      gl.enableVertexAttribArray(maAXy);
      gl.uniform2f(maUResolution, pixelWidth, pixelHeight);
      gl.uniform4f(
        maURect,
        scaledPlot.x,
        scaledPlot.y,
        scaledPlot.width,
        scaledPlot.height,
      );
      gl.uniform2f(maUXRange, state.xMin, state.xMax);
      gl.uniform2f(maUYRange, yRange.minY, yRange.maxY);
    }
    orderedMovingAverageSeries.forEach((series) => {
      const visiblePoints = series.getVisiblePoints(
        state.xMin,
        state.xMax,
        plot.width,
      );
      if (visiblePoints.pointCount < 2) return;
      const pointCount = visiblePoints.pointCount;
      const [r, g, b] = hexToRgb(series.color);
      gl.uniform3f(maUColor, r, g, b);

      const bufferEntry = getSeriesBuffer(
        gl,
        seriesBufferCache,
        series.id,
        pointCount * 8,
      );
      const drawVertexCount = fillDashedSeriesSegments({
        vertices: bufferEntry.vertices,
        visiblePoints,
        pointCount,
        state,
        yRange,
        plot,
      });
      if (drawVertexCount < 2) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, bufferEntry.buffer);
      gl.vertexAttribPointer(maAXy, 2, gl.FLOAT, false, 0, 0);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        bufferEntry.vertices,
        0,
        drawVertexCount * 2,
      );
      gl.drawArrays(gl.LINES, 0, drawVertexCount);
    });
    nextAxisOverlays[chart.id] = createAxisOverlay({
      chart,
      plot,
      state,
      yRange,
      seriesEndpoints,
      seriesOrderByChart,
    });
    gl.disable(gl.SCISSOR_TEST);
  });

  if (activeAntialiasLines) {
    gl.disable(gl.BLEND);
  }

  return nextAxisOverlays;
};

function ChartFullscreenOverlay({
  chart,
  dataRevision,
  renderRevision,
  initialVisiblePoints,
  backgroundColor,
  antialiasLines = false,
  getAppendAnimatedPoint,
  viewStateRef,
  yScaleRef,
  yCenterOffsetRef,
  yManualScaleRef,
  movingAverageByChart = {},
  movingAverageCache,
  onMovingAverageToggle,
  onMovingAverageChange,
  seriesOrderByChart = {},
  onClose,
  onReset,
  onJumpLatest,
  xAxisLabel = "STEP",
  drawings = EMPTY_ARRAY,
  onDrawingsChange,
  activeDrawingTool = null,
  onActiveDrawingToolChange,
  selectedDrawingId = null,
  onSelectedDrawingIdChange,
  createDrawingId,
  onClearDrawingsRequest,
  onChartContextMenu,
  topMarkers = EMPTY_ARRAY,
  onTopMarkerClick,
  disableDrawings = false,
  gridLines = false,
  showToolbar = true,
  showLatestValueLine = true,
  showTooltips = true,
  formatXTick = formatCompactNumber,
  formatXValue = formatNumber,
  formatYValue = formatNumber,
}) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const canvasRef = useRef(null);
  const glRef = useRef(null);
  const programRef = useRef(null);
  const antialiasProgramRef = useRef(null);
  const seriesBufferCacheRef = useRef(createSeriesBufferCache());
  const antialiasSeriesBufferCacheRef = useRef(createSeriesBufferCache());
  const movingAverageCacheRef = useRef(new Map());
  const dragRef = useRef(null);
  const rectangleZoomDragRef = useRef(null);
  const closeTimeoutRef = useRef(null);
  const [revision, setRevision] = useState(0);
  const [axisOverlay, setAxisOverlay] = useState(null);
  const [crosshair, setCrosshair] = useState(null);
  const [visible, setVisible] = useState(false);
  const [rectangleZoomActive, setRectangleZoomActive] = useState(false);
  const [rectangleZoomRect, setRectangleZoomRect] = useState(null);
  const chartDrawings = disableDrawings ? EMPTY_ARRAY : drawings;
  const chartActiveDrawingTool = disableDrawings ? null : activeDrawingTool;
  const chartSelectedDrawingId = disableDrawings ? null : selectedDrawingId;

  useEffect(() => {
    if (!showTooltips) setCrosshair(null);
  }, [showTooltips]);

  const requestRender = useCallback(() => {
    setRevision((value) => value + 1);
  }, []);

  const closeWithTransition = useCallback(() => {
    setVisible(false);
    closeTimeoutRef.current = window.setTimeout(onClose, 120);
  }, [onClose]);

  const {
    draftDrawing,
    drawingSessionRef,
    drawingEditRef,
    clearDraft,
    cancelDrawing,
    toggleDrawingTool,
    commitDrawing,
    startDraftDrawing,
    updateDraftDrawing,
    startEditDrawing,
    finishEditDrawing,
    deleteSelectedDrawing,
  } = useDrawingInteractions({
    drawings: chartDrawings,
    onDrawingsChange: disableDrawings ? undefined : onDrawingsChange,
    activeDrawingTool: chartActiveDrawingTool,
    onActiveDrawingToolChange,
    selectedDrawingId: chartSelectedDrawingId,
    onSelectedDrawingIdChange,
    createDrawingId,
    onModeChange: () => {
      setRectangleZoomActive(false);
      setRectangleZoomRect(null);
      rectangleZoomDragRef.current = null;
    },
  });

  const toggleRectangleZoom = useCallback(() => {
    setRectangleZoomActive((value) => !value);
    setRectangleZoomRect(null);
    rectangleZoomDragRef.current = null;
    clearDraft();
    onActiveDrawingToolChange?.(null);
  }, [clearDraft, onActiveDrawingToolChange]);

  const toggleSelectedDrawingExtend = useCallback(() => {
    if (disableDrawings || !chartSelectedDrawingId || !onDrawingsChange) return;
    onDrawingsChange(
      updateDrawingById(chartDrawings, chartSelectedDrawingId, (drawing) => ({
        ...drawing,
        style: {
          ...drawing.style,
          extendRight: drawing.style?.extendRight === false,
        },
      })),
    );
  }, [chartDrawings, chartSelectedDrawingId, disableDrawings, onDrawingsChange]);

  const updateSelectedDrawingColor = useCallback(
    (color) => {
      if (disableDrawings || !chartSelectedDrawingId || !onDrawingsChange) return;
      onDrawingsChange(
        updateDrawingById(chartDrawings, chartSelectedDrawingId, (drawing) => ({
          ...drawing,
          style: {
            ...drawing.style,
            color,
          },
        })),
      );
    },
    [chartDrawings, chartSelectedDrawingId, disableDrawings, onDrawingsChange],
  );

  const updateSelectedDrawingText = useCallback(
    (text) => {
      if (disableDrawings || !chartSelectedDrawingId || !onDrawingsChange) return;
      onDrawingsChange(
        updateDrawingById(chartDrawings, chartSelectedDrawingId, (drawing) => ({
          ...drawing,
          style: {
            ...drawing.style,
            text,
          },
        })),
      );
    },
    [chartDrawings, chartSelectedDrawingId, disableDrawings, onDrawingsChange],
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => {
      cancelAnimationFrame(frame);
      if (closeTimeoutRef.current != null) {
        clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
    };
  }, []);

  const getLayout = useCallback(() => {
    const node = chartRef.current;
    if (!node) return null;
    const rect = {
      x: node.offsetLeft,
      y: node.offsetTop,
      width: node.offsetWidth,
      height: node.offsetHeight,
    };
    const plot = {
      x: rect.x + PLOT_PADDING.left,
      y: rect.y + PLOT_PADDING.top,
      width: Math.max(1, rect.width - PLOT_PADDING.left - PLOT_PADDING.right),
      height: Math.max(1, rect.height - PLOT_PADDING.top - PLOT_PADDING.bottom),
    };
    return { chart, rect, plot, visible: true };
  }, [chart]);

  const getLocalPoint = useCallback((event) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", {
      antialias: true,
      alpha: true,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) return;
    glRef.current = gl;
    programRef.current = createProgram(gl);
    antialiasProgramRef.current = createAntialiasProgram(gl);
    requestRender();

    return () => {
      deleteSeriesBuffers(gl, seriesBufferCacheRef.current);
      deleteSeriesBuffers(gl, antialiasSeriesBufferCacheRef.current);
      glRef.current = null;
      programRef.current = null;
      antialiasProgramRef.current = null;
    };
  }, [requestRender]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(requestRender);
    observer.observe(container);
    return () => observer.disconnect();
  }, [requestRender]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const gl = glRef.current;
    const program = programRef.current;
    const antialiasProgram = antialiasProgramRef.current;
    const layout = getLayout();
    if (!container || !canvas || !gl || !program || !layout) return;

    const nextAxisOverlays = drawChartLayouts({
      canvas,
      width: container.clientWidth,
      height: container.clientHeight,
      gl,
      program,
      antialiasProgram,
      antialiasLines,
      layouts: [layout],
      viewStateRef,
      yScaleRef,
      yCenterOffsetRef,
      seriesBufferCache: seriesBufferCacheRef.current,
      antialiasSeriesBufferCache: antialiasSeriesBufferCacheRef.current,
      initialVisiblePoints,
      getAppendAnimatedPoint,
      movingAverageByChart,
      movingAverageCache,
      seriesOrderByChart,
    });
    setAxisOverlay(nextAxisOverlays[chart.id] || null);
  }, [
    chart,
    antialiasLines,
    dataRevision,
    getAppendAnimatedPoint,
    getLayout,
    initialVisiblePoints,
    movingAverageByChart,
    movingAverageCache,
    seriesOrderByChart,
    renderRevision,
    revision,
    viewStateRef,
    yCenterOffsetRef,
    yScaleRef,
  ]);

  const updateCrosshair = useCallback(
    (event) => {
      const point = getLocalPoint(event);
      const layout = getLayout();
      if (!point || !layout) return;
      if (
        point.x < layout.plot.x ||
        point.x > layout.plot.x + layout.plot.width ||
        point.y < layout.plot.y ||
        point.y > layout.plot.y + layout.plot.height
      ) {
        setCrosshair(null);
        return;
      }

      const state =
        viewStateRef.current.get(chart.id) ||
        getInitialView(chart, initialVisiblePoints);
      const xRatio = (point.x - layout.plot.x) / layout.plot.width;
      const xValue = state.xMin + xRatio * (state.xMax - state.xMin);
      const yRange = getYRange(
        chart,
        state.xMin,
        state.xMax,
        layout.plot.width,
      );
      const scaledYRange = applyYScale(
        yRange,
        yScaleRef.current.get(chart.id) ?? 1,
        yCenterOffsetRef.current.get(chart.id) ?? 0,
      );
      const yRatio = (point.y - layout.plot.y) / layout.plot.height;
      const yValue =
        scaledYRange.maxY - yRatio * (scaledYRange.maxY - scaledYRange.minY);
      const nearestPoints = getOrderedSeries(chart, seriesOrderByChart)
        .map((series) => {
          const visiblePoints = series.getVisiblePoints(
            state.xMin,
            state.xMax,
            layout.plot.width,
          );
          const index = getNearestPointIndex(visiblePoints.x, xValue);
          if (index < 0) return null;
          const pointX = visiblePoints.x[index];
          const pointY = visiblePoints.y[index];
          const pointXRatio = (pointX - state.xMin) / (state.xMax - state.xMin);
          const pointYRatio =
            (scaledYRange.maxY - pointY) /
            (scaledYRange.maxY - scaledYRange.minY);
          return {
            id: series.id,
            name: series.name,
            color: series.color,
            xValue: pointX,
            yValue: pointY,
            x: layout.plot.x + pointXRatio * layout.plot.width,
            y: layout.plot.y + pointYRatio * layout.plot.height,
          };
        })
        .filter(Boolean)
        .filter(
          (nearestPoint) =>
            nearestPoint.x >= layout.plot.x - 1 &&
            nearestPoint.x <= layout.plot.x + layout.plot.width + 1 &&
            nearestPoint.y >= layout.plot.y - 1 &&
            nearestPoint.y <= layout.plot.y + layout.plot.height + 1,
        );
      const tooltipLeft =
        point.x + TOOLTIP_WIDTH + TOOLTIP_OFFSET >
        layout.rect.x + layout.rect.width
          ? point.x - TOOLTIP_WIDTH - TOOLTIP_OFFSET
          : point.x + TOOLTIP_OFFSET;
      const tooltipTop = Math.max(
        layout.rect.y + PLOT_PADDING.top,
        Math.min(
          point.y + TOOLTIP_OFFSET,
          layout.rect.y + layout.rect.height - 96,
        ),
      );
      const primaryPoint = nearestPoints[0];
      setCrosshair({
        chartId: chart.id,
        title: chart.title,
        x: point.x,
        y: point.y,
        xValue: primaryPoint?.xValue ?? xValue,
        yValue: primaryPoint?.yValue ?? yValue,
        points: nearestPoints,
        tooltipX: Math.max(layout.rect.x + 6, tooltipLeft),
        tooltipY: tooltipTop,
      });
    },
    [
      chart,
      getLayout,
      getLocalPoint,
      initialVisiblePoints,
      seriesOrderByChart,
      viewStateRef,
      yCenterOffsetRef,
      yScaleRef,
    ],
  );

  const handlePointerDown = useCallback(
    (event) => {
      const point = getLocalPoint(event);
      const layout = getLayout();
      if (!point || !layout) return;
      const inPlot =
        point.x >= layout.plot.x &&
        point.x <= layout.plot.x + layout.plot.width &&
        point.y >= layout.plot.y &&
        point.y <= layout.plot.y + layout.plot.height;

      if (chartActiveDrawingTool && DRAWING_TOOLS.has(chartActiveDrawingTool)) {
        if (!inPlot || event.button !== 0) return;
        event.preventDefault();
        const dataPoint = screenPointToDataPoint({
          point,
          chart,
          plot: layout.plot,
          initialVisiblePoints,
          viewStateRef,
          yScaleRef,
          yCenterOffsetRef,
        });
        if (
          chartActiveDrawingTool === "hline" ||
          chartActiveDrawingTool === "vline" ||
          chartActiveDrawingTool === "pin"
        ) {
          commitDrawing({
            chartId: chart.id,
            type: chartActiveDrawingTool,
            start: dataPoint,
            end: dataPoint,
          });
          return;
        }
        if (!drawingSessionRef.current.startPoint) {
          startDraftDrawing({
            chartId: chart.id,
            type: "trendline",
            start: dataPoint,
            end: dataPoint,
          });
          return;
        }
        commitDrawing({
          chartId: chart.id,
          type: "trendline",
          start: drawingSessionRef.current.startPoint,
          end: dataPoint,
        });
        return;
      }

      if (inPlot && Array.isArray(chartDrawings) && chartDrawings.length > 0) {
        const hitDrawings = getDrawingsForChart(chartDrawings, chart.id);
        for (let i = hitDrawings.length - 1; i >= 0; i -= 1) {
          const hit = hitTestDrawing({
            point,
            drawing: hitDrawings[i],
            layout,
            projectPoint: (dataPoint, targetLayout) =>
              projectDataPointToScreenPoint({
                point: dataPoint,
                layout: targetLayout,
                initialVisiblePoints,
                viewStateRef,
                yScaleRef,
                yCenterOffsetRef,
              }),
          });
          if (hit) {
            event.preventDefault();
            onSelectedDrawingIdChange?.(hit.drawing.id);
            if (
              hit.endpoint ||
              hit.drawing.type === "hline" ||
              hit.drawing.type === "vline" ||
              hit.drawing.type === "pin"
            ) {
              startEditDrawing({
                drawingId: hit.drawing.id,
                endpoint: hit.endpoint || "move",
              });
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }
            return;
          }
        }
        onSelectedDrawingIdChange?.(null);
      }

      if (rectangleZoomActive) {
        if (!inPlot || event.button !== 0) return;
        event.preventDefault();
        const start = clampPointToPlot(point, layout.plot);
        rectangleZoomDragRef.current = { start, end: start };
        setRectangleZoomRect({ start, end: start });
        event.currentTarget.setPointerCapture?.(event.pointerId);
        return;
      }
      const inYAxis =
        point.x >= layout.plot.x + layout.plot.width &&
        point.x <= layout.rect.x + layout.rect.width &&
        point.y >= layout.plot.y &&
        point.y <= layout.plot.y + layout.plot.height;
      if (inYAxis) {
        event.preventDefault();
        dragRef.current = {
          type: "y-scale",
          startY: point.y,
          startScale: yScaleRef.current.get(chart.id) ?? 1,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        return;
      }

      const inXAxis =
        point.x >= layout.plot.x &&
        point.x <= layout.plot.x + layout.plot.width &&
        point.y >= layout.plot.y + layout.plot.height &&
        point.y <= layout.rect.y + layout.rect.height;
      if (inXAxis) {
        event.preventDefault();
        const state =
          viewStateRef.current.get(chart.id) ||
          getInitialView(chart, initialVisiblePoints);
        dragRef.current = {
          type: "x-scale",
          startX: point.x,
          startMin: state.xMin,
          startMax: state.xMax,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        return;
      }

      if (!inPlot) return;
      const state =
        viewStateRef.current.get(chart.id) ||
        getInitialView(chart, initialVisiblePoints);
      const yRange = getYRange(
        chart,
        state.xMin,
        state.xMax,
        layout.plot.width,
      );
      const scaledYRange = applyYScale(
        yRange,
        yScaleRef.current.get(chart.id) ?? 1,
        yCenterOffsetRef.current.get(chart.id) ?? 0,
      );
      dragRef.current = {
        type: "x-pan",
        startX: point.x,
        startY: point.y,
        startMin: state.xMin,
        startMax: state.xMax,
        startYOffset: yCenterOffsetRef.current.get(chart.id) ?? 0,
        canPanY: yManualScaleRef.current.has(chart.id),
        yValueSpan: scaledYRange.maxY - scaledYRange.minY,
        width: layout.plot.width,
        height: layout.plot.height,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [
      chart,
      getLayout,
      getLocalPoint,
      initialVisiblePoints,
      chartActiveDrawingTool,
      chartDrawings,
      commitDrawing,
      onSelectedDrawingIdChange,
      rectangleZoomActive,
      viewStateRef,
      yCenterOffsetRef,
      yManualScaleRef,
      yScaleRef,
    ],
  );

  const handlePointerMove = useCallback(
    (event) => {
      if (showTooltips) updateCrosshair(event);
      const drawingPoint = getLocalPoint(event);
      const drawingLayout = getLayout();
      if (drawingPoint && drawingLayout) {
        if (drawingEditRef.current) {
          const dataPoint = screenPointToDataPoint({
            point: clampPointToPlot(drawingPoint, drawingLayout.plot),
            chart,
            plot: drawingLayout.plot,
            initialVisiblePoints,
            viewStateRef,
            yScaleRef,
            yCenterOffsetRef,
          });
          const edit = drawingEditRef.current;
          const nextDrawings = updateDrawingById(chartDrawings, edit.id, (drawing) => {
            if (drawing.type === "hline") {
              const deltaX = (drawing.end?.x ?? drawing.start.x) - drawing.start.x;
              return {
                ...drawing,
                start: { ...drawing.start, x: dataPoint.x, y: dataPoint.y },
                end: {
                  ...drawing.end,
                  x: dataPoint.x + deltaX,
                  y: dataPoint.y,
                },
              };
            }
            if (drawing.type === "vline") {
              return { ...drawing, start: { ...drawing.start, x: dataPoint.x }, end: { ...drawing.end, x: dataPoint.x } };
            }
            if (drawing.type === "pin") {
              return { ...drawing, start: dataPoint, end: dataPoint };
            }
            if (edit.endpoint === "start" || edit.endpoint === "end") {
              return { ...drawing, [edit.endpoint]: dataPoint };
            }
            return drawing;
          });
          onDrawingsChange?.(nextDrawings);
          return;
        }

        if (chartActiveDrawingTool && DRAWING_TOOLS.has(chartActiveDrawingTool)) {
          if (
            drawingPoint.x < drawingLayout.plot.x ||
            drawingPoint.x > drawingLayout.plot.x + drawingLayout.plot.width ||
            drawingPoint.y < drawingLayout.plot.y ||
            drawingPoint.y > drawingLayout.plot.y + drawingLayout.plot.height
          ) {
            return;
          }
          const dataPoint = screenPointToDataPoint({
            point: drawingPoint,
            chart,
            plot: drawingLayout.plot,
            initialVisiblePoints,
            viewStateRef,
            yScaleRef,
            yCenterOffsetRef,
          });
          const startPoint =
            chartActiveDrawingTool === "trendline"
              ? drawingSessionRef.current.startPoint
              : dataPoint;
          if (startPoint || chartActiveDrawingTool !== "trendline") {
            updateDraftDrawing({
              chartId: chart.id,
              type: chartActiveDrawingTool,
              start: startPoint || dataPoint,
              end: dataPoint,
            });
          }
          return;
        }
      }

      if (rectangleZoomDragRef.current) {
        const point = getLocalPoint(event);
        const layout = getLayout();
        if (!point || !layout) return;
        const end = clampPointToPlot(point, layout.plot);
        rectangleZoomDragRef.current = {
          ...rectangleZoomDragRef.current,
          end,
        };
        setRectangleZoomRect({
          start: rectangleZoomDragRef.current.start,
          end,
        });
        return;
      }
      const drag = dragRef.current;
      if (!drag) return;
      const point = getLocalPoint(event);
      if (!point) return;
      if (drag.type === "y-scale") {
        yScaleRef.current.set(
          chart.id,
          Math.min(
            Y_SCALE_MAX,
            Math.max(
              Y_SCALE_MIN,
              drag.startScale * Math.exp((point.y - drag.startY) * 0.01),
            ),
          ),
        );
        yManualScaleRef.current.add(chart.id);
        requestRender();
        return;
      }
      if (drag.type === "x-scale") {
        const startSpan = drag.startMax - drag.startMin;
        const nextSpan = Math.min(
          X_SCALE_MAX_SPAN,
          Math.max(
            X_SCALE_MIN_SPAN,
            startSpan * Math.exp((drag.startX - point.x) * 0.01),
          ),
        );
        viewStateRef.current.set(chart.id, {
          xMin: drag.startMax - nextSpan,
          xMax: drag.startMax,
        });
        requestRender();
        return;
      }
      const range = drag.startMax - drag.startMin;
      const delta = ((point.x - drag.startX) / drag.width) * range;
      viewStateRef.current.set(chart.id, {
        xMin: drag.startMin - delta,
        xMax: drag.startMax - delta,
      });
      if (drag.canPanY) {
        const yDelta =
          ((point.y - drag.startY) / drag.height) * drag.yValueSpan;
        yCenterOffsetRef.current.set(chart.id, drag.startYOffset + yDelta);
      }
      requestRender();
    },
    [
      chart.id,
      chart,
      chartActiveDrawingTool,
      chartDrawings,
      getLayout,
      getLocalPoint,
      initialVisiblePoints,
      onDrawingsChange,
      requestRender,
      showTooltips,
      updateCrosshair,
      viewStateRef,
      yCenterOffsetRef,
      yManualScaleRef,
      yScaleRef,
    ],
  );

  const handlePointerUp = useCallback(
    (event) => {
      if (drawingEditRef.current) {
        finishEditDrawing();
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        return;
      }
      if (rectangleZoomDragRef.current) {
        const layout = getLayout();
        const { start, end } = rectangleZoomDragRef.current;
        rectangleZoomDragRef.current = null;
        setRectangleZoomRect(null);
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        if (layout) {
          const applied = applyRectangleZoom({
            chart,
            plot: layout.plot,
            start,
            end,
            initialVisiblePoints,
            viewStateRef,
            yScaleRef,
            yCenterOffsetRef,
            yManualScaleRef,
          });
          if (applied) {
            setRectangleZoomActive(false);
            requestRender();
          }
        }
        return;
      }
      dragRef.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    },
    [
      chart,
      getLayout,
      initialVisiblePoints,
      requestRender,
      viewStateRef,
      yCenterOffsetRef,
      yManualScaleRef,
      yScaleRef,
    ],
  );

  const handleWheel = useCallback(
    (event) => {
      const point = getLocalPoint(event);
      const layout = getLayout();
      if (!point || !layout) return;
      if (
        point.x < layout.plot.x ||
        point.x > layout.plot.x + layout.plot.width ||
        point.y < layout.plot.y ||
        point.y > layout.plot.y + layout.plot.height
      ) {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) {
        const currentScale = yScaleRef.current.get(chart.id) ?? 1;
        yScaleRef.current.set(
          chart.id,
          Math.min(
            Y_SCALE_MAX,
            Math.max(
              Y_SCALE_MIN,
              currentScale * Math.exp(event.deltaY * 0.01),
            ),
          ),
        );
        yManualScaleRef.current.add(chart.id);
        requestRender();
        return;
      }
      const state =
        viewStateRef.current.get(chart.id) ||
        getInitialView(chart, initialVisiblePoints);
      const ratio = (point.x - layout.plot.x) / layout.plot.width;
      const anchor = state.xMin + ratio * (state.xMax - state.xMin);
      const zoom = Math.exp(event.deltaY * 0.0015);
      const nextMin = anchor - (anchor - state.xMin) * zoom;
      const nextMax = anchor + (state.xMax - anchor) * zoom;
      if (nextMax - nextMin < X_SCALE_MIN_SPAN) return;
      viewStateRef.current.set(chart.id, {
        xMin: nextMin,
        xMax: nextMax,
      });
      requestRender();
    },
    [
      chart,
      getLayout,
      getLocalPoint,
      initialVisiblePoints,
      requestRender,
      viewStateRef,
      yScaleRef,
      yManualScaleRef,
    ],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const handleContextMenu = useCallback(
    (event) => {
      const point = getLocalPoint(event);
      const layout = getLayout();
      if (!point || !layout) return;
      event.preventDefault();
      onChartContextMenu?.({
        chart,
        event,
        point: getChartContextMenuPoint({
          point,
          chart,
          layout,
          initialVisiblePoints,
          viewStateRef,
          yScaleRef,
          yCenterOffsetRef,
        }),
      });
    },
    [
      chart,
      getLayout,
      getLocalPoint,
      initialVisiblePoints,
      onChartContextMenu,
      viewStateRef,
      yCenterOffsetRef,
      yScaleRef,
    ],
  );

  useEffect(() => {
    const handleKeyDown = (event) => {
      const target = event.target;
      const editable =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (editable) return;
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        onReset?.(chart.id);
        setRectangleZoomActive(false);
        setRectangleZoomRect(null);
        requestRender();
        return;
      }
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        toggleRectangleZoom();
        return;
      }
      if (!disableDrawings && event.key.toLowerCase() === "m") {
        event.preventDefault();
        onMovingAverageToggle?.(chart.id);
        requestRender();
        return;
      }
      if (
        !disableDrawings &&
        ["t", "h", "v", "p"].includes(event.key.toLowerCase())
      ) {
        event.preventDefault();
        const toolByKey = { t: "trendline", h: "hline", v: "vline", p: "pin" };
        toggleDrawingTool(toolByKey[event.key.toLowerCase()]);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (disableDrawings || !chartSelectedDrawingId) return;
        event.preventDefault();
        deleteSelectedDrawing();
        return;
      }
      if (event.key === "Escape" || event.key.toLowerCase() === "f") {
        event.preventDefault();
        if (chartActiveDrawingTool || draftDrawing || drawingEditRef.current) {
          cancelDrawing();
          return;
        }
        if (rectangleZoomActive) {
          setRectangleZoomActive(false);
          setRectangleZoomRect(null);
          rectangleZoomDragRef.current = null;
          return;
        }
        closeWithTransition();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    chart.id,
    closeWithTransition,
    chartActiveDrawingTool,
    chartSelectedDrawingId,
    cancelDrawing,
    deleteSelectedDrawing,
    disableDrawings,
    draftDrawing,
    onReset,
    onMovingAverageToggle,
    rectangleZoomActive,
    requestRender,
    toggleRectangleZoom,
    toggleDrawingTool,
  ]);

  const fullscreenLayout = getLayout();
  const selectedDrawingLayout = getSelectedDrawingLayout(
    fullscreenLayout ? [fullscreenLayout] : [],
    chartDrawings,
    chartSelectedDrawingId,
  );

  return (
    <div
      className={`fixed inset-0 z-50 bg-background/95 backdrop-blur transition-opacity duration-150 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        ref={containerRef}
        className={`relative h-full overflow-hidden transition-transform duration-150 ${
          visible ? "scale-100" : "scale-[0.985]"
        }`}
        style={{
          cursor:
            rectangleZoomActive || chartActiveDrawingTool ? "crosshair" : undefined,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setCrosshair(null)}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={handleContextMenu}
      >
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute left-0 top-0 z-10 block"
          style={{ width: "100%", height: "100%" }}
        />
        <ChartCell
          chart={chart}
          axisOverlay={axisOverlay}
          focused
          height="100%"
          isFullscreen
          backgroundColor={backgroundColor}
          onFocus={() => {}}
          onFullscreenToggle={closeWithTransition}
          onReset={onReset}
          onJumpLatest={onJumpLatest}
          onRectangleZoomToggle={toggleRectangleZoom}
          rectangleZoomActive={rectangleZoomActive}
          movingAverage={disableDrawings ? null : movingAverageByChart?.[chart.id]}
          onMovingAverageToggle={onMovingAverageToggle}
          activeDrawingTool={chartActiveDrawingTool}
          onDrawingToolToggle={toggleDrawingTool}
          hasDrawings={getDrawingsForChart(chartDrawings, chart.id).length > 0}
          onClearDrawingsRequest={onClearDrawingsRequest}
          disableDrawings={disableDrawings}
          gridLines={gridLines}
          showToolbar={showToolbar}
          showLatestValueLine={showLatestValueLine}
          formatXTick={formatXTick}
          formatYValue={formatYValue}
          setRef={(node) => {
            chartRef.current = node;
          }}
        />
        <DrawingOverlay
          layouts={fullscreenLayout ? [fullscreenLayout] : []}
          drawings={chartDrawings}
          draftDrawing={disableDrawings ? null : draftDrawing}
          selectedDrawingId={chartSelectedDrawingId}
          projectPoint={(dataPoint, targetLayout) =>
            projectDataPointToScreenPoint({
              point: dataPoint,
              layout: targetLayout,
              initialVisiblePoints,
              viewStateRef,
              yScaleRef,
              yCenterOffsetRef,
            })
          }
          height="100%"
        />
        <TopMarkersOverlay
          layouts={fullscreenLayout ? [fullscreenLayout] : []}
          markers={topMarkers}
          viewStateRef={viewStateRef}
          initialVisiblePoints={initialVisiblePoints}
          onMarkerClick={(marker) => {
            closeWithTransition();
            requestAnimationFrame(() => {
              onTopMarkerClick?.(marker);
            });
          }}
          height="100%"
        />
        {selectedDrawingLayout ? (
          <DrawingOptionsToolbar
            drawing={selectedDrawingLayout.drawing}
            style={getDrawingOptionsToolbarStyle(selectedDrawingLayout.layout)}
            onToggleExtend={toggleSelectedDrawingExtend}
            onColorChange={updateSelectedDrawingColor}
            onTextChange={updateSelectedDrawingText}
          />
        ) : null}
        {!disableDrawings && fullscreenLayout && movingAverageByChart?.[chart.id]?.enabled ? (
          <MovingAverageOptionsToolbar
            movingAverage={movingAverageByChart[chart.id]}
            style={getMovingAverageOptionsToolbarStyle(fullscreenLayout)}
            onChange={(nextMovingAverage) =>
              onMovingAverageChange?.(chart.id, nextMovingAverage)
            }
          />
        ) : null}
        <CrosshairOverlay
          crosshair={showTooltips ? crosshair : null}
          height="100%"
          xAxisLabel={xAxisLabel}
          formatXValue={formatXValue}
          formatYValue={formatYValue}
        />
        <RectangleZoomOverlay rect={rectangleZoomRect} />
      </div>
    </div>
  );
}

export const ChartGrid = forwardRef(function ChartGrid({
  charts,
  columns = 2,
  className = "",
  dataRevision = 0,
  initialVisiblePoints = null,
  backgroundColor = DEFAULT_CHART_BACKGROUND,
  antialiasLines = false,
  gridLines = false,
  showToolbar = true,
  showLatestValueLine = true,
  showTooltips = true,
  followLatest = false,
  followVisibleLatest = true,
  jumpToLatestRevision = 0,
  drawings = EMPTY_ARRAY,
  onDrawingsChange,
  activeDrawingTool = null,
  onActiveDrawingToolChange,
  selectedDrawingId = null,
  onSelectedDrawingIdChange,
  createDrawingId,
  onClearDrawingsRequest,
  onChartContextMenu,
  movingAverageByChart = EMPTY_OBJECT,
  onMovingAverageToggle,
  onMovingAverageChange,
  seriesOrderByChart = EMPTY_OBJECT,
  topMarkers = EMPTY_ARRAY,
  onTopMarkerClick,
  xAxisLabel = "STEP",
  disableDrawings = false,
  formatXTick = formatCompactNumber,
  formatXValue = formatNumber,
  formatYValue = formatNumber,
}, ref) {
  const containerRef = useRef(null);
  const gridRef = useRef(null);
  const canvasRef = useRef(null);
  const glRef = useRef(null);
  const programRef = useRef(null);
  const antialiasProgramRef = useRef(null);
  const seriesBufferCacheRef = useRef(createSeriesBufferCache());
  const antialiasSeriesBufferCacheRef = useRef(createSeriesBufferCache());
  const movingAverageCacheRef = useRef(new Map());
  const chartRefs = useRef(new Map());
  const viewStateRef = useRef(new Map());
  const yScaleRef = useRef(new Map());
  const yCenterOffsetRef = useRef(new Map());
  const yManualScaleRef = useRef(new Set());
  const latestXRef = useRef(new Map());
  const latestJumpRevisionRef = useRef(jumpToLatestRevision);
  const dragRef = useRef(null);
  const rectangleZoomDragRef = useRef(null);
  const scrollRafRef = useRef(null);
  const [revision, setRevision] = useState(0);
  const [crosshair, setCrosshair] = useState(null);
  const [axisOverlays, setAxisOverlays] = useState({});
  const [focusedChartId, setFocusedChartId] = useState(null);
  const [fullscreenChartId, setFullscreenChartId] = useState(null);
  const [rectangleZoomChartId, setRectangleZoomChartId] = useState(null);
  const [rectangleZoomRect, setRectangleZoomRect] = useState(null);
  const chartDrawings = disableDrawings ? EMPTY_ARRAY : drawings;
  const chartActiveDrawingTool = disableDrawings ? null : activeDrawingTool;
  const chartSelectedDrawingId = disableDrawings ? null : selectedDrawingId;

  useEffect(() => {
    if (!showTooltips) setCrosshair(null);
  }, [showTooltips]);

  const requestRender = useCallback(() => {
    setRevision((value) => value + 1);
  }, []);

  useImperativeHandle(ref, () => ({
    scrollToTop(options = {}) {
      containerRef.current?.scrollTo({ ...options, top: 0 });
    },
  }), []);

  const {
    draftDrawing,
    drawingSessionRef,
    drawingEditRef,
    clearDraft,
    cancelDrawing,
    toggleDrawingTool,
    commitDrawing,
    startDraftDrawing,
    updateDraftDrawing,
    startEditDrawing,
    finishEditDrawing,
    deleteSelectedDrawing,
  } = useDrawingInteractions({
    drawings: chartDrawings,
    onDrawingsChange: disableDrawings ? undefined : onDrawingsChange,
    activeDrawingTool: chartActiveDrawingTool,
    onActiveDrawingToolChange,
    selectedDrawingId: chartSelectedDrawingId,
    onSelectedDrawingIdChange,
    createDrawingId,
    focusedChartId,
    requireFocusedChart: true,
    onModeChange: () => {
      setRectangleZoomChartId(null);
      setRectangleZoomRect(null);
      rectangleZoomDragRef.current = null;
    },
  });

  const closeFullscreen = useCallback(() => {
    setFullscreenChartId(null);
    setCrosshair(null);
    requestRender();
  }, [requestRender]);

  const openFullscreen = useCallback(
    (chartId) => {
      setFocusedChartId(chartId);
      setFullscreenChartId(chartId);
      setCrosshair(null);
      setRectangleZoomChartId(null);
      setRectangleZoomRect(null);
      rectangleZoomDragRef.current = null;
      clearDraft();
      requestRender();
    },
    [clearDraft, requestRender],
  );

  const toggleRectangleZoom = useCallback((chartId) => {
    setFocusedChartId(chartId);
    setRectangleZoomRect(null);
    rectangleZoomDragRef.current = null;
    clearDraft();
    onActiveDrawingToolChange?.(null);
    setRectangleZoomChartId((current) => (current === chartId ? null : chartId));
  }, [clearDraft, onActiveDrawingToolChange]);

  const toggleMovingAverage = useCallback(
    (chartId) => {
      onMovingAverageToggle?.(chartId);
      setFocusedChartId(chartId);
      setRectangleZoomChartId(null);
      clearDraft();
      onActiveDrawingToolChange?.(null);
      requestRender();
    },
    [
      clearDraft,
      onActiveDrawingToolChange,
      onMovingAverageToggle,
      requestRender,
    ],
  );

  const toggleSelectedDrawingExtend = useCallback(() => {
    if (disableDrawings || !chartSelectedDrawingId || !onDrawingsChange) return;
    onDrawingsChange(
      updateDrawingById(chartDrawings, chartSelectedDrawingId, (drawing) => ({
        ...drawing,
        style: {
          ...drawing.style,
          extendRight: drawing.style?.extendRight === false,
        },
      })),
    );
  }, [chartDrawings, chartSelectedDrawingId, disableDrawings, onDrawingsChange]);

  const updateSelectedDrawingColor = useCallback(
    (color) => {
      if (disableDrawings || !chartSelectedDrawingId || !onDrawingsChange) return;
      onDrawingsChange(
        updateDrawingById(chartDrawings, chartSelectedDrawingId, (drawing) => ({
          ...drawing,
          style: {
            ...drawing.style,
            color,
          },
        })),
      );
    },
    [chartDrawings, chartSelectedDrawingId, disableDrawings, onDrawingsChange],
  );

  const updateSelectedDrawingText = useCallback(
    (text) => {
      if (disableDrawings || !chartSelectedDrawingId || !onDrawingsChange) return;
      onDrawingsChange(
        updateDrawingById(chartDrawings, chartSelectedDrawingId, (drawing) => ({
          ...drawing,
          style: {
            ...drawing.style,
            text,
          },
        })),
      );
    },
    [chartDrawings, chartSelectedDrawingId, disableDrawings, onDrawingsChange],
  );

  const { getAppendAnimatedPoint } = useAppendAnimations({
    charts,
    dataRevision,
    requestRender,
  });

  useEffect(() => {
    if (!focusedChartId) return;
    if (charts.some((chart) => chart.id === focusedChartId)) return;
    setFocusedChartId(null);
  }, [charts, focusedChartId]);

  useEffect(() => {
    if (!fullscreenChartId) return;
    if (charts.some((chart) => chart.id === fullscreenChartId)) return;
    setFullscreenChartId(null);
  }, [charts, fullscreenChartId]);

  useEffect(() => {
    const gl = glRef.current;
    if (!gl) return;
    const activeSeriesIds = new Set(
      charts.flatMap((chart) => chart.series.map((series) => series.id)),
    );
    charts.forEach((chart) => {
      const movingAverage = normalizeMovingAverage(movingAverageByChart?.[chart.id]);
      if (!movingAverage) return;
      chart.series.forEach((series) => {
        activeSeriesIds.add(getMovingAverageCacheKey(series, movingAverage));
      });
    });
    seriesBufferCacheRef.current.forEach((entry, seriesId) => {
      if (activeSeriesIds.has(seriesId)) return;
      if (entry.buffer) gl.deleteBuffer(entry.buffer);
      seriesBufferCacheRef.current.delete(seriesId);
    });
    antialiasSeriesBufferCacheRef.current.forEach((entry, seriesId) => {
      if (activeSeriesIds.has(seriesId)) return;
      if (entry.buffer) gl.deleteBuffer(entry.buffer);
      antialiasSeriesBufferCacheRef.current.delete(seriesId);
    });
    movingAverageCacheRef.current.forEach((entry, seriesId) => {
      if (activeSeriesIds.has(seriesId)) return;
      movingAverageCacheRef.current.delete(seriesId);
    });
  }, [charts, movingAverageByChart]);

  useEffect(() => {
    charts.forEach((chart) => {
      if (!viewStateRef.current.has(chart.id)) {
        viewStateRef.current.set(
          chart.id,
          getInitialView(chart, initialVisiblePoints),
        );
      }
      if (!yScaleRef.current.has(chart.id)) {
        yScaleRef.current.set(chart.id, 1);
      }
      if (!yCenterOffsetRef.current.has(chart.id)) {
        yCenterOffsetRef.current.set(chart.id, 0);
      }
      if (!latestXRef.current.has(chart.id)) {
        latestXRef.current.set(chart.id, getChartXBounds(chart).maxX);
      }
    });
  }, [charts, initialVisiblePoints]);

  useEffect(() => {
    charts.forEach((chart) => {
      const previousMax = latestXRef.current.get(chart.id);
      const { maxX } = getChartXBounds(chart);
      if (!Number.isFinite(maxX)) return;
      if (!Number.isFinite(previousMax)) {
        latestXRef.current.set(chart.id, maxX);
        return;
      }
      if (maxX !== previousMax) {
        const state =
          viewStateRef.current.get(chart.id) ||
          getInitialView(chart, initialVisiblePoints);
        const span = state.xMax - state.xMin;
        const rightEdgeFollowMin =
          state.xMax - span * FOLLOW_VISIBLE_RIGHT_EDGE_RATIO;
        const previousMaxVisible =
          previousMax >= state.xMin && previousMax <= state.xMax;
        const previousMaxNearRightEdge = previousMax >= rightEdgeFollowMin;

        if (
          followLatest ||
          (followVisibleLatest &&
            previousMaxVisible &&
            previousMaxNearRightEdge)
        ) {
          const delta = maxX - previousMax;
          const nextState = {
            xMin: state.xMin + delta,
            xMax: state.xMax + delta,
          };
          viewStateRef.current.set(chart.id, nextState);

          const latestYBounds = getLatestYBounds(chart);
          if (
            Number.isFinite(latestYBounds.minY) &&
            Number.isFinite(latestYBounds.maxY)
          ) {
            const baseYRange = getYRange(
              chart,
              nextState.xMin,
              nextState.xMax,
              getPlotWidth(chartRefs.current.get(chart.id)),
            );
            const scale = yScaleRef.current.get(chart.id) ?? 1;
            const currentOffset = yCenterOffsetRef.current.get(chart.id) ?? 0;
            const scaledYRange = applyYScale(baseYRange, scale, currentOffset);
            const pad = (scaledYRange.maxY - scaledYRange.minY) * 0.08;
            let nextOffset = currentOffset;

            if (latestYBounds.maxY > scaledYRange.maxY - pad) {
              nextOffset += latestYBounds.maxY - (scaledYRange.maxY - pad);
            } else if (latestYBounds.minY < scaledYRange.minY + pad) {
              nextOffset += latestYBounds.minY - (scaledYRange.minY + pad);
            }

            if (nextOffset !== currentOffset) {
              yCenterOffsetRef.current.set(chart.id, nextOffset);
            }
          }
        }
      }
      latestXRef.current.set(chart.id, maxX);
    });
  }, [
    charts,
    dataRevision,
    followLatest,
    followVisibleLatest,
    initialVisiblePoints,
  ]);

  useEffect(() => {
    if (latestJumpRevisionRef.current === jumpToLatestRevision) return;
    latestJumpRevisionRef.current = jumpToLatestRevision;

    charts.forEach((chart) => {
      const { maxX } = getChartXBounds(chart);
      if (!Number.isFinite(maxX)) return;
      const state =
        viewStateRef.current.get(chart.id) ||
        getInitialView(chart, initialVisiblePoints);
      const span = Math.max(10, state.xMax - state.xMin);
      const rightPadding = span * JUMP_LATEST_RIGHT_PADDING_RATIO;
      const nextMax = maxX + rightPadding;
      viewStateRef.current.set(chart.id, {
        xMin: nextMax - span,
        xMax: nextMax,
      });
    });
    requestRender();
  }, [charts, initialVisiblePoints, jumpToLatestRevision, requestRender]);

  const getChartLayout = useCallback(() => {
    const container = containerRef.current;
    const grid = gridRef.current;
    if (!container) return [];
    return charts
      .map((chart) => {
        const node = chartRefs.current.get(chart.id);
        if (!node) return null;
        const rect = {
          x: node.offsetLeft,
          y: node.offsetTop,
          width: node.offsetWidth,
          height: node.offsetHeight,
        };
        let parent = node.offsetParent;
        while (parent && parent !== container && parent !== grid) {
          rect.x += parent.offsetLeft;
          rect.y += parent.offsetTop;
          parent = parent.offsetParent;
        }
        const plot = {
          x: rect.x + PLOT_PADDING.left,
          y: rect.y + PLOT_PADDING.top,
          width: Math.max(
            1,
            rect.width - PLOT_PADDING.left - PLOT_PADDING.right,
          ),
          height: Math.max(
            1,
            rect.height - PLOT_PADDING.top - PLOT_PADDING.bottom,
          ),
        };
        const visibleTop = container.scrollTop;
        const visibleBottom = visibleTop + container.clientHeight;
        const visible =
          rect.y + rect.height >= visibleTop && rect.y <= visibleBottom;
        return { chart, rect, plot, visible };
      })
      .filter(Boolean);
  }, [charts]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", {
      antialias: true,
      alpha: true,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) return;
    glRef.current = gl;
    programRef.current = createProgram(gl);
    antialiasProgramRef.current = createAntialiasProgram(gl);
    requestRender();

    return () => {
      deleteSeriesBuffers(gl, seriesBufferCacheRef.current);
      deleteSeriesBuffers(gl, antialiasSeriesBufferCacheRef.current);
      glRef.current = null;
      programRef.current = null;
      antialiasProgramRef.current = null;
    };
  }, [requestRender]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(requestRender);
    observer.observe(container);
    return () => observer.disconnect();
  }, [requestRender]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const handleScroll = () => {
      setCrosshair(null);
      if (scrollRafRef.current != null) return;
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        requestRender();
      });
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [requestRender]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const gl = glRef.current;
    const program = programRef.current;
    const antialiasProgram = antialiasProgramRef.current;
    const seriesBufferCache = seriesBufferCacheRef.current;
    const antialiasSeriesBufferCache =
      antialiasSeriesBufferCacheRef.current;
    if (!container || !canvas || !gl || !program) return;

    if (fullscreenChartId) {
      canvas.style.transform = "";
      gl.viewport(0, 0, canvas.width || 1, canvas.height || 1);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      setAxisOverlays({});
      return;
    }

    const scrollLeft = container.scrollLeft;
    const scrollTop = container.scrollTop;
    canvas.style.transform = `translate(${scrollLeft}px, ${scrollTop}px)`;

    const nextAxisOverlays = drawChartLayouts({
      canvas,
      width: container.clientWidth,
      height: container.clientHeight,
      gl,
      program,
      antialiasProgram,
      antialiasLines,
      layouts: getChartLayout().map((layout) =>
        toViewportLayout(layout, scrollLeft, scrollTop),
      ),
      viewStateRef,
      yScaleRef,
      yCenterOffsetRef,
      seriesBufferCache,
      antialiasSeriesBufferCache,
      initialVisiblePoints,
      getAppendAnimatedPoint,
      movingAverageByChart,
      movingAverageCache: movingAverageCacheRef.current,
      seriesOrderByChart,
    });
    setAxisOverlays(nextAxisOverlays);
  }, [
    charts,
    antialiasLines,
    dataRevision,
    fullscreenChartId,
    getAppendAnimatedPoint,
    getChartLayout,
    initialVisiblePoints,
    movingAverageByChart,
    seriesOrderByChart,
    revision,
  ]);

  const findLayoutAt = useCallback(
    (clientX, clientY) =>
      getChartLayout().find(
        ({ plot, visible }) =>
          visible &&
          clientX >= plot.x &&
          clientX <= plot.x + plot.width &&
          clientY >= plot.y &&
          clientY <= plot.y + plot.height,
      ),
    [getChartLayout],
  );

  const findYAxisLayoutAt = useCallback(
    (clientX, clientY) =>
      getChartLayout().find(
        ({ rect, plot, visible }) =>
          visible &&
          clientX >= plot.x + plot.width &&
          clientX <= rect.x + rect.width &&
          clientY >= plot.y &&
          clientY <= plot.y + plot.height,
      ),
    [getChartLayout],
  );

  const findXAxisLayoutAt = useCallback(
    (clientX, clientY) =>
      getChartLayout().find(
        ({ rect, plot, visible }) =>
          visible &&
          clientX >= plot.x &&
          clientX <= plot.x + plot.width &&
          clientY >= plot.y + plot.height &&
          clientY <= rect.y + rect.height,
      ),
    [getChartLayout],
  );

  const getLocalPoint = useCallback((event) => {
    const container = containerRef.current;
    const rect = container?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top + container.scrollTop,
    };
  }, []);

  const updateCrosshair = useCallback(
    (event) => {
      const point = getLocalPoint(event);
      if (!point) return;
      const layout = findLayoutAt(point.x, point.y);
      if (!layout) {
        setCrosshair(null);
        return;
      }
      const state =
        viewStateRef.current.get(layout.chart.id) ||
        getInitialView(layout.chart, initialVisiblePoints);
      const xRatio = (point.x - layout.plot.x) / layout.plot.width;
      const xValue = state.xMin + xRatio * (state.xMax - state.xMin);
      const yRange = getYRange(
        layout.chart,
        state.xMin,
        state.xMax,
        layout.plot.width,
      );
      const scaledYRange = applyYScale(
        yRange,
        yScaleRef.current.get(layout.chart.id) ?? 1,
        yCenterOffsetRef.current.get(layout.chart.id) ?? 0,
      );
      const yRatio = (point.y - layout.plot.y) / layout.plot.height;
      const yValue =
        scaledYRange.maxY - yRatio * (scaledYRange.maxY - scaledYRange.minY);
      const nearestPoints = getOrderedSeries(layout.chart, seriesOrderByChart)
        .map((series) => {
          const visiblePoints = series.getVisiblePoints(
            state.xMin,
            state.xMax,
            layout.plot.width,
          );
          const index = getNearestPointIndex(visiblePoints.x, xValue);
          if (index < 0) return null;
          const pointX = visiblePoints.x[index];
          const pointY = visiblePoints.y[index];
          const pointXRatio = (pointX - state.xMin) / (state.xMax - state.xMin);
          const pointYRatio =
            (scaledYRange.maxY - pointY) /
            (scaledYRange.maxY - scaledYRange.minY);
          return {
            id: series.id,
            name: series.name,
            color: series.color,
            xValue: pointX,
            yValue: pointY,
            x: layout.plot.x + pointXRatio * layout.plot.width,
            y: layout.plot.y + pointYRatio * layout.plot.height,
          };
        })
        .filter(Boolean)
        .filter(
          (nearestPoint) =>
            nearestPoint.x >= layout.plot.x - 1 &&
            nearestPoint.x <= layout.plot.x + layout.plot.width + 1 &&
            nearestPoint.y >= layout.plot.y - 1 &&
            nearestPoint.y <= layout.plot.y + layout.plot.height + 1,
        );
      const tooltipLeft =
        point.x + TOOLTIP_WIDTH + TOOLTIP_OFFSET >
        layout.rect.x + layout.rect.width
          ? point.x - TOOLTIP_WIDTH - TOOLTIP_OFFSET
          : point.x + TOOLTIP_OFFSET;
      const tooltipTop = Math.max(
        layout.rect.y + PLOT_PADDING.top,
        Math.min(
          point.y + TOOLTIP_OFFSET,
          layout.rect.y + layout.rect.height - 96,
        ),
      );
      const primaryPoint = nearestPoints[0];
      setCrosshair({
        chartId: layout.chart.id,
        title: layout.chart.title,
        x: point.x,
        y: point.y,
        xValue: primaryPoint?.xValue ?? xValue,
        yValue: primaryPoint?.yValue ?? yValue,
        points: nearestPoints,
        tooltipX: Math.max(layout.rect.x + 6, tooltipLeft),
        tooltipY: tooltipTop,
        bucketSize: scaledYRange.bucketSize,
        renderedPoints: scaledYRange.renderedPoints,
      });
    },
    [findLayoutAt, getLocalPoint, initialVisiblePoints, seriesOrderByChart],
  );

  const jumpChartToLatest = useCallback(
    (chartId) => {
      const chart = charts.find((candidate) => candidate.id === chartId);
      if (!chart) return;
      const { maxX } = getChartXBounds(chart);
      if (!Number.isFinite(maxX)) return;
      const state =
        viewStateRef.current.get(chart.id) ||
        getInitialView(chart, initialVisiblePoints);
      const span = Math.max(X_SCALE_MIN_SPAN, state.xMax - state.xMin);
      const rightPadding = span * JUMP_LATEST_RIGHT_PADDING_RATIO;
      const nextMax = maxX + rightPadding;
      viewStateRef.current.set(chart.id, {
        xMin: nextMax - span,
        xMax: nextMax,
      });
      yCenterOffsetRef.current.set(chart.id, 0);
      requestRender();
    },
    [charts, initialVisiblePoints, requestRender],
  );

  const resetChartView = useCallback(
    (chartId) => {
      const chart = charts.find((candidate) => candidate.id === chartId);
      if (!chart) return;
      viewStateRef.current.set(chart.id, getInitialView(chart, initialVisiblePoints));
      yScaleRef.current.set(chart.id, 1);
      yCenterOffsetRef.current.set(chart.id, 0);
      yManualScaleRef.current.delete(chart.id);
      if (rectangleZoomChartId === chart.id) {
        setRectangleZoomChartId(null);
        setRectangleZoomRect(null);
        rectangleZoomDragRef.current = null;
      }
      requestRender();
    },
    [charts, initialVisiblePoints, rectangleZoomChartId, requestRender],
  );

  const handleContextMenu = useCallback(
    (event) => {
      if (fullscreenChartId) return;
      const point = getLocalPoint(event);
      if (!point) return;
      const layout = findLayoutAt(point.x, point.y);
      if (!layout) return;
      event.preventDefault();
      setFocusedChartId(layout.chart.id);
      onChartContextMenu?.({
        chart: layout.chart,
        event,
        point: getChartContextMenuPoint({
          point,
          chart: layout.chart,
          layout,
          initialVisiblePoints,
          viewStateRef,
          yScaleRef,
          yCenterOffsetRef,
        }),
      });
    },
    [
      findLayoutAt,
      fullscreenChartId,
      getLocalPoint,
      initialVisiblePoints,
      onChartContextMenu,
    ],
  );

  const handlePointerDown = useCallback(
    (event) => {
      if (fullscreenChartId) return;
      const point = getLocalPoint(event);
      if (!point) return;
      const drawingLayout = findLayoutAt(point.x, point.y);
      if (
        drawingLayout &&
        chartActiveDrawingTool &&
        DRAWING_TOOLS.has(chartActiveDrawingTool)
      ) {
        if (event.button !== 0) return;
        event.preventDefault();
        setFocusedChartId(drawingLayout.chart.id);
        const dataPoint = screenPointToDataPoint({
          point,
          chart: drawingLayout.chart,
          plot: drawingLayout.plot,
          initialVisiblePoints,
          viewStateRef,
          yScaleRef,
          yCenterOffsetRef,
        });
        if (
          chartActiveDrawingTool === "hline" ||
          chartActiveDrawingTool === "vline" ||
          chartActiveDrawingTool === "pin"
        ) {
          commitDrawing({
            chartId: drawingLayout.chart.id,
            type: chartActiveDrawingTool,
            start: dataPoint,
            end: dataPoint,
          });
          return;
        }
        const session = drawingSessionRef.current;
        if (!session.startPoint || session.chartId !== drawingLayout.chart.id) {
          startDraftDrawing({
            chartId: drawingLayout.chart.id,
            type: "trendline",
            start: dataPoint,
            end: dataPoint,
          });
          return;
        }
        commitDrawing({
          chartId: drawingLayout.chart.id,
          type: "trendline",
          start: session.startPoint,
          end: dataPoint,
        });
        return;
      }

      if (drawingLayout && Array.isArray(chartDrawings) && chartDrawings.length > 0) {
        const hitDrawings = getDrawingsForChart(
          chartDrawings,
          drawingLayout.chart.id,
        );
        for (let i = hitDrawings.length - 1; i >= 0; i -= 1) {
          const hit = hitTestDrawing({
            point,
            drawing: hitDrawings[i],
            layout: drawingLayout,
            projectPoint: (dataPoint, targetLayout) =>
              projectDataPointToScreenPoint({
                point: dataPoint,
                layout: targetLayout,
                initialVisiblePoints,
                viewStateRef,
                yScaleRef,
                yCenterOffsetRef,
              }),
          });
          if (hit) {
            event.preventDefault();
            setFocusedChartId(drawingLayout.chart.id);
            onSelectedDrawingIdChange?.(hit.drawing.id);
            if (
              hit.endpoint ||
              hit.drawing.type === "hline" ||
              hit.drawing.type === "vline" ||
              hit.drawing.type === "pin"
            ) {
              startEditDrawing({
                drawingId: hit.drawing.id,
                endpoint: hit.endpoint || "move",
              });
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }
            return;
          }
        }
        onSelectedDrawingIdChange?.(null);
      }

      if (rectangleZoomChartId) {
        const layout = findLayoutAt(point.x, point.y);
        if (
          !layout ||
          layout.chart.id !== rectangleZoomChartId ||
          event.button !== 0
        ) {
          return;
        }
        event.preventDefault();
        const start = clampPointToPlot(point, layout.plot);
        rectangleZoomDragRef.current = {
          chartId: layout.chart.id,
          start,
          end: start,
        };
        setRectangleZoomRect({ start, end: start });
        event.currentTarget.setPointerCapture?.(event.pointerId);
        return;
      }
      const yAxisLayout = findYAxisLayoutAt(point.x, point.y);
      if (yAxisLayout) {
        event.preventDefault();
        dragRef.current = {
          type: "y-scale",
          chartId: yAxisLayout.chart.id,
          startY: point.y,
          startScale: yScaleRef.current.get(yAxisLayout.chart.id) ?? 1,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        return;
      }
      const xAxisLayout = findXAxisLayoutAt(point.x, point.y);
      if (xAxisLayout) {
        event.preventDefault();
        const state =
          viewStateRef.current.get(xAxisLayout.chart.id) ||
          getInitialView(xAxisLayout.chart, initialVisiblePoints);
        dragRef.current = {
          type: "x-scale",
          chartId: xAxisLayout.chart.id,
          startX: point.x,
          startMin: state.xMin,
          startMax: state.xMax,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        return;
      }
      const layout = findLayoutAt(point.x, point.y);
      if (!layout) return;
      const state =
        viewStateRef.current.get(layout.chart.id) ||
        getInitialView(layout.chart, initialVisiblePoints);
      const yRange = getYRange(
        layout.chart,
        state.xMin,
        state.xMax,
        layout.plot.width,
      );
      const scaledYRange = applyYScale(
        yRange,
        yScaleRef.current.get(layout.chart.id) ?? 1,
        yCenterOffsetRef.current.get(layout.chart.id) ?? 0,
      );
      dragRef.current = {
        type: "x-pan",
        chartId: layout.chart.id,
        startX: point.x,
        startY: point.y,
        startMin: state.xMin,
        startMax: state.xMax,
        startYOffset: yCenterOffsetRef.current.get(layout.chart.id) ?? 0,
        canPanY: yManualScaleRef.current.has(layout.chart.id),
        yValueSpan: scaledYRange.maxY - scaledYRange.minY,
        width: layout.plot.width,
        height: layout.plot.height,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [
      findLayoutAt,
      findXAxisLayoutAt,
      findYAxisLayoutAt,
      getLocalPoint,
      initialVisiblePoints,
      fullscreenChartId,
      rectangleZoomChartId,
      chartActiveDrawingTool,
      chartDrawings,
      commitDrawing,
      onSelectedDrawingIdChange,
    ],
  );

  const handlePointerMove = useCallback(
    (event) => {
      if (fullscreenChartId) return;
      if (showTooltips) updateCrosshair(event);
      const drawingPoint = getLocalPoint(event);
      if (drawingPoint) {
        if (drawingEditRef.current) {
          const editLayout = getChartLayout().find((layout) =>
            getDrawingsForChart(chartDrawings, layout.chart.id).some(
              (drawing) => drawing.id === drawingEditRef.current.id,
            ),
          );
          if (editLayout) {
            const dataPoint = screenPointToDataPoint({
              point: clampPointToPlot(drawingPoint, editLayout.plot),
              chart: editLayout.chart,
              plot: editLayout.plot,
              initialVisiblePoints,
              viewStateRef,
              yScaleRef,
              yCenterOffsetRef,
            });
            const edit = drawingEditRef.current;
            const nextDrawings = updateDrawingById(chartDrawings, edit.id, (drawing) => {
              if (drawing.type === "hline") {
                const deltaX = (drawing.end?.x ?? drawing.start.x) - drawing.start.x;
                return {
                  ...drawing,
                  start: { ...drawing.start, x: dataPoint.x, y: dataPoint.y },
                  end: {
                    ...drawing.end,
                    x: dataPoint.x + deltaX,
                    y: dataPoint.y,
                  },
                };
              }
              if (drawing.type === "vline") {
                return { ...drawing, start: { ...drawing.start, x: dataPoint.x }, end: { ...drawing.end, x: dataPoint.x } };
              }
              if (drawing.type === "pin") {
                return { ...drawing, start: dataPoint, end: dataPoint };
              }
              if (edit.endpoint === "start" || edit.endpoint === "end") {
                return { ...drawing, [edit.endpoint]: dataPoint };
              }
              return drawing;
            });
            onDrawingsChange?.(nextDrawings);
          }
          return;
        }

        if (chartActiveDrawingTool && DRAWING_TOOLS.has(chartActiveDrawingTool)) {
          const drawingLayout = findLayoutAt(drawingPoint.x, drawingPoint.y);
          if (!drawingLayout) return;
          const dataPoint = screenPointToDataPoint({
            point: drawingPoint,
            chart: drawingLayout.chart,
            plot: drawingLayout.plot,
            initialVisiblePoints,
            viewStateRef,
            yScaleRef,
            yCenterOffsetRef,
          });
          const session = drawingSessionRef.current;
          const startPoint =
            chartActiveDrawingTool === "trendline" &&
            session.chartId === drawingLayout.chart.id
              ? session.startPoint
              : dataPoint;
          if (startPoint || chartActiveDrawingTool !== "trendline") {
            updateDraftDrawing({
              chartId: drawingLayout.chart.id,
              type: chartActiveDrawingTool,
              start: startPoint || dataPoint,
              end: dataPoint,
            });
          }
          return;
        }
      }

      if (rectangleZoomDragRef.current) {
        const point = getLocalPoint(event);
        if (!point) return;
        const layout = getChartLayout().find(
          (candidate) =>
            candidate.chart.id === rectangleZoomDragRef.current.chartId,
        );
        if (!layout) return;
        const end = clampPointToPlot(point, layout.plot);
        rectangleZoomDragRef.current = {
          ...rectangleZoomDragRef.current,
          end,
        };
        setRectangleZoomRect({
          start: rectangleZoomDragRef.current.start,
          end,
        });
        return;
      }
      const drag = dragRef.current;
      if (!drag) return;
      const point = getLocalPoint(event);
      if (!point) return;
      if (drag.type === "y-scale") {
        const nextScale = Math.min(
          Y_SCALE_MAX,
          Math.max(
            Y_SCALE_MIN,
            drag.startScale * Math.exp((point.y - drag.startY) * 0.01),
          ),
        );
        yScaleRef.current.set(drag.chartId, nextScale);
        yManualScaleRef.current.add(drag.chartId);
        requestRender();
        return;
      }
      if (drag.type === "x-scale") {
        const startSpan = drag.startMax - drag.startMin;
        const nextSpan = Math.min(
          X_SCALE_MAX_SPAN,
          Math.max(
            X_SCALE_MIN_SPAN,
            startSpan * Math.exp((drag.startX - point.x) * 0.01),
          ),
        );
        viewStateRef.current.set(drag.chartId, {
          xMin: drag.startMax - nextSpan,
          xMax: drag.startMax,
        });
        requestRender();
        return;
      }
      const range = drag.startMax - drag.startMin;
      const delta = ((point.x - drag.startX) / drag.width) * range;
      viewStateRef.current.set(drag.chartId, {
        xMin: drag.startMin - delta,
        xMax: drag.startMax - delta,
      });
      if (drag.canPanY) {
        const yDelta =
          ((point.y - drag.startY) / drag.height) * drag.yValueSpan;
        yCenterOffsetRef.current.set(drag.chartId, drag.startYOffset + yDelta);
      }
      requestRender();
    },
    [
      fullscreenChartId,
      chartActiveDrawingTool,
      chartDrawings,
      findLayoutAt,
      getChartLayout,
      getLocalPoint,
      initialVisiblePoints,
      onDrawingsChange,
      requestRender,
      showTooltips,
      updateCrosshair,
    ],
  );

  const handlePointerUp = useCallback(
    (event) => {
      if (drawingEditRef.current) {
        finishEditDrawing();
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        return;
      }
      if (rectangleZoomDragRef.current) {
        const { chartId, start, end } = rectangleZoomDragRef.current;
        const layout = getChartLayout().find(
          (candidate) => candidate.chart.id === chartId,
        );
        rectangleZoomDragRef.current = null;
        setRectangleZoomRect(null);
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        if (layout) {
          const applied = applyRectangleZoom({
            chart: layout.chart,
            plot: layout.plot,
            start,
            end,
            initialVisiblePoints,
            viewStateRef,
            yScaleRef,
            yCenterOffsetRef,
            yManualScaleRef,
          });
          if (applied) {
            setRectangleZoomChartId(null);
            requestRender();
          }
        }
        return;
      }
      dragRef.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    },
    [
      getChartLayout,
      initialVisiblePoints,
      requestRender,
      viewStateRef,
      yCenterOffsetRef,
      yManualScaleRef,
      yScaleRef,
    ],
  );

  const handleWheel = useCallback(
    (event) => {
      if (fullscreenChartId) return;
      if (event.altKey) {
        event.preventDefault();
        const container = containerRef.current;
        if (!container) return;
        const deltaScale =
          event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? 16
            : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
              ? container.clientHeight
              : 1;
        container.scrollBy({
          left: event.deltaX * deltaScale,
          top: event.deltaY * deltaScale,
          behavior: "auto",
        });
        return;
      }
      const point = getLocalPoint(event);
      if (!point) return;
      const layout = findLayoutAt(point.x, point.y);
      if (!layout) return;
      event.preventDefault();
      if (event.shiftKey) {
        const currentScale = yScaleRef.current.get(layout.chart.id) ?? 1;
        yScaleRef.current.set(
          layout.chart.id,
          Math.min(
            Y_SCALE_MAX,
            Math.max(
              Y_SCALE_MIN,
              currentScale * Math.exp(event.deltaY * 0.01),
            ),
          ),
        );
        yManualScaleRef.current.add(layout.chart.id);
        requestRender();
        return;
      }
      const state =
        viewStateRef.current.get(layout.chart.id) ||
        getInitialView(layout.chart, initialVisiblePoints);
      const ratio = (point.x - layout.plot.x) / layout.plot.width;
      const anchor = state.xMin + ratio * (state.xMax - state.xMin);
      const zoom = Math.exp(event.deltaY * 0.0015);
      const nextMin = anchor - (anchor - state.xMin) * zoom;
      const nextMax = anchor + (state.xMax - anchor) * zoom;
      if (nextMax - nextMin < 10) return;
      viewStateRef.current.set(layout.chart.id, {
        xMin: nextMin,
        xMax: nextMax,
      });
      requestRender();
    },
    [
      findLayoutAt,
      fullscreenChartId,
      getLocalPoint,
      initialVisiblePoints,
      requestRender,
      yScaleRef,
    ],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
  }, [handleWheel]);

  const focusChartByKeyboard = useCallback(
    (direction) => {
      if (fullscreenChartId || charts.length === 0) return false;
      if (!focusedChartId) {
        setFocusedChartId(charts[0].id);
        chartRefs.current.get(charts[0].id)?.scrollIntoView({
          block: "nearest",
          inline: "nearest",
        });
        return true;
      }
      const currentIndex = Math.max(
        0,
        charts.findIndex((chart) => chart.id === focusedChartId),
      );
      const safeColumns = Math.max(1, Math.min(charts.length, Number(columns) || 1));
      const rowStart = Math.floor(currentIndex / safeColumns) * safeColumns;
      const rowEnd = Math.min(charts.length - 1, rowStart + safeColumns - 1);
      let nextIndex = currentIndex;

      if (direction === "left") {
        nextIndex = Math.max(rowStart, currentIndex - 1);
      } else if (direction === "right") {
        nextIndex = Math.min(rowEnd, currentIndex + 1);
      } else if (direction === "up") {
        nextIndex = Math.max(0, currentIndex - safeColumns);
      } else if (direction === "down") {
        nextIndex = Math.min(charts.length - 1, currentIndex + safeColumns);
      }

      const nextChart = charts[nextIndex];
      if (!nextChart || nextChart.id === focusedChartId) return false;
      setFocusedChartId(nextChart.id);
      setCrosshair(null);
      setRectangleZoomChartId(null);
      setRectangleZoomRect(null);
      rectangleZoomDragRef.current = null;
      clearDraft();
      onActiveDrawingToolChange?.(null);
      chartRefs.current.get(nextChart.id)?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
      return true;
    },
    [
      charts,
      clearDraft,
      columns,
      focusedChartId,
      fullscreenChartId,
      onActiveDrawingToolChange,
    ],
  );

  useEffect(() => {
    const handleKeyDown = (event) => {
      // The fullscreen overlay owns keyboard shortcuts while it is open.
      if (fullscreenChartId) return;
      const target = event.target;
      const editable =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (editable) {
        return;
      }
      const arrowDirectionByKey = {
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "up",
        ArrowDown: "down",
      };
      const arrowDirection = arrowDirectionByKey[event.key];
      if (arrowDirection) {
        if (focusChartByKeyboard(arrowDirection)) {
          event.preventDefault();
        }
        return;
      }
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        resetChartView(focusedChartId);
        return;
      }
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        toggleRectangleZoom(focusedChartId);
        return;
      }
      if (!disableDrawings && event.key.toLowerCase() === "m") {
        event.preventDefault();
        toggleMovingAverage(focusedChartId);
        return;
      }
      if (
        !disableDrawings &&
        ["t", "h", "v", "p"].includes(event.key.toLowerCase())
      ) {
        event.preventDefault();
        const toolByKey = { t: "trendline", h: "hline", v: "vline", p: "pin" };
        toggleDrawingTool(toolByKey[event.key.toLowerCase()]);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (disableDrawings || !chartSelectedDrawingId) return;
        event.preventDefault();
        deleteSelectedDrawing();
        return;
      }
      if (
        event.key === "Escape" &&
        (chartActiveDrawingTool || draftDrawing || drawingEditRef.current)
      ) {
        event.preventDefault();
        cancelDrawing();
        return;
      }
      if (event.key === "Escape" && rectangleZoomChartId) {
        event.preventDefault();
        setRectangleZoomChartId(null);
        setRectangleZoomRect(null);
        rectangleZoomDragRef.current = null;
        return;
      }
      if (event.key.toLowerCase() === "f") {
        if (fullscreenChartId) return;
        event.preventDefault();
        openFullscreen(focusedChartId);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    focusedChartId,
    fullscreenChartId,
    chartActiveDrawingTool,
    chartSelectedDrawingId,
    cancelDrawing,
    deleteSelectedDrawing,
    disableDrawings,
    draftDrawing,
    focusChartByKeyboard,
    openFullscreen,
    rectangleZoomChartId,
    resetChartView,
    toggleMovingAverage,
    toggleDrawingTool,
    toggleRectangleZoom,
  ]);

  const fullscreenChart = fullscreenChartId
    ? charts.find((chart) => chart.id === fullscreenChartId)
    : null;
  const chartLayouts = fullscreenChart ? [] : getChartLayout();
  const selectedDrawingLayout = getSelectedDrawingLayout(
    chartLayouts,
    chartDrawings,
    chartSelectedDrawingId,
  );

  return (
    <div
      ref={containerRef}
      className={`aliencharts-root relative h-full overflow-y-auto ${className}`}
      style={{
        cursor:
          rectangleZoomChartId || chartActiveDrawingTool ? "crosshair" : undefined,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setCrosshair(null)}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onContextMenu={handleContextMenu}
    >
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute left-0 top-0 z-10 block"
        style={{
          width: "100%",
        }}
      />
      <div
        ref={gridRef}
        className="relative z-0 grid gap-1 pt-1"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(18rem, 1fr))`,
        }}
      >
        {charts.map((chart) => (
          <ChartCell
            key={chart.id}
            chart={chart}
            axisOverlay={axisOverlays[chart.id]}
            focused={focusedChartId === chart.id}
            backgroundColor={backgroundColor}
            onFocus={setFocusedChartId}
            onFullscreenToggle={() => openFullscreen(chart.id)}
            onReset={resetChartView}
            onJumpLatest={jumpChartToLatest}
            onRectangleZoomToggle={toggleRectangleZoom}
            rectangleZoomActive={rectangleZoomChartId === chart.id}
            movingAverage={disableDrawings ? null : movingAverageByChart?.[chart.id]}
            onMovingAverageToggle={toggleMovingAverage}
            activeDrawingTool={
              focusedChartId === chart.id ? chartActiveDrawingTool : null
            }
            onDrawingToolToggle={toggleDrawingTool}
            hasDrawings={getDrawingsForChart(chartDrawings, chart.id).length > 0}
            onClearDrawingsRequest={onClearDrawingsRequest}
            disableDrawings={disableDrawings}
            gridLines={gridLines}
            showToolbar={showToolbar}
            showLatestValueLine={showLatestValueLine}
            formatXTick={formatXTick}
            formatYValue={formatYValue}
            setRef={(node) => {
              if (node) chartRefs.current.set(chart.id, node);
              else chartRefs.current.delete(chart.id);
            }}
          />
        ))}
      </div>
      <CrosshairOverlay
        crosshair={fullscreenChart || !showTooltips ? null : crosshair}
        height={containerRef.current?.scrollHeight ?? "100%"}
        xAxisLabel={xAxisLabel}
        formatXValue={formatXValue}
        formatYValue={formatYValue}
      />
      <DrawingOverlay
        layouts={chartLayouts}
        drawings={chartDrawings}
        draftDrawing={fullscreenChart || disableDrawings ? null : draftDrawing}
        selectedDrawingId={chartSelectedDrawingId}
        projectPoint={(dataPoint, targetLayout) =>
          projectDataPointToScreenPoint({
            point: dataPoint,
            layout: targetLayout,
            initialVisiblePoints,
            viewStateRef,
            yScaleRef,
            yCenterOffsetRef,
          })
        }
        height={containerRef.current?.scrollHeight ?? "100%"}
      />
      <TopMarkersOverlay
        layouts={fullscreenChart ? [] : chartLayouts}
        markers={topMarkers}
        viewStateRef={viewStateRef}
        initialVisiblePoints={initialVisiblePoints}
        onMarkerClick={onTopMarkerClick}
        height={containerRef.current?.scrollHeight ?? "100%"}
      />
      {selectedDrawingLayout ? (
        <DrawingOptionsToolbar
          drawing={selectedDrawingLayout.drawing}
          style={getDrawingOptionsToolbarStyle(selectedDrawingLayout.layout)}
          onToggleExtend={toggleSelectedDrawingExtend}
          onColorChange={updateSelectedDrawingColor}
          onTextChange={updateSelectedDrawingText}
        />
      ) : null}
      {!disableDrawings && !fullscreenChart && focusedChartId && movingAverageByChart?.[focusedChartId]?.enabled ? (
        (() => {
          const layout = chartLayouts.find(
            (candidate) => candidate.chart.id === focusedChartId,
          );
          if (!layout) return null;
          return (
            <MovingAverageOptionsToolbar
              movingAverage={movingAverageByChart[focusedChartId]}
              style={getMovingAverageOptionsToolbarStyle(layout)}
              onChange={(nextMovingAverage) =>
                onMovingAverageChange?.(focusedChartId, nextMovingAverage)
              }
            />
          );
        })()
      ) : null}
      <RectangleZoomOverlay rect={fullscreenChart ? null : rectangleZoomRect} />
      {fullscreenChart ? (
        <ChartFullscreenOverlay
          chart={fullscreenChart}
          dataRevision={dataRevision}
          renderRevision={revision}
          initialVisiblePoints={initialVisiblePoints}
          backgroundColor={backgroundColor}
          antialiasLines={antialiasLines}
          getAppendAnimatedPoint={getAppendAnimatedPoint}
          viewStateRef={viewStateRef}
          yScaleRef={yScaleRef}
          yCenterOffsetRef={yCenterOffsetRef}
          yManualScaleRef={yManualScaleRef}
          movingAverageByChart={movingAverageByChart}
          movingAverageCache={movingAverageCacheRef.current}
          onMovingAverageToggle={toggleMovingAverage}
          onMovingAverageChange={onMovingAverageChange}
          seriesOrderByChart={seriesOrderByChart}
          onClose={closeFullscreen}
          onReset={resetChartView}
          onJumpLatest={jumpChartToLatest}
          xAxisLabel={xAxisLabel}
          drawings={chartDrawings}
          onDrawingsChange={onDrawingsChange}
          activeDrawingTool={chartActiveDrawingTool}
          onActiveDrawingToolChange={onActiveDrawingToolChange}
          selectedDrawingId={chartSelectedDrawingId}
          onSelectedDrawingIdChange={onSelectedDrawingIdChange}
          createDrawingId={createDrawingId}
          onClearDrawingsRequest={onClearDrawingsRequest}
          onChartContextMenu={onChartContextMenu}
          topMarkers={topMarkers}
          onTopMarkerClick={onTopMarkerClick}
          disableDrawings={disableDrawings}
          gridLines={gridLines}
          showToolbar={showToolbar}
          showLatestValueLine={showLatestValueLine}
          showTooltips={showTooltips}
          formatXTick={formatXTick}
          formatXValue={formatXValue}
          formatYValue={formatYValue}
        />
      ) : null}
    </div>
  );
});

export { createSeries, createMockCharts };

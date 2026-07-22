import { createSeries } from "./lodSeries.js";

const CHART_HEIGHT = 360;
const RIGHT_AXIS_WIDTH = 58;
const PLOT_PADDING = {
  left: 38,
  right: RIGHT_AXIS_WIDTH,
  top: 34,
  bottom: 28,
};
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
const DEFAULT_GRID_X_SPACING = 80;
const DEFAULT_GRID_Y_SPACING = 48;
const DEFAULT_CHART_BACKGROUND = "#f5f9ff";
const EMPTY_ARRAY = [];
const EMPTY_OBJECT = {};

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

export {
  CHART_HEIGHT,
  RIGHT_AXIS_WIDTH,
  PLOT_PADDING,
  Y_SCALE_MIN,
  Y_SCALE_MAX,
  X_SCALE_MIN_SPAN,
  X_SCALE_MAX_SPAN,
  DEFAULT_CHART_BACKGROUND,
  createProgram,
  createAntialiasProgram,
  createSeriesBufferCache,
  deleteSeriesBuffers,
  drawChartLayouts,
  getChartXBounds,
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
};

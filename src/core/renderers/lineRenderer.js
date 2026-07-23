import { getOrderedSeries } from "../chartModel.js";
import { createLineSeries } from "../lodSeries.js";
import {
  createProgram,
  deleteBufferCache,
  getDynamicBuffer,
  hexToRgb,
} from "./webglUtils.js";

const AA_VERTEX_FLOAT_STRIDE = 6;
const AA_LINE_WIDTH_PX = 1.5;
const AA_EDGE_WIDTH_PX = 1;
const DASH_LENGTH_PX = 7;
const DASH_GAP_PX = 5;

const LINE_VERTEX_SOURCE = `#version 300 es
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
    vec2 clip = (vec2(px, py) / u_resolution) * 2.0 - 1.0;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  }
`;

const LINE_FRAGMENT_SOURCE = `#version 300 es
  precision highp float;
  uniform vec3 u_color;
  out vec4 outColor;

  void main() {
    outColor = vec4(u_color, 1.0);
  }
`;

const AA_VERTEX_SOURCE = `#version 300 es
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
    vec2 clip = (px / u_resolution) * 2.0 - 1.0;
    v_side = a_side;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  }
`;

const AA_FRAGMENT_SOURCE = `#version 300 es
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

const fillSeriesPoints = ({
  vertices,
  visiblePoints,
  pointCount,
  animatedPoint,
}) => {
  for (let index = 0; index < pointCount; index += 1) {
    const source =
      animatedPoint && index === animatedPoint.index
        ? animatedPoint
        : { x: visiblePoints.x[index], y: visiblePoints.y[index] };
    vertices[index * 2] = source.x;
    vertices[index * 2 + 1] = source.y;
  }
};

const getSinglePointSegment = ({ series, state, yRange, plot }) => {
  if (series.length !== 1) return null;
  const x = series.rawX[0];
  const y = series.rawY[0];
  if (x < state.xMin || x > state.xMax || y < yRange.minY || y > yRange.maxY) {
    return null;
  }
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

const getSeriesPoint = (visiblePoints, animatedPoint, index) =>
  animatedPoint && index === animatedPoint.index
    ? { x: animatedPoint.x, y: animatedPoint.y }
    : { x: visiblePoints.x[index], y: visiblePoints.y[index] };

const fillAntialiasSeriesSegments = ({
  vertices,
  visiblePoints,
  pointCount,
  animatedPoint,
}) => {
  let offset = 0;
  for (let index = 0; index < pointCount - 1; index += 1) {
    const start = getSeriesPoint(visiblePoints, animatedPoint, index);
    const end = getSeriesPoint(visiblePoints, animatedPoint, index + 1);
    [
      [-1, 0], [1, 0], [-1, 1],
      [-1, 1], [1, 0], [1, 1],
    ].forEach(([side, along]) => {
      writeAntialiasVertex(vertices, offset, start, end, side, along);
      offset += AA_VERTEX_FLOAT_STRIDE;
    });
  }
  return offset / AA_VERTEX_FLOAT_STRIDE;
};

const projectDataToPixel = ({ x, y, state, yRange, plot }) => ({
  x: plot.x + ((x - state.xMin) / (state.xMax - state.xMin)) * plot.width,
  y: plot.y + ((yRange.maxY - y) / (yRange.maxY - yRange.minY)) * plot.height,
});

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
  for (let index = 0; index < pointCount - 1; index += 1) {
    const start = { x: visiblePoints.x[index], y: visiblePoints.y[index] };
    const end = {
      x: visiblePoints.x[index + 1],
      y: visiblePoints.y[index + 1],
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
        if (offset + 4 > vertices.length) return offset / 2;
        const t0 = consumed / pixelLength;
        const t1 = (consumed + step) / pixelLength;
        vertices[offset] = start.x + (end.x - start.x) * t0;
        vertices[offset + 1] = start.y + (end.y - start.y) * t0;
        vertices[offset + 2] = start.x + (end.x - start.x) * t1;
        vertices[offset + 3] = start.y + (end.y - start.y) * t1;
        offset += 4;
      }
      consumed += step;
      distance += step;
    }
  }
  return offset / 2;
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

const calculateMovingAverageChunk = ({
  sourceY,
  startIndex,
  period,
  type,
  previousAverage,
}) => {
  const out = new Float32Array(Math.max(0, sourceY.length - startIndex));
  if (!out.length) return out;
  if (type === "sma") {
    let sum = 0;
    const firstWindowStart = Math.max(0, startIndex - period + 1);
    for (let index = firstWindowStart; index < startIndex; index += 1) {
      sum += sourceY[index];
    }
    for (let index = startIndex; index < sourceY.length; index += 1) {
      sum += sourceY[index];
      const removeIndex = index - period;
      if (removeIndex >= firstWindowStart) sum -= sourceY[removeIndex];
      out[index - startIndex] = sum / Math.min(period, index + 1);
    }
    return out;
  }
  const multiplier = 2 / (period + 1);
  let previous = Number.isFinite(previousAverage)
    ? previousAverage
    : sourceY[startIndex];
  for (let index = startIndex; index < sourceY.length; index += 1) {
    previous = sourceY[index] * multiplier + previous * (1 - multiplier);
    out[index - startIndex] = previous;
  }
  return out;
};

const getMovingAverageSeriesForChart = ({
  chart,
  movingAverage,
  cache,
}) => {
  const normalized = normalizeMovingAverage(movingAverage);
  if (!normalized) return [];
  return chart.series.map((series) => {
    if (!series.length) return null;
    const key =
      `${series.id}::ma:${normalized.type}:${normalized.period}`;
    const cached = cache.get(key);
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
      cached.series.name =
        `${series.name} ${normalized.type.toUpperCase()} ${normalized.period}`;
      return cached.series;
    }
    const movingY = calculateMovingAverageChunk({
      sourceY: series.rawY.subarray(0, series.length),
      startIndex: 0,
      period: normalized.period,
      type: normalized.type,
    });
    const movingSeries = createLineSeries({
      id: key,
      name:
        `${series.name} ${normalized.type.toUpperCase()} ${normalized.period}`,
      color: series.color,
      x: series.rawX.subarray(0, series.length),
      y: movingY,
    });
    cache.set(key, {
      sourceSeries: series,
      sourceLength: series.length,
      series: movingSeries,
    });
    return movingSeries;
  }).filter(Boolean);
};

const getLineLocations = (gl, program) => Object.freeze({
  aXy: gl.getAttribLocation(program, "a_xy"),
  uColor: gl.getUniformLocation(program, "u_color"),
  uRect: gl.getUniformLocation(program, "u_rect"),
  uResolution: gl.getUniformLocation(program, "u_resolution"),
  uXRange: gl.getUniformLocation(program, "u_xRange"),
  uYRange: gl.getUniformLocation(program, "u_yRange"),
});

export const createLineRenderer = (gl) => {
  const program = createProgram(
    gl,
    LINE_VERTEX_SOURCE,
    LINE_FRAGMENT_SOURCE,
  );
  const antialiasProgram = createProgram(
    gl,
    AA_VERTEX_SOURCE,
    AA_FRAGMENT_SOURCE,
  );
  const locations = getLineLocations(gl, program);
  const aaLocations = Object.freeze({
    aAlong: gl.getAttribLocation(antialiasProgram, "a_along"),
    aEnd: gl.getAttribLocation(antialiasProgram, "a_end"),
    aSide: gl.getAttribLocation(antialiasProgram, "a_side"),
    aStart: gl.getAttribLocation(antialiasProgram, "a_start"),
    uColor: gl.getUniformLocation(antialiasProgram, "u_color"),
    uEdgeWidth: gl.getUniformLocation(antialiasProgram, "u_edgeWidth"),
    uLineHalfWidth:
      gl.getUniformLocation(antialiasProgram, "u_lineHalfWidth"),
    uRect: gl.getUniformLocation(antialiasProgram, "u_rect"),
    uResolution: gl.getUniformLocation(antialiasProgram, "u_resolution"),
    uXRange: gl.getUniformLocation(antialiasProgram, "u_xRange"),
    uYRange: gl.getUniformLocation(antialiasProgram, "u_yRange"),
  });
  const buffers = new Map();
  const antialiasBuffers = new Map();
  const movingAverageCache = new Map();

  const setCommonUniforms = (
    activeLocations,
    pixelWidth,
    pixelHeight,
    scaledPlot,
    state,
    yRange,
  ) => {
    gl.uniform2f(activeLocations.uResolution, pixelWidth, pixelHeight);
    gl.uniform4f(
      activeLocations.uRect,
      scaledPlot.x,
      scaledPlot.y,
      scaledPlot.width,
      scaledPlot.height,
    );
    gl.uniform2f(activeLocations.uXRange, state.xMin, state.xMax);
    gl.uniform2f(activeLocations.uYRange, yRange.minY, yRange.maxY);
  };

  return {
    draw({
      antialiasLines,
      chart,
      descriptor,
      dpr,
      getAppendAnimatedPoint,
      movingAverage,
      now,
      pixelHeight,
      pixelWidth,
      plot,
      scaledPlot,
      seriesOrderByChart,
      state,
      yRange,
    }) {
      const useAntialias = Boolean(antialiasLines);
      const activeProgram = useAntialias ? antialiasProgram : program;
      const activeLocations = useAntialias ? aaLocations : locations;
      gl.useProgram(activeProgram);
      setCommonUniforms(
        activeLocations,
        pixelWidth,
        pixelHeight,
        scaledPlot,
        state,
        yRange,
      );
      if (useAntialias) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.enableVertexAttribArray(aaLocations.aStart);
        gl.enableVertexAttribArray(aaLocations.aEnd);
        gl.enableVertexAttribArray(aaLocations.aSide);
        gl.enableVertexAttribArray(aaLocations.aAlong);
        gl.uniform1f(
          aaLocations.uLineHalfWidth,
          (AA_LINE_WIDTH_PX * dpr) / 2,
        );
        gl.uniform1f(aaLocations.uEdgeWidth, AA_EDGE_WIDTH_PX * dpr);
      } else {
        gl.disable(gl.BLEND);
        gl.enableVertexAttribArray(locations.aXy);
      }

      const seriesEndpoints = new Map();
      const hideBaseSeries =
        descriptor.capabilities.movingAverage &&
        Boolean(movingAverage?.enabled) &&
        Boolean(movingAverage?.hideBase);

      if (!hideBaseSeries) {
        getOrderedSeries(chart, seriesOrderByChart).forEach((series) => {
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
          const pointCount =
            animatedPoint?.pointCount ?? visiblePoints.pointCount;
          if (animatedPoint) {
            seriesEndpoints.set(series.id, {
              x: animatedPoint.x,
              y: animatedPoint.y,
            });
          } else if (singlePointEndpoint) {
            seriesEndpoints.set(series.id, singlePointEndpoint);
          }
          const [r, g, b] = hexToRgb(series.color);
          gl.uniform3f(activeLocations.uColor, r, g, b);

          if (useAntialias) {
            const requiredFloats =
              Math.max(0, pointCount - 1) *
              6 *
              AA_VERTEX_FLOAT_STRIDE;
            const entry = getDynamicBuffer(
              gl,
              antialiasBuffers,
              series.id,
              requiredFloats,
            );
            const drawVertexCount = fillAntialiasSeriesSegments({
              vertices: entry.vertices,
              visiblePoints,
              pointCount,
              animatedPoint,
            });
            const stride =
              AA_VERTEX_FLOAT_STRIDE * Float32Array.BYTES_PER_ELEMENT;
            gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer);
            gl.vertexAttribPointer(
              aaLocations.aStart,
              2,
              gl.FLOAT,
              false,
              stride,
              0,
            );
            gl.vertexAttribPointer(
              aaLocations.aEnd,
              2,
              gl.FLOAT,
              false,
              stride,
              2 * Float32Array.BYTES_PER_ELEMENT,
            );
            gl.vertexAttribPointer(
              aaLocations.aSide,
              1,
              gl.FLOAT,
              false,
              stride,
              4 * Float32Array.BYTES_PER_ELEMENT,
            );
            gl.vertexAttribPointer(
              aaLocations.aAlong,
              1,
              gl.FLOAT,
              false,
              stride,
              5 * Float32Array.BYTES_PER_ELEMENT,
            );
            gl.bufferSubData(
              gl.ARRAY_BUFFER,
              0,
              entry.vertices,
              0,
              drawVertexCount * AA_VERTEX_FLOAT_STRIDE,
            );
            gl.drawArrays(gl.TRIANGLES, 0, drawVertexCount);
            return;
          }

          const entry = getDynamicBuffer(
            gl,
            buffers,
            series.id,
            pointCount * 2,
          );
          fillSeriesPoints({
            vertices: entry.vertices,
            visiblePoints,
            pointCount,
            animatedPoint,
          });
          gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer);
          gl.vertexAttribPointer(locations.aXy, 2, gl.FLOAT, false, 0, 0);
          gl.bufferSubData(
            gl.ARRAY_BUFFER,
            0,
            entry.vertices,
            0,
            pointCount * 2,
          );
          gl.drawArrays(gl.LINE_STRIP, 0, pointCount);
        });
      }

      const movingSeries = getMovingAverageSeriesForChart({
        chart,
        movingAverage: descriptor.capabilities.movingAverage
          ? movingAverage
          : null,
        cache: movingAverageCache,
      });
      if (movingSeries.length) {
        gl.disable(gl.BLEND);
        gl.useProgram(program);
        gl.enableVertexAttribArray(locations.aXy);
        setCommonUniforms(
          locations,
          pixelWidth,
          pixelHeight,
          scaledPlot,
          state,
          yRange,
        );
        getOrderedSeries(
          { ...chart, series: movingSeries },
          seriesOrderByChart,
        ).forEach((series) => {
          const visiblePoints = series.getVisiblePoints(
            state.xMin,
            state.xMax,
            plot.width,
          );
          if (visiblePoints.pointCount < 2) return;
          const entry = getDynamicBuffer(
            gl,
            buffers,
            series.id,
            visiblePoints.pointCount * 8 * 2,
          );
          const drawVertexCount = fillDashedSeriesSegments({
            vertices: entry.vertices,
            visiblePoints,
            pointCount: visiblePoints.pointCount,
            state,
            yRange,
            plot,
          });
          if (drawVertexCount < 2) return;
          const [r, g, b] = hexToRgb(series.color);
          gl.uniform3f(locations.uColor, r, g, b);
          gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer);
          gl.vertexAttribPointer(locations.aXy, 2, gl.FLOAT, false, 0, 0);
          gl.bufferSubData(
            gl.ARRAY_BUFFER,
            0,
            entry.vertices,
            0,
            drawVertexCount * 2,
          );
          gl.drawArrays(gl.LINES, 0, drawVertexCount);
        });
      }
      gl.disable(gl.BLEND);
      return { seriesEndpoints };
    },

    destroy() {
      deleteBufferCache(gl, buffers);
      deleteBufferCache(gl, antialiasBuffers);
      movingAverageCache.clear();
      gl.deleteProgram(program);
      gl.deleteProgram(antialiasProgram);
    },
  };
};

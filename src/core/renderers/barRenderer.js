import { getOrderedSeries } from "../chartModel.js";
import {
  createProgram,
  deleteBufferCache,
  getDynamicBuffer,
  hexToRgb,
} from "./webglUtils.js";

const BAR_GROUP_WIDTH_RATIO = 0.8;
const BAR_SLICE_WIDTH_RATIO = 0.9;
const BAR_VERTEX_FLOAT_STRIDE = 3;

const VERTEX_SOURCE = `#version 300 es
  in vec2 a_unit;
  in vec3 a_bar;
  uniform vec2 u_resolution;
  uniform vec4 u_rect;
  uniform vec2 u_categoryRange;
  uniform vec2 u_valueRange;
  uniform float u_baseline;
  uniform float u_seriesIndex;
  uniform float u_seriesCount;
  uniform int u_orientation;

  void main() {
    float groupWidth = a_bar.z * ${BAR_GROUP_WIDTH_RATIO.toFixed(1)};
    float sliceWidth = groupWidth / max(1.0, u_seriesCount);
    float center = a_bar.x - groupWidth * 0.5
      + sliceWidth * (u_seriesIndex + 0.5);
    float halfWidth = sliceWidth * ${(
      BAR_SLICE_WIDTH_RATIO / 2
    ).toFixed(2)};
    float category = mix(center - halfWidth, center + halfWidth, a_unit.x);
    float value = mix(u_baseline, a_bar.y, a_unit.y);
    float categoryDenom = max(
      0.000000000001,
      abs(u_categoryRange.y - u_categoryRange.x)
    );
    float valueDenom = max(
      0.000000000001,
      abs(u_valueRange.y - u_valueRange.x)
    );
    float categoryRatio = (category - u_categoryRange.x) / categoryDenom;
    float valueRatio = (value - u_valueRange.x) / valueDenom;
    vec2 px = u_orientation == 0
      ? vec2(
          u_rect.x + categoryRatio * u_rect.z,
          u_rect.y + (1.0 - valueRatio) * u_rect.w
        )
      : vec2(
          u_rect.x + valueRatio * u_rect.z,
          u_rect.y + categoryRatio * u_rect.w
        );
    vec2 clip = (px / u_resolution) * 2.0 - 1.0;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  }
`;

const FRAGMENT_SOURCE = `#version 300 es
  precision highp float;
  uniform vec3 u_color;
  out vec4 outColor;

  void main() {
    outColor = vec4(u_color, 1.0);
  }
`;

const getBarCategoryInterval = ({
  visiblePoints,
  index,
  categoryMin,
  categoryMax,
}) => {
  const count = visiblePoints.pointCount;
  const category = visiblePoints.x[index];
  const fallbackInterval =
    (categoryMax - categoryMin) / Math.max(10, count || 1);
  const previousGap =
    index > 0 ? category - visiblePoints.x[index - 1] : Infinity;
  const nextGap =
    index + 1 < count ? visiblePoints.x[index + 1] - category : Infinity;
  let interval = Math.min(
    previousGap > 0 ? previousGap : Infinity,
    nextGap > 0 ? nextGap : Infinity,
  );
  if (!Number.isFinite(interval)) {
    interval = Number.isFinite(previousGap) && previousGap > 0
      ? previousGap
      : Number.isFinite(nextGap) && nextGap > 0
        ? nextGap
        : fallbackInterval;
  }
  return Math.max(Number.EPSILON, interval || fallbackInterval || 1);
};

export const getGroupedBarCategory = ({
  visiblePoints,
  pointIndex,
  seriesIndex,
  seriesCount,
  categoryMin,
  categoryMax,
}) => {
  const category = visiblePoints.x[pointIndex];
  const interval = getBarCategoryInterval({
    visiblePoints,
    index: pointIndex,
    categoryMin,
    categoryMax,
  });
  const groupWidth = interval * BAR_GROUP_WIDTH_RATIO;
  const sliceWidth = groupWidth / Math.max(1, seriesCount);
  return category - groupWidth / 2 + sliceWidth * (seriesIndex + 0.5);
};

const fillBarInstances = ({
  vertices,
  visiblePoints,
  categoryMin,
  categoryMax,
}) => {
  for (let index = 0; index < visiblePoints.pointCount; index += 1) {
    const offset = index * BAR_VERTEX_FLOAT_STRIDE;
    vertices[offset] = visiblePoints.x[index];
    vertices[offset + 1] = visiblePoints.y[index];
    vertices[offset + 2] = getBarCategoryInterval({
      visiblePoints,
      index,
      categoryMin,
      categoryMax,
    });
  }
  return visiblePoints.pointCount;
};

export const createBarRenderer = (gl) => {
  const program = createProgram(gl, VERTEX_SOURCE, FRAGMENT_SOURCE);
  const quadBuffer = gl.createBuffer();
  const buffers = new Map();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      0, 0, 1, 0, 0, 1,
      0, 1, 1, 0, 1, 1,
    ]),
    gl.STATIC_DRAW,
  );

  const locations = Object.freeze({
    aBar: gl.getAttribLocation(program, "a_bar"),
    aUnit: gl.getAttribLocation(program, "a_unit"),
    uBaseline: gl.getUniformLocation(program, "u_baseline"),
    uCategoryRange: gl.getUniformLocation(program, "u_categoryRange"),
    uColor: gl.getUniformLocation(program, "u_color"),
    uOrientation: gl.getUniformLocation(program, "u_orientation"),
    uRect: gl.getUniformLocation(program, "u_rect"),
    uResolution: gl.getUniformLocation(program, "u_resolution"),
    uSeriesCount: gl.getUniformLocation(program, "u_seriesCount"),
    uSeriesIndex: gl.getUniformLocation(program, "u_seriesIndex"),
    uValueRange: gl.getUniformLocation(program, "u_valueRange"),
  });

  return {
    draw({
      categoryPixelLength,
      chart,
      descriptor,
      pixelHeight,
      pixelWidth,
      scaledPlot,
      seriesOrderByChart,
      state,
      yRange,
    }) {
      gl.disable(gl.BLEND);
      gl.useProgram(program);
      gl.enableVertexAttribArray(locations.aUnit);
      gl.enableVertexAttribArray(locations.aBar);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      gl.vertexAttribPointer(locations.aUnit, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(locations.aUnit, 0);
      gl.uniform2f(locations.uResolution, pixelWidth, pixelHeight);
      gl.uniform4f(
        locations.uRect,
        scaledPlot.x,
        scaledPlot.y,
        scaledPlot.width,
        scaledPlot.height,
      );
      gl.uniform2f(
        locations.uCategoryRange,
        state.xMin,
        state.xMax,
      );
      gl.uniform2f(
        locations.uValueRange,
        yRange.minY,
        yRange.maxY,
      );
      gl.uniform1f(locations.uBaseline, 0);
      gl.uniform1i(
        locations.uOrientation,
        descriptor.orientation === "horizontal" ? 1 : 0,
      );
      const orderedSeries = getOrderedSeries(chart, seriesOrderByChart);
      gl.uniform1f(locations.uSeriesCount, Math.max(1, orderedSeries.length));

      orderedSeries.forEach((series, seriesIndex) => {
        const visiblePoints = series.getVisiblePoints(
          state.xMin,
          state.xMax,
          categoryPixelLength,
        );
        if (!visiblePoints.pointCount) return;
        const requiredFloats =
          visiblePoints.pointCount * BAR_VERTEX_FLOAT_STRIDE;
        const bufferEntry = getDynamicBuffer(
          gl,
          buffers,
          series.id,
          requiredFloats,
        );
        const instanceCount = fillBarInstances({
          vertices: bufferEntry.vertices,
          visiblePoints,
          categoryMin: state.xMin,
          categoryMax: state.xMax,
        });
        const [r, g, b] = hexToRgb(series.color);
        gl.uniform3f(locations.uColor, r, g, b);
        gl.uniform1f(locations.uSeriesIndex, seriesIndex);
        gl.bindBuffer(gl.ARRAY_BUFFER, bufferEntry.buffer);
        gl.vertexAttribPointer(
          locations.aBar,
          BAR_VERTEX_FLOAT_STRIDE,
          gl.FLOAT,
          false,
          0,
          0,
        );
        gl.vertexAttribDivisor(locations.aBar, 1);
        gl.bufferSubData(
          gl.ARRAY_BUFFER,
          0,
          bufferEntry.vertices,
          0,
          instanceCount * BAR_VERTEX_FLOAT_STRIDE,
        );
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, instanceCount);
      });
      gl.vertexAttribDivisor(locations.aBar, 0);
      return { seriesEndpoints: new Map() };
    },

    getTooltipCategory(payload) {
      return getGroupedBarCategory(payload);
    },

    destroy() {
      deleteBufferCache(gl, buffers);
      gl.deleteBuffer(quadBuffer);
      gl.deleteProgram(program);
    },
  };
};

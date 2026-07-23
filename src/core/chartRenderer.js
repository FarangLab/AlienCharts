import {
  getChartCategories,
  getChartDescriptor,
  getOrderedSeries,
  resolveChartDescriptor,
} from "./chartModel.js";
import { createCoordinateTransform } from "./coordinateTransform.js";
import { hexToRgb } from "./renderers/webglUtils.js";

const CHART_HEIGHT = 360;
const RIGHT_AXIS_WIDTH = 58;
const PLOT_PADDING = Object.freeze({
  left: 38,
  right: RIGHT_AXIS_WIDTH,
  top: 34,
  bottom: 28,
});
const HORIZONTAL_PLOT_PADDING = Object.freeze({
  left: RIGHT_AXIS_WIDTH,
  right: 20,
  top: 34,
  bottom: 28,
});
const CATEGORICAL_PLOT_PADDING = Object.freeze({
  ...PLOT_PADDING,
  bottom: 42,
});
const CATEGORICAL_HORIZONTAL_PLOT_PADDING = Object.freeze({
  ...HORIZONTAL_PLOT_PADDING,
  left: 128,
});
const Y_SCALE_MIN = 0.05;
const Y_SCALE_MAX = 40;
const Y_AXIS_TICK_COUNT = 5;
const X_AXIS_TICK_COUNT = 5;
const X_SCALE_MIN_SPAN = 10;
const X_SCALE_MAX_SPAN = 1000000000;
const JUMP_LATEST_RIGHT_PADDING_RATIO = 0.1;
const DEFAULT_CHART_BACKGROUND = "#f5f9ff";

const getChartType = (chart, descriptor) =>
  (descriptor || resolveChartDescriptor(chart)).type;

const getChartOrientation = (chart, descriptor) =>
  (descriptor || resolveChartDescriptor(chart)).orientation;

const getPlotPadding = (chart, descriptor) => {
  const categorical = getChartCategories(chart).length > 0;
  if (getChartOrientation(chart, descriptor) === "horizontal") {
    return categorical
      ? CATEGORICAL_HORIZONTAL_PLOT_PADDING
      : HORIZONTAL_PLOT_PADDING;
  }
  return categorical ? CATEGORICAL_PLOT_PADDING : PLOT_PADDING;
};

const getCategoryPixelLength = (chart, plot, descriptor) =>
  getChartOrientation(chart, descriptor) === "horizontal"
    ? plot.height
    : plot.width;

const validateChartSeries = (chart) => resolveChartDescriptor(chart);

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

const lowerBound = (array, value) => {
  let low = 0;
  let high = array.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (array[middle] < value) low = middle + 1;
    else high = middle;
  }
  return low;
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
    if (!series.length) return;
    minX = Math.min(minX, series.rawX[0]);
    maxX = Math.max(maxX, series.rawX[series.length - 1]);
  });
  return { minX, maxX };
};

const getMinimumCategorySpan = (chart) => {
  const categories = getChartCategories(chart)
    .map((category) => category.value)
    .sort((left, right) => left - right);
  if (!categories.length) return X_SCALE_MIN_SPAN;
  let minimumGap = Infinity;
  for (let index = 1; index < categories.length; index += 1) {
    minimumGap = Math.min(minimumGap, categories[index] - categories[index - 1]);
  }
  return Number.isFinite(minimumGap) ? minimumGap : 1;
};

const getInitialView = (chart, initialVisiblePoints = null) => {
  const categories = getChartCategories(chart)
    .map((category) => category.value)
    .sort((left, right) => left - right);
  if (categories.length) {
    const requestedCount =
      Number.isFinite(initialVisiblePoints) && initialVisiblePoints > 0
        ? Math.max(1, Math.floor(initialVisiblePoints))
        : categories.length;
    const visible = categories.slice(-requestedCount);
    const first = visible[0];
    const last = visible[visible.length - 1];
    const firstIndex = categories.indexOf(first);
    const lastIndex = categories.lastIndexOf(last);
    const leftGap =
      firstIndex > 0
        ? first - categories[firstIndex - 1]
        : visible[1] - first || 1;
    const rightGap =
      lastIndex + 1 < categories.length
        ? categories[lastIndex + 1] - last
        : last - visible[visible.length - 2] || leftGap;
    return {
      xMin: first - leftGap / 2,
      xMax: last + rightGap / 2,
    };
  }
  const { minX, maxX } = getChartXBounds(chart);
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
    return { xMin: 0, xMax: 1 };
  }
  if (minX === maxX) {
    const span =
      Number.isFinite(initialVisiblePoints) && initialVisiblePoints > 0
        ? Math.max(10, initialVisiblePoints)
        : 10;
    const nextMax = maxX + span * JUMP_LATEST_RIGHT_PADDING_RATIO;
    return { xMin: nextMax - span, xMax: nextMax };
  }
  let span = maxX - minX;
  if (Number.isFinite(initialVisiblePoints) && initialVisiblePoints > 0) {
    span = Math.min(span, initialVisiblePoints);
    const nextMax = maxX + span * JUMP_LATEST_RIGHT_PADDING_RATIO;
    return { xMin: nextMax - span, xMax: nextMax };
  }
  return {
    xMin: minX,
    xMax: maxX + span * JUMP_LATEST_RIGHT_PADDING_RATIO,
  };
};

const getYRange = (chart, xMin, xMax, width, suppliedDescriptor) => {
  const descriptor =
    suppliedDescriptor || resolveChartDescriptor(chart);
  let minY = Infinity;
  let maxY = -Infinity;
  let renderedPoints = 0;
  let bucketSize = 1;
  chart.series.forEach((series) => {
    const visible = series.getVisiblePoints(xMin, xMax, width);
    renderedPoints += visible.pointCount;
    bucketSize = Math.max(bucketSize, visible.bucketSize);
    for (let index = 0; index < visible.y.length; index += 1) {
      minY = Math.min(minY, visible.y[index]);
      maxY = Math.max(maxY, visible.y[index]);
    }
  });

  const fixedMinY = Number(chart.yRange?.min);
  const fixedMaxY = Number(chart.yRange?.max);
  if (
    Number.isFinite(fixedMinY) &&
    Number.isFinite(fixedMaxY) &&
    fixedMinY < fixedMaxY
  ) {
    return {
      minY: fixedMinY,
      maxY: fixedMaxY,
      renderedPoints,
      bucketSize,
    };
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return { minY: 0, maxY: 1, renderedPoints, bucketSize };
  }
  if (descriptor.rangeIncludesZero) {
    if (minY >= 0) {
      return {
        minY: 0,
        maxY: maxY === 0 ? 1 : maxY * 1.08,
        renderedPoints,
        bucketSize,
      };
    }
    if (maxY <= 0) {
      return {
        minY: minY === 0 ? -1 : minY * 1.08,
        maxY: 0,
        renderedPoints,
        bucketSize,
      };
    }
  }
  if (minY === maxY) {
    minY -= 1;
    maxY += 1;
  }
  const padding = (maxY - minY) * 0.08;
  return {
    minY: minY - padding,
    maxY: maxY + padding,
    renderedPoints,
    bucketSize,
  };
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
  const absolute = Math.abs(value);
  if (absolute !== 0 && absolute < 0.0001) return value.toExponential(2);
  if (absolute < 1) return trimFormattedNumber(value.toPrecision(5));
  if (absolute >= 100000) return value.toFixed(0);
  if (absolute >= 1000) return trimFormattedNumber(value.toFixed(1));
  if (absolute >= 10) return trimFormattedNumber(value.toFixed(2));
  return trimFormattedNumber(value.toFixed(4));
};

const formatCompactNumber = (value) => {
  if (!Number.isFinite(value)) return "";
  const absolute = Math.abs(value);
  if (absolute >= 1000000000) {
    return `${(value / 1000000000).toFixed(
      absolute >= 10000000000 ? 0 : 1,
    )}B`;
  }
  if (absolute >= 1000000) {
    return `${(value / 1000000).toFixed(
      absolute >= 10000000 ? 0 : 1,
    )}M`;
  }
  if (absolute >= 1000) {
    return `${(value / 1000).toFixed(absolute >= 10000 ? 0 : 1)}k`;
  }
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

const getScaledYRangeForLayout = ({
  chart,
  descriptor,
  state,
  plot,
  yScaleRef,
  yCenterOffsetRef,
}) =>
  applyYScale(
    getYRange(
      chart,
      state.xMin,
      state.xMax,
      getCategoryPixelLength(chart, plot, descriptor),
      descriptor,
    ),
    yScaleRef.current.get(chart.id) ?? 1,
    yCenterOffsetRef.current.get(chart.id) ?? 0,
  );

const applyRectangleZoom = ({
  chart,
  descriptor: suppliedDescriptor,
  plot,
  start,
  end,
  initialVisiblePoints,
  viewStateRef,
  yScaleRef,
  yCenterOffsetRef,
  yManualScaleRef,
}) => {
  const rect = normalizeRect(
    clampPointToPlot(start, plot),
    clampPointToPlot(end, plot),
  );
  if (!rect || rect.width < 6 || rect.height < 6) return false;
  const descriptor =
    suppliedDescriptor || resolveChartDescriptor(chart);
  const state =
    viewStateRef.current.get(chart.id) ||
    getInitialView(chart, initialVisiblePoints);
  const currentYRange = getScaledYRangeForLayout({
    chart,
    descriptor,
    state,
    plot,
    yScaleRef,
    yCenterOffsetRef,
  });
  const transform = createCoordinateTransform({
    orientation: descriptor.orientation,
    categoryRange: { min: state.xMin, max: state.xMax },
    valueRange: {
      min: currentYRange.minY,
      max: currentYRange.maxY,
    },
    plot,
  });
  const selected = transform.dataBoundsForRect(rect);
  if (
    selected.categoryMax - selected.categoryMin <
      getMinimumCategorySpan(chart)
  ) {
    return false;
  }
  const selectedSpan = selected.valueMax - selected.valueMin;
  if (!Number.isFinite(selectedSpan) || selectedSpan <= 0) return false;

  viewStateRef.current.set(chart.id, {
    xMin: selected.categoryMin,
    xMax: selected.categoryMax,
  });
  const baseYRange = getYRange(
    chart,
    selected.categoryMin,
    selected.categoryMax,
    getCategoryPixelLength(chart, plot, descriptor),
    descriptor,
  );
  const baseSpan = baseYRange.maxY - baseYRange.minY;
  if (Number.isFinite(baseSpan) && baseSpan > 0) {
    const selectedCenter = (selected.valueMin + selected.valueMax) / 2;
    const baseCenter = (baseYRange.minY + baseYRange.maxY) / 2;
    yScaleRef.current.set(
      chart.id,
      Math.min(
        Y_SCALE_MAX,
        Math.max(Y_SCALE_MIN, selectedSpan / baseSpan),
      ),
    );
    yCenterOffsetRef.current.set(chart.id, selectedCenter - baseCenter);
    yManualScaleRef.current.add(chart.id);
  }
  return true;
};

const screenPointToDataPoint = ({
  point,
  chart,
  descriptor: suppliedDescriptor,
  plot,
  initialVisiblePoints,
  viewStateRef,
  yScaleRef,
  yCenterOffsetRef,
}) => {
  const descriptor =
    suppliedDescriptor || resolveChartDescriptor(chart);
  const state =
    viewStateRef.current.get(chart.id) ||
    getInitialView(chart, initialVisiblePoints);
  const yRange = getScaledYRangeForLayout({
    chart,
    descriptor,
    state,
    plot,
    yScaleRef,
    yCenterOffsetRef,
  });
  return createCoordinateTransform({
    orientation: descriptor.orientation,
    categoryRange: { min: state.xMin, max: state.xMax },
    valueRange: { min: yRange.minY, max: yRange.maxY },
    plot,
  }).screenToData(point);
};

const dataPointToScreenPoint = ({
  point,
  state,
  yRange,
  plot,
  orientation = "vertical",
}) =>
  createCoordinateTransform({
    orientation,
    categoryRange: { min: state.xMin, max: state.xMax },
    valueRange: { min: yRange.minY, max: yRange.maxY },
    plot,
  }).dataToScreen(point);

const createAxisOverlay = ({
  chart,
  descriptor,
  plot,
  state,
  yRange,
  seriesEndpoints,
  seriesOrderByChart,
}) => {
  const horizontal = descriptor.orientation === "horizontal";
  const transform = createCoordinateTransform({
    orientation: descriptor.orientation,
    categoryRange: { min: state.xMin, max: state.xMax },
    valueRange: { min: yRange.minY, max: yRange.maxY },
    plot: { x: 0, y: 0, width: plot.width, height: plot.height },
  });
  const ticks = Array.from({ length: Y_AXIS_TICK_COUNT }, (_, index) => {
    const ratio = index / (Y_AXIS_TICK_COUNT - 1);
    const value = yRange.maxY - ratio * (yRange.maxY - yRange.minY);
    const screen = transform.dataToScreen({
      x: state.xMin,
      y: value,
    });
    return {
      id: `${chart.id}-tick-${index}`,
      value,
      top: horizontal ? undefined : screen.y,
      left: horizontal ? screen.x : undefined,
    };
  });
  const categories = getChartCategories(chart);
  const visibleCategories = categories.filter(
    (category) =>
      category.value >= state.xMin && category.value <= state.xMax,
  ).sort((left, right) => left.value - right.value);
  const categoryPixelLength = horizontal ? plot.height : plot.width;
  const maximumCategoryLabels = Math.max(
    1,
    Math.floor(categoryPixelLength / (horizontal ? 22 : 72)),
  );
  const categoryLabelStride = Math.max(
    1,
    Math.ceil(visibleCategories.length / maximumCategoryLabels),
  );
  const displayedCategories = visibleCategories.filter(
    (_, index) =>
      index % categoryLabelStride === 0 ||
      index === visibleCategories.length - 1,
  );
  const xTicks = categories.length
    ? displayedCategories.map((category, index) => {
        const screen = transform.dataToScreen({
          x: category.value,
          y: yRange.minY,
        });
        return {
          id: `${chart.id}-category-${index}-${category.value}`,
          categorical: true,
          label: category.label,
          value: category.value,
          left: horizontal ? undefined : screen.x,
          top: horizontal ? screen.y : undefined,
        };
      })
    : Array.from({ length: X_AXIS_TICK_COUNT }, (_, index) => {
        const ratio = index / (X_AXIS_TICK_COUNT - 1);
        return {
          id: `${chart.id}-x-tick-${index}`,
          value: state.xMin + ratio * (state.xMax - state.xMin),
          left: horizontal
            ? undefined
            : 18 + ratio * Math.max(1, plot.width - 36),
          top: horizontal
            ? 10 + ratio * Math.max(1, plot.height - 20)
            : undefined,
        };
      });
  const latestValues = descriptor.capabilities.latestValue
    ? getOrderedSeries(chart, seriesOrderByChart)
        .map((series) => {
          if (!series.length) return null;
          const value = series.rawY[series.length - 1];
          const x = series.rawX[series.length - 1];
          const endpoint = seriesEndpoints.get(series.id) || { x, y: value };
          const screen = transform.dataToScreen(endpoint);
          return {
            id: series.id,
            color: series.color,
            textColor: getSeriesLabelTextColor(series),
            value: endpoint.y,
            rawValue: value,
            x,
            left: screen.x,
            top: screen.y,
          };
        })
        .filter(
          (item) =>
            item &&
            Number.isFinite(item.top) &&
            item.top >= -10 &&
            item.top <= plot.height + 10,
        )
    : [];
  const { maxX } = getChartXBounds(chart);
  return {
    orientation: descriptor.orientation,
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
  rendererRegistry,
  antialiasLines = false,
  layouts,
  viewStateRef,
  yScaleRef,
  yCenterOffsetRef,
  initialVisiblePoints,
  getAppendAnimatedPoint,
  movingAverageByChart,
  seriesOrderByChart,
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
  const now = performance.now();
  const nextAxisOverlays = {};

  layouts.forEach((layout) => {
    if (!layout.visible) return;
    const { chart, plot } = layout;
    const descriptor =
      layout.descriptor || getChartDescriptor(chart);
    const state =
      viewStateRef.current.get(chart.id) ||
      getInitialView(chart, initialVisiblePoints);
    const scaledPlot = {
      x: plot.x * dpr,
      y: plot.y * dpr,
      width: plot.width * dpr,
      height: plot.height * dpr,
    };
    const categoryPixelLength = getCategoryPixelLength(
      chart,
      plot,
      descriptor,
    );
    const yRange = applyYScale(
      getYRange(
        chart,
        state.xMin,
        state.xMax,
        categoryPixelLength,
        descriptor,
      ),
      yScaleRef.current.get(chart.id) ?? 1,
      yCenterOffsetRef.current.get(chart.id) ?? 0,
    );
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(
      Math.floor(scaledPlot.x),
      Math.floor(pixelHeight - scaledPlot.y - scaledPlot.height),
      Math.ceil(scaledPlot.width),
      Math.ceil(scaledPlot.height),
    );
    const result = rendererRegistry.draw(descriptor.rendererType, {
      antialiasLines,
      categoryPixelLength,
      chart,
      descriptor,
      dpr,
      getAppendAnimatedPoint,
      movingAverage: movingAverageByChart?.[chart.id],
      now,
      pixelHeight,
      pixelWidth,
      plot,
      scaledPlot,
      seriesOrderByChart,
      state,
      yRange,
    });
    nextAxisOverlays[chart.id] = createAxisOverlay({
      chart,
      descriptor,
      plot,
      state,
      yRange,
      seriesEndpoints: result?.seriesEndpoints || new Map(),
      seriesOrderByChart,
    });
    gl.disable(gl.SCISSOR_TEST);
  });
  gl.disable(gl.BLEND);
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
  drawChartLayouts,
  getChartXBounds,
  getChartType,
  getChartOrientation,
  getOrderedSeries,
  getPlotPadding,
  getCategoryPixelLength,
  getMinimumCategorySpan,
  validateChartSeries,
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

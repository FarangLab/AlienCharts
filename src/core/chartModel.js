const LINE_CAPABILITIES = Object.freeze({
  appendAnimation: true,
  drawings: true,
  latestValue: true,
  markers: true,
  movingAverage: true,
});

const BAR_CAPABILITIES = Object.freeze({
  appendAnimation: false,
  drawings: false,
  latestValue: false,
  markers: false,
  movingAverage: false,
});

const CHART_DEFINITIONS = Object.freeze({
  line: Object.freeze({
    capabilities: LINE_CAPABILITIES,
    defaultOrientation: "vertical",
    orientationFromSeries: false,
    orientations: Object.freeze(["vertical"]),
    rangeIncludesZero: false,
  }),
  bar: Object.freeze({
    capabilities: BAR_CAPABILITIES,
    defaultOrientation: "vertical",
    orientationFromSeries: true,
    orientations: Object.freeze(["vertical", "horizontal"]),
    rangeIncludesZero: true,
  }),
});

export const getChartCategories = (chart) => {
  if (chart?.categories == null) return [];
  if (!Array.isArray(chart.categories)) {
    throw new TypeError(`Chart "${chart.id}" categories must be an array`);
  }
  const values = new Set();
  return chart.categories.map((category, index) => {
    const normalized =
      typeof category === "string"
        ? { value: index, label: category }
        : { value: Number(category?.value), label: category?.label };
    if (
      !Number.isFinite(normalized.value) ||
      typeof normalized.label !== "string"
    ) {
      throw new TypeError(
        `Chart "${chart.id}" category ${index} must be a string or a { value, label } object`,
      );
    }
    if (values.has(normalized.value)) {
      throw new TypeError(
        `Chart "${chart.id}" has duplicate category value ${normalized.value}`,
      );
    }
    values.add(normalized.value);
    return normalized;
  });
};

export const getCategoryLabel = (chart, value) =>
  getChartCategories(chart).find((category) => category.value === value)
    ?.label;

export const getSeriesType = (series) => {
  if (series?.type == null) return "line";
  if (Object.prototype.hasOwnProperty.call(CHART_DEFINITIONS, series.type)) {
    return series.type;
  }
  throw new TypeError(`Unknown AlienCharts series type: "${series.type}"`);
};

export const resolveChartDescriptor = (chart) => {
  const series = Array.isArray(chart?.series) ? chart.series : [];
  const categories = getChartCategories(chart);
  const type = series.length ? getSeriesType(series[0]) : "line";
  const definition = CHART_DEFINITIONS[type];
  const orientation =
    definition.orientationFromSeries
      ? series[0]?.orientation || definition.defaultOrientation
      : definition.defaultOrientation;

  series.forEach((item) => {
    const itemType = getSeriesType(item);
    if (itemType !== type) {
      const mixedTypes = new Set([type, itemType]);
      const typeLabel =
        mixedTypes.has("line") && mixedTypes.has("bar")
          ? "line and bar"
          : `${type} and ${itemType}`;
      throw new TypeError(
        `Chart "${chart.id}" cannot mix ${typeLabel} series`,
      );
    }
    const itemOrientation =
      definition.orientationFromSeries
        ? item.orientation || definition.defaultOrientation
        : definition.defaultOrientation;
    if (!definition.orientations.includes(itemOrientation)) {
      throw new TypeError(
        `Chart "${chart.id}" has an invalid ${itemType} orientation`,
      );
    }
    if (itemOrientation !== orientation) {
      throw new TypeError(
        `Chart "${chart.id}" cannot mix ${itemType} orientations`,
      );
    }
  });

  return Object.freeze({
    capabilities: definition.capabilities,
    categorical: categories.length > 0,
    orientation,
    rangeIncludesZero: definition.rangeIncludesZero,
    rendererType: type,
    type,
  });
};

export const resolveChartDescriptors = (charts) => {
  const descriptors = new Map();
  charts.forEach((chart) => {
    descriptors.set(chart.id, resolveChartDescriptor(chart));
  });
  return descriptors;
};

export const getChartDescriptor = (chart, descriptors) =>
  descriptors?.get(chart?.id) || resolveChartDescriptor(chart);

export const getOrderedSeries = (chart, seriesOrderByChart) => {
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
  return ordered.length === series.length ? ordered : series;
};

export const CHART_TYPES = Object.freeze(Object.keys(CHART_DEFINITIONS));

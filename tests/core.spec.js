import { expect, test } from "@playwright/test";
import { createCoordinateTransform } from "../src/core/coordinateTransform.js";
import {
  getChartCategories,
  getCategoryLabel,
  getSeriesType,
  resolveChartDescriptor,
} from "../src/core/chartModel.js";
import {
  getInitialView,
  getMinimumCategorySpan,
  getYRange,
} from "../src/core/chartRenderer.js";
import {
  createBarSeries,
  createLineSeries,
  createSeries,
} from "../src/core/lodSeries.js";

const plot = { x: 10, y: 20, width: 200, height: 100 };
const categoryRange = { min: 0, max: 10 };
const valueRange = { min: -5, max: 15 };

test("coordinate transforms preserve semantic coordinates in both orientations", () => {
  const point = { x: 2.5, y: 10 };
  const vertical = createCoordinateTransform({
    orientation: "vertical",
    categoryRange,
    valueRange,
    plot,
  });
  expect(vertical.dataToScreen(point)).toEqual({ x: 60, y: 45 });
  expect(vertical.screenToData(vertical.dataToScreen(point))).toEqual(point);
  expect(vertical.categoryDragDelta(
    { x: 10, y: 20 },
    { x: 30, y: 50 },
  )).toBe(1);
  expect(vertical.valueOffsetDelta(
    { x: 10, y: 20 },
    { x: 30, y: 50 },
  )).toBe(6);

  const horizontal = createCoordinateTransform({
    orientation: "horizontal",
    categoryRange,
    valueRange,
    plot,
  });
  expect(horizontal.dataToScreen(point)).toEqual({ x: 160, y: 45 });
  expect(horizontal.screenToData(horizontal.dataToScreen(point))).toEqual(point);
  expect(horizontal.categoryDragDelta(
    { x: 10, y: 20 },
    { x: 30, y: 50 },
  )).toBe(3);
  expect(horizontal.valueOffsetDelta(
    { x: 10, y: 20 },
    { x: 30, y: 50 },
  )).toBe(-2);
});

test("chart descriptors validate types and expose feature capabilities", () => {
  expect(createSeries).toBe(createLineSeries);
  const line = createLineSeries({ id: "line", x: [0], y: [1] });
  const bar = createBarSeries({
    id: "bar",
    orientation: "horizontal",
    x: [0],
    y: [1],
  });
  const lineDescriptor = resolveChartDescriptor({
    id: "line-chart",
    series: [line],
  });
  expect(lineDescriptor).toMatchObject({
    type: "line",
    orientation: "vertical",
    capabilities: {
      appendAnimation: true,
      drawings: true,
      movingAverage: true,
    },
  });
  const barDescriptor = resolveChartDescriptor({
    id: "bar-chart",
    series: [bar],
  });
  expect(barDescriptor).toMatchObject({
    type: "bar",
    orientation: "horizontal",
    rangeIncludesZero: true,
    capabilities: {
      appendAnimation: false,
      drawings: false,
      movingAverage: false,
    },
  });
  expect(getSeriesType({ id: "legacy" })).toBe("line");
  expect(() => getSeriesType({ type: "scatter" })).toThrow(
    'Unknown AlienCharts series type: "scatter"',
  );
  expect(() => resolveChartDescriptor({
    id: "mixed",
    series: [line, bar],
  })).toThrow("cannot mix line and bar series");
});

test("chart categories support indexed and explicitly positioned labels", () => {
  const chart = {
    id: "categories",
    categories: [
      "Gemini 3.5",
      "GPT-5.6",
      { value: 4, label: "Claude 4.5" },
    ],
    series: [],
  };
  expect(resolveChartDescriptor(chart).categorical).toBe(true);
  expect(getChartCategories(chart)).toEqual([
    { value: 0, label: "Gemini 3.5" },
    { value: 1, label: "GPT-5.6" },
    { value: 4, label: "Claude 4.5" },
  ]);
  expect(getCategoryLabel(chart, 4)).toBe("Claude 4.5");
  expect(getCategoryLabel(chart, 2)).toBeUndefined();
  expect(getInitialView(chart)).toEqual({ xMin: -0.5, xMax: 5.5 });
  expect(getMinimumCategorySpan(chart)).toBe(1);
  expect(() => resolveChartDescriptor({
    id: "duplicates",
    categories: [
      { value: 1, label: "First" },
      { value: 1, label: "Second" },
    ],
    series: [],
  })).toThrow("duplicate category value 1");
});

test("line and bar range policies remain distinct", () => {
  const positiveLine = createLineSeries({
    id: "line",
    x: [0, 1],
    y: [10, 20],
  });
  const positiveBar = createBarSeries({
    id: "bar",
    x: [0, 1],
    y: [10, 20],
  });
  const lineChart = { id: "line", series: [positiveLine] };
  const barChart = { id: "bar", series: [positiveBar] };
  expect(getYRange(lineChart, 0, 1, 100).minY).toBeGreaterThan(0);
  expect(getYRange(barChart, 0, 1, 100).minY).toBe(0);

  const emptyFixed = {
    id: "empty",
    series: [],
    yRange: { min: -2, max: 2 },
  };
  expect(getYRange(emptyFixed, 0, 1, 100)).toMatchObject({
    minY: -2,
    maxY: 2,
  });
});

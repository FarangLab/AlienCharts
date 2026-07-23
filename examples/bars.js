import "../dist/aliencharts.css";
import {
  createBarSeries,
  createChartGrid,
  createLineSeries,
} from "../src/vanilla/index.js";

const categoryLabels = [
  "Gemini 3.5",
  "GPT-5.6",
  "Claude 4.5",
  "Llama 4",
  "Mistral Large",
  "Command R+",
];
const categories = categoryLabels.map((_, index) => index);
const verticalA = createBarSeries({
  id: "vertical-a",
  name: "Vertical A",
  color: "#38bdf8",
  x: categories,
  y: [6, 9, -4, 12, 7, 10],
});
const verticalB = createBarSeries({
  id: "vertical-b",
  name: "Vertical B",
  color: "#22c55e",
  x: categories,
  y: [4, 7, -2, 8, 11, 6],
});
const horizontalA = createBarSeries({
  id: "horizontal-a",
  name: "Horizontal A",
  color: "#f59e0b",
  orientation: "horizontal",
  x: categories,
  y: [5, 10, -3, 8, 13, 7],
});
const horizontalB = createBarSeries({
  id: "horizontal-b",
  name: "Horizontal B",
  color: "#a855f7",
  orientation: "horizontal",
  x: categories,
  y: [8, 6, -5, 11, 9, 12],
});

const charts = [
  {
    id: "vertical-bars",
    title: "Vertical grouped bars",
    categories: categoryLabels,
    series: [verticalA, verticalB],
  },
  {
    id: "horizontal-bars",
    title: "Horizontal grouped bars",
    categories: categoryLabels,
    series: [horizontalA, horizontalB],
  },
];

const controller = createChartGrid(document.querySelector("#app"), {
  charts,
  columns: 2,
  gridLines: true,
  drawings: [{
    id: "hidden-bar-drawing",
    chartId: "vertical-bars",
    type: "pin",
    start: { x: 10, y: 9 },
    end: { x: 10, y: 9 },
  }],
  movingAverageByChart: {
    "vertical-bars": { enabled: true, period: 2 },
  },
  topMarkers: [{ id: "hidden-bar-marker", x: 20, title: "Hidden marker" }],
});

window.alienchartsBarsExample = {
  charts,
  controller,
  append() {
    const category = categoryLabels.length;
    categoryLabels.push("Nova Pro");
    verticalA.append([category], [14]);
    verticalB.append([category], [9]);
    horizontalA.append([category], [10]);
    horizontalB.append([category], [15]);
    controller.invalidate();
  },
  validateMixedChart() {
    const line = createLineSeries({ id: "line", x: [0, 1], y: [0, 1] });
    controller.setCharts([{
      id: "invalid",
      title: "Invalid",
      series: [verticalA, line],
    }]);
  },
  validateMixedOrientation() {
    controller.setCharts([{
      id: "invalid-orientation",
      title: "Invalid orientation",
      series: [verticalA, horizontalA],
    }]);
  },
};

import "../dist/aliencharts.css";
import { createChartGrid, createLineSeries } from "../src/vanilla/index.js";

const makeSeries = (id, offset = 0) => createLineSeries({
  id,
  name: id,
  color: offset ? "#22c55e" : "#38bdf8",
  x: Array.from({ length: 200 }, (_, index) => index),
  y: Array.from({ length: 200 }, (_, index) => 20 + offset + Math.sin(index / 12) * 8),
});

const series = makeSeries("run-a");
const charts = [
  { id: "loss", title: "train/loss", pinned: true, series: [series, makeSeries("run-b", 10)] },
  { id: "accuracy", title: "eval/accuracy", series: [makeSeries("run-c", 25)] },
];
const events = [];
const controller = createChartGrid(document.querySelector("#app"), {
  charts,
  columns: 2,
  gridLines: true,
  topMarkers: [{ id: "checkpoint", x: 100, title: "Checkpoint" }],
  onDrawingsChange: (value) => events.push(["drawings", value]),
  onMovingAverageToggle: (chartId) => events.push(["moving-average", chartId]),
  onMovingAverageChange: (chartId, value) => events.push(["moving-average-change", chartId, value]),
  onTopMarkerClick: (marker) => events.push(["marker", marker.id]),
  onChartContextMenu: ({ chart, point }) => events.push(["context-menu", chart.id, point]),
});

window.alienchartsExample = {
  charts,
  controller,
  events,
  append() {
    const start = series.length;
    series.append([start, start + 1], [21, 22]);
    controller.invalidate();
  },
  setColumns(columns) {
    controller.setOptions({ columns });
  },
};

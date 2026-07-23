import "../dist/aliencharts.css";
import {
  createBarSeries,
  createChartGrid,
  createLineSeries,
} from "../src/vanilla/index.js";

const x = Array.from({ length: 80 }, (_, index) => index);
const makeLineChart = (id, color, offset) => ({
  id,
  title: id,
  series: [createLineSeries({
    id: `${id}-series`,
    name: `${id} series`,
    color,
    x,
    y: x.map((value) => offset + Math.sin(value / 8) * 5),
  })],
});
const makeBarChart = (id, color, orientation = "vertical") => ({
  id,
  title: id,
  series: [createBarSeries({
    id: `${id}-series`,
    name: `${id} series`,
    color,
    orientation,
    x: [0, 10, 20, 30, 40, 50, 60, 70],
    y: [5, 8, -3, 11, 6, 13, 9, 7],
  })],
});

const charts = [
  makeLineChart("line-first", "#38bdf8", 20),
  makeBarChart("bar-second", "#22c55e"),
  makeLineChart("line-third", "#f59e0b", 35),
  makeBarChart("bar-fourth", "#a855f7", "horizontal"),
];
const controller = createChartGrid(document.querySelector("#app"), {
  antialiasLines: true,
  charts,
  columns: 2,
  gridLines: true,
});

window.alienchartsMixedExample = {
  charts,
  controller,
  reverse() {
    controller.setCharts([...charts].reverse());
  },
};

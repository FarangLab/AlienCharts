const makeStandaloneSeries = ({
  id,
  name,
  color,
  baseline,
  amplitude,
  period,
}) => AlienCharts.createLineSeries({
  id,
  name,
  color,
  x: Array.from({ length: 100 }, (_, index) => index),
  y: Array.from(
    { length: 100 },
    (_, index) => baseline + Math.sin(index / period) * amplitude,
  ),
});

const standaloneSeries = makeStandaloneSeries({
  id: "train-loss",
  name: "Train loss",
  color: "#38bdf8",
  baseline: 20,
  amplitude: 8,
  period: 10,
});

const standaloneCharts = [
  {
    id: "train-loss",
    title: "train/loss",
    series: [standaloneSeries],
  },
  {
    id: "eval-loss",
    title: "eval/loss",
    series: [makeStandaloneSeries({
      id: "eval-loss",
      name: "Eval loss",
      color: "#22c55e",
      baseline: 16,
      amplitude: 5,
      period: 12,
    })],
  },
  {
    id: "eval-accuracy",
    title: "eval/accuracy",
    series: [makeStandaloneSeries({
      id: "eval-accuracy",
      name: "Eval accuracy",
      color: "#a855f7",
      baseline: 72,
      amplitude: 12,
      period: 16,
    })],
  },
  {
    id: "learning-rate",
    title: "train/learning_rate",
    series: [makeStandaloneSeries({
      id: "learning-rate",
      name: "Learning rate",
      color: "#f59e0b",
      baseline: 0.003,
      amplitude: 0.001,
      period: 20,
    })],
  },
];

const standaloneController = AlienCharts.createChartGrid(
  document.querySelector("#app"),
  {
    charts: standaloneCharts,
    columns: 2,
    gridLines: true,
  },
);

window.alienchartsStandaloneExample = {
  charts: standaloneCharts,
  controller: standaloneController,
  series: standaloneSeries,
  append() {
    const x = standaloneSeries.length;
    standaloneSeries.append([x], [20 + Math.sin(x / 10) * 8]);
    standaloneController.invalidate();
  },
};

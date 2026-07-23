import React, { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../dist/aliencharts.css";
import { ChartGrid, createLineSeries } from "../src/react/index.js";

const chartConfigs = [
  { id: "train-loss", title: "train/loss", color: "#38bdf8", baseline: 10, period: 8 },
  { id: "eval-loss", title: "eval/loss", color: "#22c55e", baseline: 18, period: 10 },
  { id: "accuracy", title: "eval/accuracy", color: "#a855f7", baseline: 26, period: 12 },
  { id: "learning-rate", title: "train/learning_rate", color: "#f97316", baseline: 34, period: 14 },
];

const charts = chartConfigs.map((config) => ({
  id: config.id,
  title: config.title,
  series: [createLineSeries({
    id: `${config.id}-run`,
    name: "React run",
    color: config.color,
    x: Array.from({ length: 100 }, (_, index) => index),
    y: Array.from(
      { length: 100 },
      (_, index) => config.baseline + Math.cos(index / config.period) * 4,
    ),
  })],
}));

function Example() {
  const gridRef = useRef(null);
  const [revision, setRevision] = useState(0);
  const [columns, setColumns] = useState(2);
  window.reactAlienchartsExample = {
    append() {
      charts.forEach((chart, index) => {
        const series = chart.series[0];
        const config = chartConfigs[index];
        const x = series.length;
        series.append([x], [config.baseline + Math.cos(x / config.period) * 4]);
      });
      setRevision((value) => value + 1);
    },
    setColumns,
    jumpToLatest: () => gridRef.current?.jumpToLatest(),
  };
  return <div style={{ height: "100vh" }}><ChartGrid ref={gridRef} charts={charts} columns={columns} dataRevision={revision}/></div>;
}

createRoot(document.querySelector("#app")).render(<StrictMode><Example/></StrictMode>);

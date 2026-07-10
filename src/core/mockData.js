import { createSeries } from "./lodSeries.js";

const palette = [
  "#38bdf8",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#a855f7",
  "#14b8a6",
];

const createRandom = (seed) => {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
};

const makeSeries = ({ chartIndex, seriesIndex, pointCount }) => {
  const x = new Float64Array(pointCount);
  const y = new Float32Array(pointCount);
  const random = createRandom((chartIndex + 1) * 1009 + seriesIndex * 9176);
  const baseline = 15 + random() * 45 + seriesIndex * 4;
  const waveA = 0.0008 + random() * 0.004;
  const waveB = 0.006 + random() * 0.03;
  const waveC = 0.00005 + random() * 0.0006;
  const amplitudeA = 0.015 + random() * 0.09;
  const amplitudeB = 0.005 + random() * 0.04;
  const trend = (random() - 0.5) * 0.004;
  const noise = 0.004 + random() * 0.025;
  const spikeInterval = 180 + Math.floor(random() * 900);
  const spikeMagnitude = 0.12 + random() * 0.7;
  let value = baseline;

  for (let i = 0; i < pointCount; i += 1) {
    x[i] = i;
    const spike =
      (i + chartIndex * 13 + seriesIndex * 31) % spikeInterval === 0
        ? spikeMagnitude * (random() > 0.45 ? 1 : -1)
        : 0;
    value +=
      Math.sin(i * waveA + chartIndex) * amplitudeA +
      Math.cos(i * waveB + seriesIndex) * amplitudeB +
      Math.sin(i * waveC) * amplitudeA * 0.35 +
      trend +
      (random() - 0.5) * noise +
      spike;
    y[i] = value;
  }

  return createSeries({
    id: `chart-${chartIndex}-series-${seriesIndex}`,
    name: `Run ${seriesIndex + 1}`,
    color: palette[(chartIndex + seriesIndex) % palette.length],
    x,
    y,
  });
};

export const createMockCharts = ({
  chartCount = 50,
  seriesPerChart = 2,
  pointCount = 500000,
} = {}) => {
  return Array.from({ length: chartCount }, (_, chartIndex) => ({
    id: `metric-${chartIndex + 1}`,
    title: `metric_${String(chartIndex + 1).padStart(2, "0")}`,
    series: Array.from({ length: seriesPerChart }, (_, seriesIndex) =>
      makeSeries({ chartIndex, seriesIndex, pointCount }),
    ),
  }));
};

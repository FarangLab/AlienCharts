import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChartGrid } from "../src/react/ChartGrid.jsx";
import { createMockCharts } from "../src/core/mockData.js";

const getCurrentTheme = () =>
  typeof document !== "undefined" &&
  document.documentElement.classList.contains("dark")
    ? "dark"
    : "light";

const appendPoints = (charts, pointsPerSeries) => {
  charts.forEach((chart) => {
    chart.series.forEach((series, seriesIndex) => {
      const length = series.length;
      const x = new Float64Array(pointsPerSeries);
      const y = new Float32Array(pointsPerSeries);
      let value = series.rawY[length - 1] ?? 0;
      const lastX = series.rawX[length - 1] ?? 0;
      for (let i = 0; i < pointsPerSeries; i += 1) {
        const nextIndex = length + i;
        x[i] = lastX + i + 1;
        value +=
          Math.sin(nextIndex * 0.004 + seriesIndex) * 0.04 +
          Math.cos(nextIndex * 0.021) * 0.015;
        y[i] = value;
      }
      series.append(x, y);
    });
  });
};

function DemoPage({ Button, Input, Switch }) {
  const [chartCount, setChartCount] = useState(50);
  const [pointCount, setPointCount] = useState(1000000);
  const [seriesPerChart, setSeriesPerChart] = useState(1);
  const [columns, setColumns] = useState(3);
  const [liveAppend, setLiveAppend] = useState(false);
  const [mockRevision, setMockRevision] = useState(0);
  const [dataRevision, setDataRevision] = useState(0);
  const [appendedPoints, setAppendedPoints] = useState(0);
  const [jumpToLatestRevision, setJumpToLatestRevision] = useState(0);
  const [theme, setTheme] = useState(getCurrentTheme);
  const [drawings, setDrawings] = useState([]);
  const [activeDrawingTool, setActiveDrawingTool] = useState(null);
  const [selectedDrawingId, setSelectedDrawingId] = useState(null);
  const [movingAverageByChart, setMovingAverageByChart] = useState({});
  const [charts, setCharts] = useState(() => {
    const generated = createMockCharts({
      chartCount: 30,
      pointCount: 500000,
      seriesPerChart: 1,
    });
    return generated;
  });
  const chartsRef = useRef(charts);
  const didMountRef = useRef(false);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const observer = new MutationObserver(() => {
      setTheme(getCurrentTheme());
    });
    observer.observe(document.documentElement, {
      attributeFilter: ["class"],
      attributes: true,
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    const generation = mockRevision;
    void generation;
    const generated = createMockCharts({
      chartCount,
      pointCount,
      seriesPerChart,
    });
    chartsRef.current = generated;
    setCharts(generated);
    setAppendedPoints(0);
    setDataRevision((value) => value + 1);
  }, [chartCount, pointCount, seriesPerChart, mockRevision]);

  useEffect(() => {
    chartsRef.current = charts;
  }, [charts]);

  useEffect(() => {
    if (!liveAppend) return undefined;
    const interval = setInterval(() => {
      if (!chartsRef.current) return;
      appendPoints(chartsRef.current, 250);
      setAppendedPoints((value) => value + 250);
      setDataRevision((value) => value + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [liveAppend]);

  const regenerate = () => {
    setMockRevision((value) => value + 1);
    setDataRevision((value) => value + 1);
    setAppendedPoints(0);
  };

  const appendBatch = (pointsPerSeries = 5000) => {
    if (!chartsRef.current) return;
    appendPoints(chartsRef.current, pointsPerSeries);
    setAppendedPoints((value) => value + pointsPerSeries);
    setDataRevision((value) => value + 1);
  };

  const jumpLatest = () => {
    setJumpToLatestRevision((value) => value + 1);
  };

  const createDrawingId = useCallback(
    () => `demo-drawing-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    [],
  );

  const updateMovingAverageForChart = useCallback((chartId, updater) => {
    setMovingAverageByChart((previous) => {
      const safePrevious = previous && typeof previous === "object" ? previous : {};
      const current =
        safePrevious[chartId] && typeof safePrevious[chartId] === "object"
          ? safePrevious[chartId]
          : {};
      const next = typeof updater === "function" ? updater(current) : updater;
      return {
        ...safePrevious,
        [chartId]: next,
      };
    });
  }, []);

  const handleMovingAverageToggle = useCallback(
    (chartId) => {
      updateMovingAverageForChart(chartId, (current) => {
        const enabled = !current?.enabled;
        return {
          ...current,
          enabled,
          period: Number.isFinite(Number(current?.period))
            ? Math.max(1, Math.round(Number(current.period)))
            : 21,
          type: current?.type === "sma" ? "sma" : "ema",
        };
      });
    },
    [updateMovingAverageForChart],
  );

  const handleMovingAverageChange = useCallback(
    (chartId, nextMovingAverage) => {
      updateMovingAverageForChart(chartId, {
        ...nextMovingAverage,
        enabled: true,
        period: Number.isFinite(Number(nextMovingAverage?.period))
          ? Math.max(1, Math.round(Number(nextMovingAverage.period)))
          : 21,
        type: nextMovingAverage?.type === "sma" ? "sma" : "ema",
      });
    },
    [updateMovingAverageForChart],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-3 py-2 text-sm">
        <div className="font-semibold">AlienCharts Demo</div>
        <label className="flex items-center gap-1.5 text-muted-foreground">
          Charts
          <Input
            className="h-7 w-20"
            min={1}
            max={100}
            type="number"
            value={chartCount}
            onChange={(event) =>
              setChartCount(Math.max(1, Number(event.target.value) || 1))
            }
          />
        </label>
        <label className="flex items-center gap-1.5 text-muted-foreground">
          Points
          <Input
            className="h-7 w-28"
            min={1000}
            step={50000}
            type="number"
            value={pointCount}
            onChange={(event) =>
              setPointCount(Math.max(1000, Number(event.target.value) || 1000))
            }
          />
        </label>
        <label className="flex items-center gap-1.5 text-muted-foreground">
          Series
          <Input
            className="h-7 w-16"
            min={1}
            max={6}
            type="number"
            value={seriesPerChart}
            onChange={(event) =>
              setSeriesPerChart(Math.max(1, Number(event.target.value) || 1))
            }
          />
        </label>
        <label className="flex items-center gap-1.5 text-muted-foreground">
          Columns
          <Input
            className="h-7 w-16"
            min={1}
            max={6}
            type="number"
            value={columns}
            onChange={(event) =>
              setColumns(Math.max(1, Number(event.target.value) || 1))
            }
          />
        </label>
        <label className="flex items-center gap-2 text-muted-foreground">
          <Switch checked={liveAppend} onCheckedChange={setLiveAppend} />
          Live append
        </label>
        <Button size="sm" variant="outline" onClick={regenerate}>
          Regenerate
        </Button>
        <Button size="sm" variant="outline" onClick={() => appendBatch()}>
          Append 5K
        </Button>
        <Button size="sm" variant="outline" onClick={jumpLatest}>
          Jump latest
        </Button>
        <div className="ml-auto text-xs text-muted-foreground">
          {chartCount} charts / {seriesPerChart} series /{" "}
          {(pointCount + appendedPoints).toLocaleString()} points
          {appendedPoints > 0
            ? ` / +${appendedPoints.toLocaleString()} live`
            : ""}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <ChartGrid
          // antialiasLines
          activeDrawingTool={activeDrawingTool}
          backgroundColor={theme === "dark" ? "#101935" : "#f5f9ff"}
          charts={charts}
          columns={columns}
          dataRevision={dataRevision}
          drawings={drawings}
          initialVisiblePoints={250000}
          jumpToLatestRevision={jumpToLatestRevision}
          movingAverageByChart={movingAverageByChart}
          selectedDrawingId={selectedDrawingId}
          createDrawingId={createDrawingId}
          onActiveDrawingToolChange={setActiveDrawingTool}
          onDrawingsChange={setDrawings}
          onMovingAverageChange={handleMovingAverageChange}
          onMovingAverageToggle={handleMovingAverageToggle}
          onSelectedDrawingIdChange={setSelectedDrawingId}
        />
      </div>
    </div>
  );
}

export default DemoPage;

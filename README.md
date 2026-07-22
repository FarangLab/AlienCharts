<h1 align="center">
  <img src="./assets/aliencharts_logo_small.png" alt="AlienCharts logo" width="88" height="88"><br>
  <img src="./assets/aliencharts_title.svg" alt="AlienCharts" height="42">
</h1>

GPU-rendered chart grid for multi-metric dashboards — such as monitoring AI training runs, where you need many live-updating charts with millions of points each.

By rendering every series with WebGL, AlienCharts keeps dense chart grids smooth where SVG/Canvas libraries stall.

> **Note:** AlienCharts currently supports **line charts** only. Other chart types may be added in the future.

![AlienCharts chart grid example](./assets/chartgrid.png)

![AlienCharts chart drawings example](./assets/chartdrawings.png)

## Features

- **High performance** — render many metrics in a grid with millions of points each, all drawn through a single shared WebGL context.
- **Live data** — append points to a series and the chart follows the latest values.
- **Level of Detail (LOD)** — each zoom level draws only the points it needs.
- **Chart interactions** — crosshair, zoom, pan, fullscreen mode, drawings, and moving averages. All have their own hotkeys.

## Installation

```bash
npm install aliencharts
```

Import the self-contained stylesheet once:

```js
import "aliencharts/styles.css";
```

Dark mode follows a `.dark` class on any ancestor element (e.g. `<html class="dark">`).

## Vanilla Web

```html
<div id="charts" style="height: 100vh"></div>
```

```js
import "aliencharts/styles.css";
import { createChartGrid, createSeries } from "aliencharts/vanilla";

const series = createSeries({
  id: "run-1",
  name: "Run 1",
  color: "#38bdf8",
  x: [0, 1, 2, 3, 4],
  y: [2.5, 1.9, 1.4, 1.1, 0.9],
});

const grid = createChartGrid(document.querySelector("#charts"), {
  charts: [{ id: "loss", title: "train/loss", series: [series] }],
  columns: 2,
});

// Stream data into an existing series and schedule a render.
series.append([5, 6], [0.8, 0.72]);
grid.invalidate();

grid.setOptions({ columns: 3, followLatest: true });
grid.jumpToLatest();

// Release DOM listeners, observers, animation frames, and WebGL resources.
grid.destroy();
```

`createChartGrid()` returns:

| Method | Description |
| --- | --- |
| `setOptions(partialOptions)` | Update formatting, controls, callbacks, state, or layout. |
| `setCharts(charts)` | Replace the chart array and reconcile chart/GPU state. |
| `invalidate()` | Notify the grid after appending or mutating series data. |
| `jumpToLatest(chartId?)` | Move one chart, or every chart, to its latest values. |
| `scrollToTop(options?)` | Scroll the grid container to the top. |
| `destroy()` | Dispose the controller. |

See the [Vanilla Web example source](https://github.com/FarangLab/AlienCharts/blob/main/examples/vanilla.js) for a more complete setup.

## React

If you use React in your application, import the React entry point:

```jsx
import { useRef, useState } from "react";
import "aliencharts/styles.css";
import { ChartGrid, createSeries } from "aliencharts/react";

const series = createSeries({
  id: "run-1",
  x: [0, 1, 2, 3, 4],
  y: [2.5, 1.9, 1.4, 1.1, 0.9],
});

export default function Dashboard() {
  const gridRef = useRef(null);
  const [dataRevision, setDataRevision] = useState(0);

  const append = () => {
    series.append([series.length], [Math.random()]);
    setDataRevision((value) => value + 1);
  };

  return (
    <div style={{ height: "100vh" }}>
      <button onClick={append}>Append</button>
      <ChartGrid
        ref={gridRef}
        charts={[{ id: "loss", title: "train/loss", series: [series] }]}
        dataRevision={dataRevision}
      />
    </div>
  );
}
```

See the [React demo source](https://github.com/FarangLab/AlienCharts/blob/main/examples/DemoPage.jsx) for a larger controlled-state example.

## Shared data API

Framework-neutral data helpers are also available from the package root:

```js
import { createSeries, createMockCharts, LineSeries } from "aliencharts";
```

`createSeries(options)` accepts an id, optional name/color, X/Y arrays or typed arrays, and an optional maximum LOD level count. Its `append(xValues, yValues)` method efficiently extends the typed backing arrays.

Charts have the shape `{ id, title, series }` and may additionally define `pinned` and a fixed `{ min, max }` Y range.

## Common options

| Option | Default | Description |
| --- | --- | --- |
| `charts` | required | Chart objects to render. |
| `columns` | `2` | Responsive grid column count. |
| `initialVisiblePoints` | all | Initial X window size. |
| `backgroundColor` | `#f5f9ff` | Chart background. |
| `antialiasLines` | `false` | GPU-expanded antialiased lines. |
| `gridLines` | `false` | Boolean or `{ xSpacing, ySpacing }`. |
| `showToolbar` | `true` | Focused-chart toolbar. |
| `showLatestValueLine` | `true` | Latest value connector and label. |
| `showTooltips` | `true` | Crosshair and nearest-value tooltip. |
| `followLatest` | `false` | Always follow appended values. |
| `followVisibleLatest` | `true` | Follow appends when the latest point was visible. |
| `drawings` | `[]` | Initial or replacement drawing state. |
| `movingAverageByChart` | `{}` | Moving-average state keyed by chart id. |
| `topMarkers` | `[]` | Clickable markers positioned by `x` or `step`. |
| `disableDrawings` | `false` | Disable drawing and moving-average controls. |

Drawing, selection, active-tool, moving-average, marker, clearing, and context-menu callbacks work in both entry points. The controller updates its own state before emitting change callbacks; passing an explicit replacement through `setOptions()` or React props synchronizes external state back into it.

Supported drawing tools are `trendline`, `hline`, `vline`, and `pin`. Context-menu payloads contain `{ chart, event, point }`, where `event` is a native `MouseEvent` and `point` is the data coordinate when the click is inside the plot.

## Examples

The example files are development examples in the repository and are not included in the installed npm package. From a cloned repository, run:

```bash
npm install
npm run build
npm run examples
```

Then open:

- Vanilla Web: <http://127.0.0.1:4178/examples/vanilla.html>
- React: <http://127.0.0.1:4178/examples/react.html>

## License

[MIT](./LICENSE) © FarangLab.

Bundled Phosphor SVG paths are covered by the notice in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).

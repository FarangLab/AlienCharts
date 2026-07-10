# AlienCharts

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

`react` and `react-dom` (v18+) are peer dependencies, so make sure they are installed in your app.

## Quick start

Build an array of `charts`, where each chart has an `id`, a `title`, and one or more `series` created with `createSeries`. Pass them to `<ChartGrid>`:

```jsx
import { ChartGrid, createSeries } from "aliencharts";

const charts = [
  {
    id: "loss",
    title: "train/loss",
    series: [
      createSeries({
        id: "run-1",
        name: "Run 1",
        color: "#38bdf8",
        x: [0, 1, 2, 3, 4],
        y: [2.5, 1.9, 1.4, 1.1, 0.9],
      }),
    ],
  },
];

export default function Dashboard() {
  return <ChartGrid charts={charts} columns={2} />;
}
```

For a fuller example, including live appending and theming — see [`examples/DemoPage.jsx`](./examples/DemoPage.jsx).

## API

### `createSeries(options)`

Creates a line series.

| Option | Type | Description |
| --- | --- | --- |
| `id` | `string` | Unique series id. |
| `name` | `string` | Display name (defaults to `id`). |
| `color` | `string` | CSS color of the line (defaults to `#38bdf8`). |
| `x` | `number[] \| Float64Array` | X values (e.g. step / time). |
| `y` | `number[] \| Float32Array` | Y values. |

The returned series has an `append(xValues, yValues)` method for streaming in new points.

### `createMockCharts(options?)`

Generates an array of charts with synthetic data for demos and benchmarking. Options: `chartCount`, `seriesPerChart`, `pointCount`.

### `<ChartGrid>`

Renders a responsive grid of charts. Commonly used props:

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `charts` | `Chart[]` | — | Charts to render. Each is `{ id, title, series }`. |
| `columns` | `number` | `2` | Number of columns in the grid. |
| `dataRevision` | `number` | `0` | Bump this after appending points to trigger a re-render. |
| `followLatest` | `boolean` | `false` | Keep the view pinned to the newest data. |
| `xAxisLabel` | `string` | `"STEP"` | Label shown on the x-axis. |
| `backgroundColor` | `string` | — | Chart background color. |
| `antialiasLines` | `boolean` | `false` | Enable line antialiasing. |

## License

[MIT](./LICENSE) © FarangLab

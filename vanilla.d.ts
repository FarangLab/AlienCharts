export * from "./index.js";

import type { Chart, ChartGridOptions } from "./index.js";

export interface ChartGridController {
  setOptions(options: Partial<ChartGridOptions>): void;
  setCharts(charts: Chart[]): void;
  invalidate(): void;
  jumpToLatest(chartId?: string): void;
  scrollToTop(options?: ScrollToOptions): void;
  destroy(): void;
}

export function createChartGrid(
  container: HTMLElement,
  options: ChartGridOptions,
): ChartGridController;

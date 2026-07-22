export * from "./index.js";

import type {
  ForwardRefExoticComponent,
  RefAttributes,
} from "react";
import type { ChartGridOptions } from "./index.js";

export interface ChartGridProps extends ChartGridOptions {
  className?: string;
  dataRevision?: number;
}

export interface ChartGridHandle {
  invalidate(): void;
  jumpToLatest(chartId?: string): void;
  scrollToTop(options?: ScrollToOptions): void;
}

export const ChartGrid: ForwardRefExoticComponent<
  ChartGridProps & RefAttributes<ChartGridHandle>
>;

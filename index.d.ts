export type NumericArray =
  | number[]
  | Float32Array
  | Float64Array
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array;

export interface SeriesOptions {
  id: string;
  name?: string;
  color?: string;
  x?: NumericArray;
  y?: NumericArray;
  maxLevels?: number;
}

export interface VisibleSeriesPoints {
  x: Float64Array;
  y: Float32Array;
  bucketSize: number;
  pointCount: number;
}

export class LineSeries {
  constructor(options: SeriesOptions);

  id: string;
  name: string;
  color: string;
  maxLevels: number;
  readonly length: number;
  rawX: Float64Array;
  rawY: Float32Array;

  append(xValues: NumericArray, yValues: NumericArray): void;
  getVisiblePoints(
    xMin: number,
    xMax: number,
    pixelWidth: number,
  ): VisibleSeriesPoints;
}

export interface Chart {
  id: string;
  title: string;
  series: LineSeries[];
  pinned?: boolean;
  yRange?: {
    min: number;
    max: number;
  };
  [key: string]: unknown;
}

export interface DataPoint {
  x: number;
  y: number;
}

export type DrawingTool = "trendline" | "hline" | "vline" | "pin";

export interface DrawingStyle {
  color?: string;
  lineWidth?: number;
  dashPattern?: number[];
  extendLeft?: boolean;
  extendRight?: boolean;
  text?: string;
}

export interface Drawing {
  id: string;
  chartId: string;
  type: DrawingTool;
  start: DataPoint;
  end: DataPoint;
  createdAt?: number;
  style?: DrawingStyle;
}

export interface MovingAverage {
  enabled?: boolean;
  period?: number;
  type?: "ema" | "sma";
  hideBase?: boolean;
}

export interface TopMarker<T = unknown> {
  id?: string | number;
  x?: number;
  step?: number;
  color?: string;
  title?: string;
  ariaLabel?: string;
  data?: T;
  [key: string]: unknown;
}

export interface ChartContextMenuPayload {
  chart: Chart;
  event: MouseEvent;
  point: DataPoint | null;
}

export interface CreateDrawingIdPayload {
  chartId: string;
  type: DrawingTool;
}

export interface ChartGridOptions {
  charts: Chart[];
  columns?: number;
  initialVisiblePoints?: number | null;
  backgroundColor?: string;
  antialiasLines?: boolean;
  gridLines?: boolean | {
    /** Horizontal distance in pixels between vertical grid lines. */
    xSpacing?: number;
    /** Vertical distance in pixels between horizontal grid lines. */
    ySpacing?: number;
  };
  showToolbar?: boolean;
  showLatestValueLine?: boolean;
  showTooltips?: boolean;
  followLatest?: boolean;
  followVisibleLatest?: boolean;
  drawings?: Drawing[];
  onDrawingsChange?: (drawings: Drawing[]) => void;
  activeDrawingTool?: DrawingTool | null;
  onActiveDrawingToolChange?: (tool: DrawingTool | null) => void;
  selectedDrawingId?: string | null;
  onSelectedDrawingIdChange?: (drawingId: string | null) => void;
  createDrawingId?: (payload: CreateDrawingIdPayload) => string;
  onClearDrawingsRequest?: (chartId: string) => void;
  onChartContextMenu?: (payload: ChartContextMenuPayload) => void;
  movingAverageByChart?: Record<string, MovingAverage>;
  onMovingAverageToggle?: (chartId: string) => void;
  onMovingAverageChange?: (
    chartId: string,
    movingAverage: MovingAverage,
  ) => void;
  seriesOrderByChart?: Record<string, number[]>;
  topMarkers?: TopMarker[];
  onTopMarkerClick?: (marker: TopMarker) => void;
  xAxisLabel?: string;
  disableDrawings?: boolean;
  formatXTick?: (value: number) => string;
  formatXValue?: (value: number) => string;
  formatYValue?: (value: number) => string;
}

export interface MockChartsOptions {
  chartCount?: number;
  seriesPerChart?: number;
  pointCount?: number;
}

export function createSeries(options: SeriesOptions): LineSeries;
export function createMockCharts(options?: MockChartsOptions): Chart[];

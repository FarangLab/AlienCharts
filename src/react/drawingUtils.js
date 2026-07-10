export const DEFAULT_DRAWING_COLOR = "#60a5fa";
export const DRAWING_HIT_DISTANCE = 8;
export const DRAWING_HANDLE_RADIUS = 4;
export const DRAWING_HANDLE_HIT_DISTANCE = 10;
export const PIN_HIT_DISTANCE = 14;
export const DRAWING_TOOLS = new Set(["trendline", "hline", "vline", "pin"]);

export const getDrawingStyle = (drawing) => ({
  color: drawing?.style?.color || DEFAULT_DRAWING_COLOR,
  lineWidth: Number.isFinite(drawing?.style?.lineWidth)
    ? drawing.style.lineWidth
    : 2,
  dashPattern: Array.isArray(drawing?.style?.dashPattern)
    ? drawing.style.dashPattern
    : [],
  extendLeft: Boolean(drawing?.style?.extendLeft),
  extendRight: drawing?.style?.extendRight !== false,
  text: typeof drawing?.style?.text === "string" ? drawing.style.text : "",
});

export const getDrawingsForChart = (drawings, chartId) =>
  Array.isArray(drawings)
    ? drawings.filter((drawing) => drawing?.chartId === chartId)
    : [];

export const getDefaultDrawingStyle = (type) => ({
  color: DEFAULT_DRAWING_COLOR,
  lineWidth: 2,
  dashPattern: [],
  extendLeft: false,
  extendRight: type !== "vline",
  text: "",
});

export const createDrawing = ({
  chartId,
  type,
  start,
  end,
  createDrawingId,
}) => {
  const id =
    createDrawingId?.({ chartId, type }) ||
    `${chartId}-drawing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    chartId,
    type,
    start,
    end,
    createdAt: Date.now(),
    style: getDefaultDrawingStyle(type),
  };
};

export const createDraftDrawing = ({ chartId, type, start, end }) => ({
  id: "__draft__",
  chartId,
  type,
  start,
  end,
  createdAt: Date.now(),
  style: getDefaultDrawingStyle(type),
});

export const getDrawingGeometry = ({ drawing, layout, projectPoint }) => {
  if (!drawing?.start || !drawing?.end) return null;
  const start = projectPoint(drawing.start, layout);
  const end = projectPoint(drawing.end, layout);
  const style = getDrawingStyle(drawing);
  let lineStart = start;
  let lineEnd = end;

  if (drawing.type === "pin") {
    return { start, end: start, lineStart: start, lineEnd: start, style };
  }

  if (drawing.type === "hline") {
    const lineEndX =
      Math.abs(end.x - start.x) > 0.000001 ? end.x : layout.plot.x + layout.plot.width;
    lineStart = {
      x: style.extendRight ? layout.plot.x : start.x,
      y: start.y,
    };
    lineEnd = {
      x: style.extendRight ? layout.plot.x + layout.plot.width : lineEndX,
      y: start.y,
    };
  } else if (drawing.type === "vline") {
    lineStart = {
      x: start.x,
      y: layout.plot.y,
    };
    lineEnd = {
      x: start.x,
      y: layout.plot.y + layout.plot.height,
    };
  } else if (drawing.type === "trendline") {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (Math.abs(dx) > 0.000001) {
      if (style.extendLeft) {
        const leftX = layout.plot.x;
        lineStart = {
          x: leftX,
          y: start.y + (dy / dx) * (leftX - start.x),
        };
      }
      if (style.extendRight) {
        const rightX = layout.plot.x + layout.plot.width;
        lineEnd = {
          x: rightX,
          y: start.y + (dy / dx) * (rightX - start.x),
        };
      }
    }
  }

  return { start, end, lineStart, lineEnd, style };
};

export const distanceToSegment = (point, start, end) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy),
    ),
  );
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
};

export const hitTestDrawing = ({ point, drawing, layout, projectPoint }) => {
  const geometry = getDrawingGeometry({
    drawing,
    layout,
    projectPoint,
  });
  if (!geometry) return null;
  if (
    drawing.type !== "pin" &&
    Math.hypot(point.x - geometry.start.x, point.y - geometry.start.y) <=
    DRAWING_HANDLE_HIT_DISTANCE
  ) {
    return { drawing, endpoint: "start" };
  }
  if (
    drawing.type === "pin" &&
    Math.hypot(point.x - geometry.start.x, point.y - geometry.start.y) <=
      PIN_HIT_DISTANCE
  ) {
    return { drawing, endpoint: "move" };
  }
  if (
    drawing.type === "trendline" &&
    Math.hypot(point.x - geometry.end.x, point.y - geometry.end.y) <=
      DRAWING_HANDLE_HIT_DISTANCE
  ) {
    return { drawing, endpoint: "end" };
  }
  const distance = distanceToSegment(point, geometry.lineStart, geometry.lineEnd);
  return distance <= DRAWING_HIT_DISTANCE ? { drawing, endpoint: null } : null;
};

export const updateDrawingById = (drawings, drawingId, updater) =>
  (Array.isArray(drawings) ? drawings : []).map((drawing) =>
    drawing?.id === drawingId ? updater(drawing) : drawing,
  );

export const removeDrawingById = (drawings, drawingId) =>
  (Array.isArray(drawings) ? drawings : []).filter(
    (drawing) => drawing?.id !== drawingId,
  );

const safeSpan = (min, max) => Math.max(0.000000000001, max - min);

export const createCoordinateTransform = ({
  orientation = "vertical",
  categoryRange,
  valueRange,
  plot,
}) => {
  const horizontal = orientation === "horizontal";
  const categorySpan = safeSpan(categoryRange.min, categoryRange.max);
  const valueSpan = safeSpan(valueRange.min, valueRange.max);
  const categoryPixelLength = horizontal ? plot.height : plot.width;
  const valuePixelLength = horizontal ? plot.width : plot.height;

  const categoryRatio = (point) =>
    horizontal
      ? (point.y - plot.y) / plot.height
      : (point.x - plot.x) / plot.width;

  const valueRatio = (point) =>
    horizontal
      ? (point.x - plot.x) / plot.width
      : 1 - (point.y - plot.y) / plot.height;

  const dataToScreen = (point) => {
    const category = point.category ?? point.x;
    const value = point.value ?? point.y;
    const categoryPosition =
      (category - categoryRange.min) / categorySpan;
    const valuePosition = (value - valueRange.min) / valueSpan;
    return horizontal
      ? {
          x: plot.x + valuePosition * plot.width,
          y: plot.y + categoryPosition * plot.height,
        }
      : {
          x: plot.x + categoryPosition * plot.width,
          y: plot.y + (1 - valuePosition) * plot.height,
        };
  };

  const screenToData = (point) => ({
    x: categoryRange.min + categoryRatio(point) * categorySpan,
    y: valueRange.min + valueRatio(point) * valueSpan,
  });

  const categoryDragDelta = (start, current) =>
    ((horizontal ? current.y - start.y : current.x - start.x) /
      categoryPixelLength) *
    categorySpan;

  const valueOffsetDelta = (start, current) =>
    horizontal
      ? -((current.x - start.x) / valuePixelLength) * valueSpan
      : ((current.y - start.y) / valuePixelLength) * valueSpan;

  const categoryScaleDelta = (start, current) =>
    horizontal ? current.y - start.y : current.x - start.x;

  const valueScaleDelta = (start, current) =>
    horizontal ? current.x - start.x : current.y - start.y;

  const dataBoundsForRect = (rect) => {
    const first = screenToData({ x: rect.left, y: rect.top });
    const second = screenToData({
      x: rect.left + rect.width,
      y: rect.top + rect.height,
    });
    return {
      categoryMin: Math.min(first.x, second.x),
      categoryMax: Math.max(first.x, second.x),
      valueMin: Math.min(first.y, second.y),
      valueMax: Math.max(first.y, second.y),
    };
  };

  return Object.freeze({
    categoryDragDelta,
    categoryPixelLength,
    categoryRatio,
    categoryScaleDelta,
    dataBoundsForRect,
    dataToScreen,
    horizontal,
    orientation,
    screenToData,
    valueOffsetDelta,
    valuePixelLength,
    valueRatio,
    valueScaleDelta,
  });
};

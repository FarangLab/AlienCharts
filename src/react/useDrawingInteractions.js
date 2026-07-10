import { useCallback, useEffect, useRef, useState } from "react";
import {
  DRAWING_TOOLS,
  createDraftDrawing,
  createDrawing,
  removeDrawingById,
} from "./drawingUtils.js";

export function useDrawingInteractions({
  drawings,
  onDrawingsChange,
  activeDrawingTool,
  onActiveDrawingToolChange,
  selectedDrawingId,
  onSelectedDrawingIdChange,
  createDrawingId,
  focusedChartId = null,
  requireFocusedChart = false,
  onModeChange,
}) {
  const drawingSessionRef = useRef({ chartId: null, startPoint: null });
  const drawingEditRef = useRef(null);
  const [draftDrawing, setDraftDrawing] = useState(null);

  const clearDraft = useCallback(() => {
    setDraftDrawing(null);
    drawingSessionRef.current = { chartId: null, startPoint: null };
  }, []);

  const cancelDrawing = useCallback(() => {
    onActiveDrawingToolChange?.(null);
    onSelectedDrawingIdChange?.(null);
    setDraftDrawing(null);
    drawingSessionRef.current = { chartId: null, startPoint: null };
    drawingEditRef.current = null;
  }, [onActiveDrawingToolChange, onSelectedDrawingIdChange]);

  const toggleDrawingTool = useCallback(
    (tool) => {
      if (!DRAWING_TOOLS.has(tool)) return;
      if (requireFocusedChart && !focusedChartId) return;
      onModeChange?.();
      clearDraft();
      onActiveDrawingToolChange?.(activeDrawingTool === tool ? null : tool);
    },
    [
      activeDrawingTool,
      clearDraft,
      focusedChartId,
      onActiveDrawingToolChange,
      onModeChange,
      requireFocusedChart,
    ],
  );

  const commitDrawing = useCallback(
    ({ chartId, type, start, end }) => {
      const drawing = createDrawing({
        chartId,
        type,
        start,
        end,
        createDrawingId,
      });
      onDrawingsChange?.([...(Array.isArray(drawings) ? drawings : []), drawing]);
      onSelectedDrawingIdChange?.(drawing.id);
      onActiveDrawingToolChange?.(null);
      clearDraft();
    },
    [
      clearDraft,
      createDrawingId,
      drawings,
      onActiveDrawingToolChange,
      onDrawingsChange,
      onSelectedDrawingIdChange,
    ],
  );

  const startDraftDrawing = useCallback(
    ({ chartId, type, start, end = start }) => {
      drawingSessionRef.current = { chartId, startPoint: start };
      setDraftDrawing(createDraftDrawing({ chartId, type, start, end }));
    },
    [],
  );

  const updateDraftDrawing = useCallback(({ chartId, type, start, end }) => {
    setDraftDrawing(createDraftDrawing({ chartId, type, start, end }));
  }, []);

  const startEditDrawing = useCallback(({ drawingId, endpoint }) => {
    drawingEditRef.current = {
      id: drawingId,
      endpoint: endpoint || "move",
    };
  }, []);

  const finishEditDrawing = useCallback(() => {
    drawingEditRef.current = null;
  }, []);

  const deleteSelectedDrawing = useCallback(() => {
    if (!selectedDrawingId) return false;
    onDrawingsChange?.(removeDrawingById(drawings, selectedDrawingId));
    onSelectedDrawingIdChange?.(null);
    return true;
  }, [
    drawings,
    onDrawingsChange,
    onSelectedDrawingIdChange,
    selectedDrawingId,
  ]);

  useEffect(() => {
    if (activeDrawingTool) return;
    clearDraft();
  }, [activeDrawingTool, clearDraft]);

  return {
    draftDrawing,
    drawingSessionRef,
    drawingEditRef,
    clearDraft,
    cancelDrawing,
    toggleDrawingTool,
    commitDrawing,
    startDraftDrawing,
    updateDraftDrawing,
    startEditDrawing,
    finishEditDrawing,
    deleteSelectedDrawing,
  };
}

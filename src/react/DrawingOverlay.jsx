import React from "react";
import {
  DRAWING_HANDLE_RADIUS,
  getDrawingGeometry,
  getDrawingsForChart,
} from "./drawingUtils.js";

const getClipId = (chartId) =>
  `drawing-clip-${String(chartId).replace(/[^a-zA-Z0-9_-]/g, "_")}`;

function PinDrawing({ drawing, geometry, selected }) {
  const text = geometry.style.text.trim();
  return (
    <g opacity={drawing.id === "__draft__" ? 0.72 : 1}>
      <g transform={`translate(${geometry.start.x} ${geometry.start.y})`}>
        <path
          d="M0 -11 C-6 -11 -10 -6 -10 -1 C-10 6 -2 12 0 15 C2 12 10 6 10 -1 C10 -6 6 -11 0 -11 Z"
          fill={geometry.style.color}
          stroke="var(--background, #ffffff)"
          strokeWidth="1.5"
        />
        <circle cx="0" cy="-2" r="3" fill="var(--background, #ffffff)" opacity="0.9" />
      </g>
      {text ? (
        <text
          x={geometry.start.x + 14}
          y={geometry.start.y}
          fill={geometry.style.color}
          stroke="var(--background, #ffffff)"
          strokeWidth="3"
          paintOrder="stroke"
          fontSize="12"
          fontWeight="600"
          dominantBaseline="middle"
        >
          {text}
        </text>
      ) : null}
      {selected ? (
        <circle
          cx={geometry.start.x}
          cy={geometry.start.y}
          r={DRAWING_HANDLE_RADIUS}
          fill={geometry.style.color}
          stroke="var(--background, #ffffff)"
          strokeWidth="1.5"
        />
      ) : null}
    </g>
  );
}

export function DrawingOverlay({
  layouts,
  drawings,
  draftDrawing,
  selectedDrawingId,
  projectPoint,
  height = "100%",
}) {
  const allDrawings = draftDrawing
    ? [...(Array.isArray(drawings) ? drawings : []), draftDrawing]
    : Array.isArray(drawings)
      ? drawings
      : [];

  if (!allDrawings.length) return null;

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 z-20 block overflow-visible"
      style={{ width: "100%", height }}
    >
      <defs>
        {layouts.map((layout) => (
          <clipPath key={getClipId(layout.chart.id)} id={getClipId(layout.chart.id)}>
            <rect
              x={layout.plot.x}
              y={layout.plot.y}
              width={layout.plot.width}
              height={layout.plot.height}
            />
          </clipPath>
        ))}
      </defs>
      {layouts.flatMap((layout) =>
        getDrawingsForChart(allDrawings, layout.chart.id)
          .map((drawing) => {
            const geometry = getDrawingGeometry({
              drawing,
              layout,
              projectPoint,
            });
            if (!geometry) return null;
            const selected =
              drawing.id === selectedDrawingId || drawing.id === "__draft__";
            const dashArray = geometry.style.dashPattern.length
              ? geometry.style.dashPattern.join(" ")
              : undefined;

            if (drawing.type === "pin") {
              return (
                <g key={drawing.id} clipPath={`url(#${getClipId(layout.chart.id)})`}>
                  <PinDrawing
                    drawing={drawing}
                    geometry={geometry}
                    selected={selected}
                  />
                </g>
              );
            }

            return (
              <g key={drawing.id} clipPath={`url(#${getClipId(layout.chart.id)})`}>
                <line
                  x1={geometry.lineStart.x}
                  y1={geometry.lineStart.y}
                  x2={geometry.lineEnd.x}
                  y2={geometry.lineEnd.y}
                  stroke={geometry.style.color}
                  strokeWidth={geometry.style.lineWidth}
                  strokeDasharray={dashArray}
                  opacity={drawing.id === "__draft__" ? 0.72 : 1}
                />
                {selected ? (
                  <>
                    <circle
                      cx={geometry.start.x}
                      cy={geometry.start.y}
                      r={DRAWING_HANDLE_RADIUS}
                      fill={geometry.style.color}
                      stroke="var(--background, #ffffff)"
                      strokeWidth="1.5"
                    />
                    {drawing.type === "trendline" ? (
                      <circle
                        cx={geometry.end.x}
                        cy={geometry.end.y}
                        r={DRAWING_HANDLE_RADIUS}
                        fill={geometry.style.color}
                        stroke="var(--background, #ffffff)"
                        strokeWidth="1.5"
                      />
                    ) : null}
                  </>
                ) : null}
              </g>
            );
          })
          .filter(Boolean),
      )}
    </svg>
  );
}

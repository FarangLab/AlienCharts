import { createBarRenderer } from "./barRenderer.js";
import { createLineRenderer } from "./lineRenderer.js";

const RENDERER_FACTORIES = Object.freeze({
  bar: createBarRenderer,
  line: createLineRenderer,
});

export const createRendererRegistry = (gl) => {
  const renderers = new Map(
    Object.entries(RENDERER_FACTORIES).map(([type, createRenderer]) => [
      type,
      createRenderer(gl),
    ]),
  );

  return {
    draw(type, payload) {
      const renderer = renderers.get(type);
      if (!renderer) {
        throw new TypeError(`No AlienCharts renderer registered for "${type}"`);
      }
      return renderer.draw(payload);
    },

    getTooltipCategory(type, payload) {
      const renderer = renderers.get(type);
      if (!renderer) {
        throw new TypeError(`No AlienCharts renderer registered for "${type}"`);
      }
      return renderer.getTooltipCategory?.(payload) ??
        payload.visiblePoints.x[payload.pointIndex];
    },

    destroy() {
      renderers.forEach((renderer) => renderer.destroy());
      renderers.clear();
    },
  };
};

import React, {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import { createChartGrid } from "../vanilla/createChartGrid.js";

export const ChartGrid = forwardRef(function ChartGrid({
  className = "",
  dataRevision = 0,
  ...options
}, ref) {
  const hostRef = useRef(null);
  const controllerRef = useRef(null);
  const previousOptionsRef = useRef(null);
  const previousRevisionRef = useRef(dataRevision);

  useLayoutEffect(() => {
    const controller = createChartGrid(hostRef.current, options);
    controllerRef.current = controller;
    previousOptionsRef.current = options;
    return () => {
      controller.destroy();
      controllerRef.current = null;
      previousOptionsRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const controller = controllerRef.current;
    const previous = previousOptionsRef.current;
    if (!controller || !previous) return;
    const changed = {};
    let hasChanges = false;
    const keys = new Set([...Object.keys(previous), ...Object.keys(options)]);
    keys.forEach((key) => {
      if (Object.is(previous[key], options[key])) return;
      changed[key] = options[key];
      hasChanges = true;
    });
    if (hasChanges) controller.setOptions(changed);
    previousOptionsRef.current = options;
  });

  useLayoutEffect(() => {
    if (previousRevisionRef.current !== dataRevision) {
      previousRevisionRef.current = dataRevision;
      controllerRef.current?.invalidate();
    }
  }, [dataRevision]);

  useImperativeHandle(ref, () => ({
    invalidate: () => controllerRef.current?.invalidate(),
    jumpToLatest: (chartId) => controllerRef.current?.jumpToLatest(chartId),
    scrollToTop: (scrollOptions) => controllerRef.current?.scrollToTop(scrollOptions),
  }), []);

  return <div ref={hostRef} className={className} />;
});

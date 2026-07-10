import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

export const APPEND_ANIMATION_SETTINGS = {
  enabled: true,
  durationMs: 300,
  maxBucketSize: 64, // Zoom threshold
  maxRevealPoints: 100, // Larger appends skips in-between points
};

const easeOutQuad = (value) => 1 - (1 - value) * (1 - value);

export function useAppendAnimations({
  charts,
  dataRevision,
  requestRender,
  settings = APPEND_ANIMATION_SETTINGS,
}) {
  const latestPointRef = useRef(new Map());
  const animationsRef = useRef(new Map());
  const animationRafRef = useRef(null);

  const stopAnimationLoop = useCallback(() => {
    if (animationRafRef.current != null) {
      cancelAnimationFrame(animationRafRef.current);
      animationRafRef.current = null;
    }
  }, []);

  const startAnimationLoop = useCallback(() => {
    if (!settings.enabled || animationRafRef.current != null) return;

    const tick = () => {
      const now = performance.now();
      let hasActiveAnimation = false;
      animationsRef.current.forEach((animation, seriesId) => {
        if (now - animation.startedAt >= animation.duration) {
          animationsRef.current.delete(seriesId);
        } else {
          hasActiveAnimation = true;
        }
      });

      requestRender();
      animationRafRef.current = hasActiveAnimation
        ? requestAnimationFrame(tick)
        : null;
    };

    animationRafRef.current = requestAnimationFrame(tick);
  }, [requestRender, settings.enabled]);

  useEffect(() => {
    if (!settings.enabled) {
      animationsRef.current.clear();
      stopAnimationLoop();
    }
  }, [settings.enabled, stopAnimationLoop]);

  useLayoutEffect(() => {
    if (!settings.enabled) return;

    const now = performance.now();
    charts.forEach((chart) => {
      chart.series.forEach((series) => {
        if (series.length === 0) return;
        const next = {
          x: series.rawX[series.length - 1],
          y: series.rawY[series.length - 1],
          length: series.length,
        };
        const previous = latestPointRef.current.get(series.id);

        if (
          previous &&
          Number.isFinite(previous.x) &&
          Number.isFinite(previous.y) &&
          next.x > previous.x
        ) {
          animationsRef.current.set(series.id, {
            fromX: previous.x,
            fromY: previous.y,
            toX: next.x,
            toY: next.y,
            appendedCount: next.length - previous.length,
            startedAt: now,
            duration: settings.durationMs,
          });
          startAnimationLoop();
        }

        latestPointRef.current.set(series.id, next);
      });
    });
  }, [
    charts,
    dataRevision,
    settings.durationMs,
    settings.enabled,
    startAnimationLoop,
  ]);

  useEffect(() => stopAnimationLoop, [stopAnimationLoop]);

  const getAppendAnimatedPoint = useCallback(
    ({ seriesId, visiblePoints, now }) => {
      if (
        !settings.enabled ||
        visiblePoints.bucketSize > settings.maxBucketSize
      ) {
        return null;
      }

      const animation = animationsRef.current.get(seriesId);
      if (
        !animation ||
        visiblePoints.x[0] > animation.fromX ||
        visiblePoints.x[visiblePoints.pointCount - 1] < animation.toX
      ) {
        return null;
      }

      let stableCount = 0;
      while (
        stableCount < visiblePoints.pointCount &&
        visiblePoints.x[stableCount] <= animation.fromX
      ) {
        stableCount += 1;
      }

      if (stableCount === 0) return null;

      const progress = Math.min(
        1,
        Math.max(0, (now - animation.startedAt) / animation.duration),
      );
      const eased = easeOutQuad(progress);

      if (animation.appendedCount <= settings.maxRevealPoints) {
        const appendedVisibleCount = visiblePoints.pointCount - stableCount;
        const revealPosition = eased * appendedVisibleCount;
        const revealedPoints = Math.min(
          appendedVisibleCount,
          Math.floor(revealPosition),
        );
        const nextIndex = Math.min(
          visiblePoints.pointCount - 1,
          stableCount + revealedPoints,
        );
        const previousIndex = Math.max(stableCount - 1, nextIndex - 1);
        const partial = revealPosition - revealedPoints;
        const hasPartial = revealedPoints < appendedVisibleCount;
        const x = hasPartial
          ? visiblePoints.x[previousIndex] +
            (visiblePoints.x[nextIndex] - visiblePoints.x[previousIndex]) *
              partial
          : visiblePoints.x[nextIndex];
        const y = hasPartial
          ? visiblePoints.y[previousIndex] +
            (visiblePoints.y[nextIndex] - visiblePoints.y[previousIndex]) *
              partial
          : visiblePoints.y[nextIndex];

        return {
          index: nextIndex,
          pointCount: Math.min(visiblePoints.pointCount, nextIndex + 1),
          x,
          y,
        };
      }

      return {
        index: stableCount,
        pointCount: stableCount + 1,
        x: animation.fromX + (animation.toX - animation.fromX) * eased,
        y: animation.fromY + (animation.toY - animation.fromY) * eased,
      };
    },
    [settings.enabled, settings.maxBucketSize, settings.maxRevealPoints],
  );

  return { getAppendAnimatedPoint };
}

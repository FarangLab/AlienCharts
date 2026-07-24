import { expect, test } from "@playwright/test";

test("standalone global build renders, updates, and cleans up", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/examples/standalone.html");

  const exports = await page.evaluate(() => [
    "BarSeries",
    "LineSeries",
    "createBarSeries",
    "createChartGrid",
    "createLineSeries",
    "createMockCharts",
    "createSeries",
  ].filter((name) => typeof window.AlienCharts?.[name] !== "function"));
  expect(exports).toEqual([]);
  await expect(page.locator("[data-chart-index]")).toHaveCount(4);
  await expect.poll(() => page.evaluate(() =>
    getComputedStyle(
      document.querySelector("[data-chart-index]").parentElement,
    ).gridTemplateColumns.split(" ").length,
  )).toBe(2);
  await expect(page.locator("canvas")).toHaveAttribute("width", /[1-9]/);

  await page.evaluate(() => window.alienchartsStandaloneExample.append());
  await expect.poll(() => page.evaluate(() =>
    window.alienchartsStandaloneExample.series.length,
  )).toBe(101);

  await page.evaluate(() =>
    window.alienchartsStandaloneExample.controller.destroy(),
  );
  await expect(page.locator("#app > *")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("vanilla renders, updates, interacts, and cleans up", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/examples/vanilla.html");
  await expect(page.locator("[data-chart-index]")).toHaveCount(2);
  await expect(page.locator("canvas")).toHaveAttribute("width", /[1-9]/);
  await page.getByRole("button", { name: "Checkpoint" }).first().click();
  await expect.poll(() => page.evaluate(() => window.alienchartsExample.events.some(([name]) => name === "marker"))).toBeTruthy();

  await page.locator("[data-chart-index]").first().click({ position: { x: 150, y: 120 } });
  await expect(page.getByRole("button", { name: "Maximize chart" })).toBeVisible();
  const initialLineView = await page.evaluate(() => {
    const { controller } = window.alienchartsExample;
    const state = controller.viewStates.get("loss");
    return {
      scale: controller.yScales.get("loss"),
      span: state.xMax - state.xMin,
    };
  });
  await page.locator("[data-chart-index]").first().hover({
    position: { x: 300, y: 160 },
  });
  await page.keyboard.down("Shift");
  await page.mouse.wheel(0, -400);
  await page.keyboard.up("Shift");
  await expect.poll(() => page.evaluate(() =>
    window.alienchartsExample.controller.yScales.get("loss"),
  )).toBeLessThan(initialLineView.scale);
  const lineViewAfterVerticalZoom = await page.evaluate(() => {
    const state = window.alienchartsExample.controller.viewStates.get("loss");
    return state.xMax - state.xMin;
  });
  expect(lineViewAfterVerticalZoom).toBeCloseTo(initialLineView.span, 5);
  await page.evaluate(() =>
    window.alienchartsExample.controller.resetChart("loss"),
  );
  await page.getByRole("button", { name: "Toggle moving average" }).click();
  await expect.poll(() => page.evaluate(() => window.alienchartsExample.events.some(([name]) => name === "moving-average"))).toBeTruthy();
  await page.locator("[data-moving-period]").fill("34");
  await expect(page.locator("[data-moving-period]")).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.alienchartsExample.controller.movingAverageByChart.loss.period)).toBe(34);
  await page.getByRole("button", { name: "Draw trendline" }).click();
  await expect.poll(() => page.evaluate(() => window.alienchartsExample.controller.activeDrawingTool)).toBe("trendline");
  const cellBox = await page.locator("[data-chart-index]").first().boundingBox();
  await page.mouse.click(cellBox.x + 200, cellBox.y + 100);
  await expect.poll(() => page.evaluate(() => Boolean(window.alienchartsExample.controller.drawingSession))).toBeTruthy();
  await expect.poll(() => page.evaluate(() => window.alienchartsExample.controller.drawings.length)).toBe(0);
  await page.mouse.move(cellBox.x + 100, cellBox.y + 180);
  await expect(page.locator("[data-drawing-line]")).toHaveCount(1);
  await page.mouse.click(cellBox.x + 100, cellBox.y + 180);
  await expect.poll(() => page.evaluate(() => window.alienchartsExample.events.some(([name]) => name === "drawings"))).toBeTruthy();
  const extendedTrendline = await page.locator("[data-drawing-line]").evaluate((line) => ({
    x1: Number(line.getAttribute("x1")),
    x2: Number(line.getAttribute("x2")),
    startX: Number(document.querySelector('[data-drawing-anchor="start"]').getAttribute("cx")),
    endX: Number(document.querySelector('[data-drawing-anchor="end"]').getAttribute("cx")),
  }));
  expect(Math.min(extendedTrendline.x1, extendedTrendline.x2)).toBeLessThanOrEqual(extendedTrendline.endX);
  expect(Math.max(extendedTrendline.x1, extendedTrendline.x2)).toBeGreaterThanOrEqual(extendedTrendline.startX);
  const drawingOptionsBox = await page.locator("[data-drawing-options]").boundingBox();
  expect(drawingOptionsBox.x + drawingOptionsBox.width).toBeLessThanOrEqual(cellBox.x + cellBox.width + 1);
  await page.locator("[data-drawing-color]").fill("#ef4444");
  await expect.poll(() => page.evaluate(() => window.alienchartsExample.controller.drawings[0].style.color)).toBe("#ef4444");
  await page.getByRole("button", { name: "Place pin" }).click();
  await page.locator("[data-chart-index]").first().click({ position: { x: 300, y: 160 } });
  await page.locator("[data-pin-text]").fill("release marker");
  await expect(page.locator("[data-pin-text]")).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.alienchartsExample.controller.drawings.at(-1).style.text)).toBe("release marker");
  await page.locator("[data-chart-index]").first().dispatchEvent("contextmenu", { clientX: 250, clientY: 140, button: 2 });
  await expect.poll(() => page.evaluate(() => window.alienchartsExample.events.some(([name]) => name === "context-menu"))).toBeTruthy();
  await page.locator("[data-chart-index]").first().hover({ position: { x: 260, y: 150 } });
  await expect(page.getByText(/STEP:/)).toBeVisible();
  await expect.poll(() => page.locator("[data-crosshair-tooltip]").evaluate((node) => getComputedStyle(node).backdropFilter)).not.toBe("none");
  await page.mouse.move(cellBox.x + 380, cellBox.y + 240);
  await page.mouse.down();
  await page.mouse.move(cellBox.x + 480, cellBox.y + 260);
  await expect.poll(() => page.evaluate(() => ({
    crosshairX: window.alienchartsExample.controller.crosshair.x,
    pointX: window.alienchartsExample.controller.crosshair.points[0].x,
  }))).toMatchObject({ crosshairX: cellBox.x + 480 });
  const dragCrosshair = await page.evaluate(() => window.alienchartsExample.controller.crosshair);
  expect(Math.abs(dragCrosshair.points[0].x - dragCrosshair.x)).toBeLessThan(5);
  await page.mouse.up();
  await page.evaluate(() => window.alienchartsExample.setColumns(1));
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector("[data-chart-index]").parentElement).gridTemplateColumns.split(" ").length)).toBe(1);

  await page.evaluate(() => window.alienchartsExample.append());
  await expect.poll(() => page.evaluate(() => window.alienchartsExample.charts[0].series[0].length)).toBe(202);
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Maximize chart" }).first().dispatchEvent("click");
  await expect(page.locator("[data-aliencharts-fullscreen]")).toBeVisible();
  await page.getByRole("button", { name: "Exit fullscreen" }).click();
  await expect(page.locator("[data-aliencharts-fullscreen]")).toHaveCount(0);

  await page.evaluate(() => window.alienchartsExample.controller.destroy());
  await expect(page.locator("#app > *")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("zoomed drawings are clipped to their owning chart plot", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/examples/vanilla.html");
  const cells = page.locator("[data-chart-index]");
  const firstCell = await cells.first().boundingBox();
  const secondCell = await cells.nth(1).boundingBox();

  await page.evaluate(() => {
    const { controller } = window.alienchartsExample;
    controller.setOptions({
      drawings: [{
        id: "offscreen-vline",
        chartId: "loss",
        type: "vline",
        start: { x: 30, y: 0 },
        end: { x: 30, y: 0 },
      }],
    });
    controller.viewStates.set("loss", { xMin: 0, xMax: 20 });
    controller.requestRender();
  });

  const line = page.locator('[data-drawing-chart="loss"] [data-drawing-line]');
  await expect(line).toHaveCount(1);
  const projectedX = Number(await line.getAttribute("x1"));
  expect(projectedX).toBeGreaterThan(secondCell.x);
  expect(projectedX).toBeLessThan(secondCell.x + secondCell.width);

  const drawingGroup = page.locator('[data-drawing-chart="loss"]');
  await expect(drawingGroup).toHaveAttribute(
    "clip-path",
    /drawing-clip-grid/,
  );
  const clipRect = page.locator('[data-drawing-clip="loss"]');
  const clip = await clipRect.evaluate((node) => ({
    x: Number(node.getAttribute("x")),
    width: Number(node.getAttribute("width")),
  }));
  expect(clip.x).toBeGreaterThanOrEqual(firstCell.x);
  expect(clip.x + clip.width).toBeLessThanOrEqual(
    firstCell.x + firstCell.width,
  );
  expect(errors).toEqual([]);
});

test("React adapter survives Strict Mode and synchronizes updates", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/examples/react.html");
  await expect(page.locator("[data-chart-index]")).toHaveCount(4);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector("[data-chart-index]").parentElement).gridTemplateColumns.split(" ").length)).toBe(2);
  await page.evaluate(() => window.reactAlienchartsExample.append());
  await page.evaluate(() => window.reactAlienchartsExample.setColumns(1));
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector("[data-chart-index]").parentElement).gridTemplateColumns.split(" ").length)).toBe(1);
  await expect(page.locator("[data-chart-index]")).toHaveCount(4);
  expect(errors).toEqual([]);
});

test("GPU bar charts render and interact in both orientations", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/examples/bars.html");
  const cells = page.locator("[data-chart-index]");
  await expect(cells).toHaveCount(2);
  await expect(page.getByText("Vertical grouped bars")).toBeVisible();
  await expect(page.getByText("Horizontal grouped bars")).toBeVisible();

  const gpuError = await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() =>
      requestAnimationFrame(resolve)));
    const canvas = document.querySelector("canvas");
    const gl = canvas.getContext("webgl2");
    gl.finish();
    return gl.getError();
  });
  expect(gpuError).toBe(0);
  const canvasImage = await page.locator("canvas").screenshot();
  expect(canvasImage.byteLength).toBeGreaterThan(5000);

  const horizontalCategoryAxis = cells.nth(1).locator("[data-x-axis]");
  const horizontalValueAxis = cells.nth(1).locator("[data-y-axis]");
  await expect(horizontalCategoryAxis).toHaveCSS("left", "0px");
  await expect(horizontalCategoryAxis).toHaveCSS("width", "128px");
  await expect(horizontalValueAxis).toHaveCSS("bottom", "0px");
  await expect(cells.first().locator("[data-category-label]")).toHaveCount(6);
  await expect(cells.nth(1).locator("[data-category-label]")).toHaveCount(6);
  await expect(
    cells.nth(1).locator("[data-category-label]", { hasText: "Gemini 3.5" }),
  ).toBeVisible();

  await cells.first().hover({ position: { x: 220, y: 150 } });
  await expect(page.locator("[data-crosshair-tooltip]")).toBeVisible();
  await expect(page.getByText("Vertical A")).toBeVisible();
  await expect(page.locator("[data-crosshair-tooltip]")).toContainText(
    /MODEL: (Gemini 3\.5|GPT-5\.6|Claude 4\.5|Llama 4|Mistral Large|Command R\+)/,
  );

  await cells.nth(1).hover({ position: { x: 220, y: 150 } });
  await expect(page.getByText("Horizontal A")).toBeVisible();
  await cells.nth(1).click({ position: { x: 220, y: 150 } });
  await expect(page.getByRole("button", { name: "Maximize chart" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Draw trendline" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Toggle moving average" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Hidden marker" })).toHaveCount(0);
  await expect(page.locator("[data-drawing-line]")).toHaveCount(0);
  await expect(page.locator("[data-latest-lines] > *")).toHaveCount(0);

  const initialSpan = await page.evaluate(() => {
    const state = window.alienchartsBarsExample.controller.viewStates
      .get("horizontal-bars");
    return state.xMax - state.xMin;
  });
  const horizontalBox = await cells.nth(1).boundingBox();
  await page.mouse.move(horizontalBox.x + 220, horizontalBox.y + 150);
  await page.mouse.wheel(0, -400);
  await expect.poll(() => page.evaluate(() => {
    const state = window.alienchartsBarsExample.controller.viewStates
      .get("horizontal-bars");
    return state.xMax - state.xMin;
  })).toBeLessThan(initialSpan);
  await page.getByRole("button", { name: "Reset chart" }).click();
  await expect.poll(() => page.evaluate(() => {
    const state = window.alienchartsBarsExample.controller.viewStates
      .get("horizontal-bars");
    return state.xMax - state.xMin;
  })).toBeCloseTo(initialSpan, 5);

  for (const [index, chartId] of [
    [0, "vertical-bars"],
    [1, "horizontal-bars"],
  ]) {
    const initialView = await page.evaluate((id) => {
      const { controller } = window.alienchartsBarsExample;
      const state = controller.viewStates.get(id);
      return {
        scale: controller.yScales.get(id),
        span: state.xMax - state.xMin,
      };
    }, chartId);
    const box = await cells.nth(index).boundingBox();
    await page.mouse.move(box.x + 220, box.y + 150);
    await page.keyboard.down("Shift");
    await page.mouse.wheel(0, -400);
    await page.keyboard.up("Shift");
    await expect.poll(() => page.evaluate((id) =>
      window.alienchartsBarsExample.controller.yScales.get(id),
    chartId)).toBeLessThan(initialView.scale);
    const categorySpan = await page.evaluate((id) => {
      const state = window.alienchartsBarsExample.controller.viewStates.get(id);
      return state.xMax - state.xMin;
    }, chartId);
    expect(categorySpan).toBeCloseTo(initialView.span, 5);
    await page.evaluate((id) =>
      window.alienchartsBarsExample.controller.resetChart(id),
    chartId);
  }

  await page.getByRole("button", { name: "Maximize chart" }).click();
  await expect(page.locator("[data-aliencharts-fullscreen]")).toBeVisible();
  await page.getByRole("button", { name: "Exit fullscreen" }).click();
  await expect(page.locator("[data-aliencharts-fullscreen]")).toHaveCount(0);

  const previousMax = await page.evaluate(() =>
    window.alienchartsBarsExample.controller.viewStates
      .get("horizontal-bars").xMax);
  await page.evaluate(() => window.alienchartsBarsExample.append());
  await expect.poll(() =>
    page.evaluate(() =>
      window.alienchartsBarsExample.charts[0].series[0].length),
  ).toBe(7);
  await expect(
    cells.nth(1).locator("[data-category-label]", { hasText: "Nova Pro" }),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    window.alienchartsBarsExample.controller.viewStates
      .get("horizontal-bars").xMax),
  ).toBeGreaterThan(previousMax);

  const validationMessage = await page.evaluate(() => {
    try {
      window.alienchartsBarsExample.validateMixedChart();
      return "";
    } catch (error) {
      return error.message;
    }
  });
  expect(validationMessage).toContain("cannot mix line and bar series");
  const orientationMessage = await page.evaluate(() => {
    try {
      window.alienchartsBarsExample.validateMixedOrientation();
      return "";
    } catch (error) {
      return error.message;
    }
  });
  expect(orientationMessage).toContain("cannot mix bar orientations");
  expect(errors).toEqual([]);
});

test("line and bar renderers safely alternate on one antialiased surface", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/examples/mixed.html");
  const cells = page.locator("[data-chart-index]");
  await expect(cells).toHaveCount(4);
  await expect(page.getByText("line-first", { exact: true })).toBeVisible();
  await expect(page.getByText("bar-fourth", { exact: true })).toBeVisible();

  const assertGpuSurface = async () => {
    const gpuError = await page.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(() =>
        requestAnimationFrame(resolve)));
      const gl = document.querySelector("canvas").getContext("webgl2");
      gl.finish();
      return gl.getError();
    });
    expect(gpuError).toBe(0);
    const image = await page.locator("canvas").screenshot();
    expect(image.byteLength).toBeGreaterThan(8000);
  };

  await assertGpuSurface();
  await cells.nth(2).hover({ position: { x: 220, y: 140 } });
  await expect(page.getByText("line-third series")).toBeVisible();
  await cells.nth(3).hover({ position: { x: 220, y: 140 } });
  await expect(page.getByText("bar-fourth series")).toBeVisible();

  await page.evaluate(() => window.alienchartsMixedExample.reverse());
  await expect(page.getByText("bar-fourth", { exact: true })).toBeVisible();
  await assertGpuSurface();
  await cells.nth(3).hover({ position: { x: 220, y: 140 } });
  await expect(page.getByText("line-first series")).toBeVisible();
  expect(errors).toEqual([]);
});

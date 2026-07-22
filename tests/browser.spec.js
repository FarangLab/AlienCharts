import { expect, test } from "@playwright/test";

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

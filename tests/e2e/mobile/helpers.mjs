import { expect } from "@playwright/test";

export const assertNoHorizontalOverflow = async (page) => {
  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    return {
      viewportWidth: window.innerWidth,
      docScrollWidth: doc ? doc.scrollWidth : 0,
      bodyScrollWidth: body ? body.scrollWidth : 0,
    };
  });

  expect(
    metrics.docScrollWidth,
    `Document overflow: ${metrics.docScrollWidth}px > viewport ${metrics.viewportWidth}px`,
  ).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(
    metrics.bodyScrollWidth,
    `Body overflow: ${metrics.bodyScrollWidth}px > viewport ${metrics.viewportWidth}px`,
  ).toBeLessThanOrEqual(metrics.viewportWidth + 1);
};

export const expectMinTapTarget = async (locator, minSize = 44) => {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, "Tap target bounding box should exist.").not.toBeNull();
  expect(box.width, `Tap target width should be at least ${minSize}px.`).toBeGreaterThanOrEqual(
    minSize,
  );
  expect(
    box.height,
    `Tap target height should be at least ${minSize}px.`,
  ).toBeGreaterThanOrEqual(minSize);
};

export const expectInputFontSizeAtLeast = async (locator, minPx = 16) => {
  await expect(locator).toBeVisible();
  const size = await locator.evaluate((el) => {
    const computed = window.getComputedStyle(el);
    return Number.parseFloat(computed.fontSize || "0");
  });
  expect(size, `Input font-size should be >= ${minPx}px on mobile.`).toBeGreaterThanOrEqual(minPx);
};

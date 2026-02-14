import { expect, test } from "@playwright/test";
import {
  assertNoHorizontalOverflow,
  expectInputFontSizeAtLeast,
  expectMinTapTarget,
} from "./helpers.mjs";

test.describe("mobile anonymous smoke", () => {
  test("auth page renders correctly on mobile", async ({ page }) => {
    await page.goto("/auth");

    await expect(page.getByRole("heading", { name: "Friends League Access" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();

    await expectInputFontSizeAtLeast(page.getByLabel("Email"));
    await expectInputFontSizeAtLeast(page.getByLabel("Password"));

    await expectMinTapTarget(page.getByRole("button", { name: "Login" }), 44);
    await assertNoHorizontalOverflow(page);
  });

  test("protected dashboard route redirects to auth", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/auth(?:\?.*)?$/);
    await expect(page.getByRole("heading", { name: "Friends League Access" })).toBeVisible();
    const redirectTarget = new URL(page.url()).searchParams.get("next");
    expect(redirectTarget).toBe("/");
  });

  test("protected drafts route redirects to auth", async ({ page }) => {
    await page.goto("/drafts");
    await expect(page).toHaveURL(/\/auth(?:\?.*)?$/);
    await expect(page.getByRole("heading", { name: "Friends League Access" })).toBeVisible();
    const redirectTarget = new URL(page.url()).searchParams.get("next");
    expect(redirectTarget).toBe("/drafts");
  });
});

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

  test("auth controls satisfy mobile tap target baseline", async ({ page }) => {
    await page.goto("/auth");

    const loginTab = page.getByRole("tab", { name: "Login" });
    const registerTab = page.getByRole("tab", { name: "Register" });

    await expectMinTapTarget(loginTab, 44);
    await expectMinTapTarget(registerTab, 44);
    await expectMinTapTarget(page.getByRole("button", { name: "Login" }), 44);

    await registerTab.click();
    await expect(page.getByRole("button", { name: "Create Account" })).toBeVisible();
    await expectMinTapTarget(page.getByRole("button", { name: "Create Account" }), 44);
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

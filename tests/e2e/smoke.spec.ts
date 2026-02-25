import { expect, test, type Page } from "@playwright/test";

const expectAuthSurface = async (page: Page) => {
  await expect(page).toHaveURL(/\/auth/);

  const setupRequiredHeading = page.getByRole("heading", {
    name: "Authentication Setup Required",
  });
  if (await setupRequiredHeading.isVisible()) {
    await expect(setupRequiredHeading).toBeVisible();
    return;
  }

  await expect(page.getByRole("tab", { name: "Login" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Register" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Login" })).toBeVisible();
};

test.describe("app smoke", () => {
  test("home redirects unauthenticated users to /auth", async ({ page }) => {
    await page.goto("/");
    await expectAuthSurface(page);
  });

  test("auth page renders login or setup-required state", async ({ page }) => {
    await page.goto("/auth");
    await expectAuthSurface(page);
  });

  test("snapshot-status API responds with JSON", async ({ request }) => {
    const response = await request.get("/api/snapshot-status");
    expect([200, 500]).toContain(response.status());

    const payload = await response.json();
    expect(typeof payload).toBe("object");
    expect(payload).not.toBeNull();
    expect(typeof payload.ok).toBe("boolean");
    expect(typeof payload.sourcePage).toBe("string");

    if (payload.ok === true) {
      expect(response.status()).toBe(200);
      expect(typeof payload.storedAt).toBe("string");
      expect(typeof payload.ageMinutes).toBe("number");
    } else {
      expect(response.status()).toBe(500);
      expect(typeof payload.error).toBe("string");
    }
  });
});

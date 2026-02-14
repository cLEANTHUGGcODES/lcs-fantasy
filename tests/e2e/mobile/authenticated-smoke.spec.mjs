import { expect, test } from "@playwright/test";
import { assertNoHorizontalOverflow, expectMinTapTarget } from "./helpers.mjs";

const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD;
const hasAuthCredentials = Boolean(email && password);

test.describe("mobile authenticated smoke", () => {
  test.skip(!hasAuthCredentials, "Set E2E_USER_EMAIL and E2E_USER_PASSWORD to run auth smoke tests.");

  test.beforeEach(async ({ page }) => {
    await page.goto("/auth");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Login" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("dashboard overlays and chat are mobile-safe", async ({ page }) => {
    await expect(page.getByText("Current Matchup")).toBeVisible();
    await assertNoHorizontalOverflow(page);

    const rulebookButton = page.getByLabel("Open scoring methodology FAQ");
    await expectMinTapTarget(rulebookButton, 44);
    await rulebookButton.click();
    await expect(page.getByText("Scoring Methodology")).toBeVisible();

    const drawerCloseButton = page.getByRole("button", { name: "Close" });
    await drawerCloseButton.last().click();
    await expect(page.getByText("Scoring Methodology")).toHaveCount(0);

    const editProfileButton = page.getByLabel("Edit profile").first();
    await editProfileButton.click();
    await expect(page.getByText("Profile Settings")).toBeVisible();
    await expectMinTapTarget(page.getByLabel("Close profile settings"), 44);
    await page.getByLabel("Close profile settings").click();

    const openChatButton = page.getByRole("button", { name: /chat/i }).first();
    await openChatButton.click();
    const chatInput = page.getByLabel("Chat message");
    await expect(chatInput).toBeVisible();
    await chatInput.fill("mobile smoke typing check");

    await expectMinTapTarget(page.getByLabel("Send message"), 44);
    await assertNoHorizontalOverflow(page);

    await page.getByLabel("Minimize chat").click();
  });
});

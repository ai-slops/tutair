import { expect, test } from "@playwright/test";

for (const viewport of [
  { width: 375, height: 900 },
  { width: 768, height: 900 },
  { width: 1280, height: 900 },
]) {
  test(`shows local ChatGPT connection settings at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.getByRole("button", { name: "Open settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Session & model" });

    await expect(dialog.getByRole("heading", { name: "Personal ChatGPT" })).toBeVisible();
    const connect = dialog.getByRole("link", { name: "Connect ChatGPT" });
    await expect(connect).toHaveAttribute("href", "/api/chatgpt/connect");
    await expect(dialog).not.toContainText("access_token");
    await page.screenshot({
      path: `.omo/evidence/chatgpt-settings/settings-${viewport.width}.png`,
      fullPage: true,
    });
  });
}

test("selects and disconnects an account-visible ChatGPT model", async ({ page }) => {
  const signup = await page.request.post("/api/auth/local-signup", {
    data: { displayName: "Local learner" },
  });
  expect(signup.ok()).toBe(true);
  const { learner } = await signup.json();
  const learnerId = learner.id;
  await page.request.post("/__test__/chatgpt", { data: { learnerId } });
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Session & model" });

  await expect(dialog.getByRole("status")).toContainText("Connected for this local learner");
  await expect(dialog.getByRole("combobox", { name: "ChatGPT model" })).toHaveValue("gpt-browser");
  await dialog.getByRole("button", { name: "Disconnect ChatGPT" }).click();
  await expect(dialog.getByRole("link", { name: "Connect ChatGPT" })).toBeVisible();
});

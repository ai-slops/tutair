import { expect, test } from "@playwright/test";

for (const viewport of [
  { width: 375, height: 900 },
  { width: 768, height: 900 },
  { width: 1280, height: 900 },
]) {
  test(`completes manual ChatGPT connection at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.getByRole("button", { name: "Open settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Session & model" });

    await expect(dialog.getByRole("heading", { name: "Personal ChatGPT" })).toBeVisible();
    const popupPromise = page.waitForEvent("popup");
    await dialog.getByRole("button", { name: "Continue with ChatGPT" }).click();
    const popup = await popupPromise;
    const callbackUrl = await popup.getByRole("textbox", { name: "Callback URL" }).inputValue();
    await popup.close();

    const callbackInput = dialog.getByRole("textbox", { name: "Full localhost callback URL" });
    const invalidCallback = new URL(callbackUrl);
    invalidCallback.searchParams.set("state", "invalid-browser-state");
    await callbackInput.fill(invalidCallback.toString());
    await dialog.getByRole("button", { name: "Complete ChatGPT connection" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(callbackInput).toHaveValue(invalidCallback.toString());
    await expect(callbackInput).toHaveAttribute("aria-invalid", "true");
    await page.screenshot({
      path: `.omo/evidence/chatgpt-settings/manual-error-${viewport.width}.png`,
      fullPage: true,
    });

    await callbackInput.fill(callbackUrl);
    await dialog.getByRole("button", { name: "Complete ChatGPT connection" }).click();

    await expect(dialog.getByRole("status")).toContainText("Connected for this local learner");
    await expect(dialog.getByRole("combobox", { name: "ChatGPT model" })).toHaveValue("");
    await expect(dialog.getByRole("option", { name: "GPT Browser" })).toBeAttached();
    await expect(dialog).not.toContainText("access_token");
    await page.screenshot({
      path: `.omo/evidence/chatgpt-settings/connected-${viewport.width}.png`,
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
  await expect(dialog.getByRole("button", { name: "Continue with ChatGPT" })).toBeVisible();
});

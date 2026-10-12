import { expect, test } from "@playwright/test";

test("reviews a misconception lifecycle without responsive overflow", async ({
  page,
  request,
}, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Synthetic demo provider/ })).toBeVisible();
  consoleErrors.length = 0;
  const seeded = await request.post("/__test__/misconception");
  expect(seeded.ok()).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Manage knowledge" }).click();
  await page.getByRole("button", { name: "Misconceptions" }).click();
  await expect(page.getByRole("heading", { name: "States are events" })).toBeVisible();
  await expect(page.getByText("Definition revision links")).toBeVisible();

  await page.getByRole("button", { name: "Mark incorrect" }).click();
  const incorrectDialog = page.getByRole("dialog", { name: "Mark misconception incorrect" });
  await incorrectDialog.getByRole("textbox", { name: "Reason" }).fill("Correction needs review");
  await incorrectDialog.getByRole("button", { name: "Confirm" }).click();
  await expect(page.locator(".manager-reader .status-badge")).toHaveText("incorrect");

  await page.getByRole("button", { name: "Retire" }).click();
  const retireDialog = page.getByRole("dialog", { name: "Retire misconception" });
  await retireDialog.getByRole("textbox", { name: "Reason" }).fill("Temporarily out of scope");
  await retireDialog.getByRole("button", { name: "Confirm" }).click();
  await expect(page.locator(".manager-reader .status-badge")).toHaveText("retired");

  await page.getByRole("button", { name: "Restore" }).click();
  const restoreDialog = page.getByRole("dialog", { name: "Restore misconception" });
  await restoreDialog.getByRole("checkbox").check();
  await restoreDialog.getByRole("button", { name: "Confirm" }).click();
  await expect(page.locator(".manager-reader .status-badge")).toHaveText("incorrect");

  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath(`misconception-${width}.png`),
      fullPage: true,
    });
  }
  expect(consoleErrors).toEqual([]);
});

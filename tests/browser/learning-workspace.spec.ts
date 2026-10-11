import { expect, type Page, test } from "@playwright/test";

async function startThread(page: Page, title: string, outcome: string) {
  await page.getByRole("button", { name: "Start learning thread", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Title (optional)", exact: true }).fill(title);
  await dialog.getByRole("textbox", { name: "Desired outcome" }).fill(outcome);
  await dialog.getByRole("combobox", { name: "Origin" }).selectOption("project");
  await dialog.getByRole("textbox", { name: "Why now?" }).fill("Fix invalid states");
  await dialog.getByRole("button", { name: "Start learning thread", exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function expectHeaderControlsWithinViewport(page: Page) {
  const controls = page.locator(".main-header button:visible");
  expect(await controls.count()).toBeGreaterThan(0);
  expect(
    await controls.evaluateAll((elements) =>
      elements.every((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.left >= 0 && bounds.right <= innerWidth;
      }),
    ),
  ).toBe(true);
}

test.beforeEach(async ({ page, request }) => {
  await request.post("/__test__/evaluation", { data: { fail: false } });
  await request.post("/__test__/generation", { data: {} });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Synthetic demo provider/ })).toBeVisible();
});

test("shows recorded stages during a pending turn and recovers them after reload", async ({
  page,
  request,
}) => {
  await request.post("/__test__/generation", { data: { pauseStage: "extraction" } });
  await page.getByRole("textbox", { name: "Ask your tutor" }).fill("Show each real stage");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByText("Extracting relevant concepts", { exact: true })).toBeVisible();
  const inspectorTrigger = page.getByRole("button", { name: "View generation details" });
  await inspectorTrigger.click();
  const inspector = page.getByRole("dialog", { name: "Generation details" });
  await expect(inspector).toBeVisible();
  await expect(inspector.getByText("Evaluated your latest message", { exact: true })).toBeVisible();
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(inspector).toBeVisible();
    await expect(inspector).toHaveCSS("transform", "none");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      await inspector.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return (
          bounds.left >= 0 &&
          bounds.right <= innerWidth &&
          element.scrollWidth <= element.clientWidth
        );
      }),
    ).toBe(true);
    await expect(page.locator(".generation-backdrop")).toBeAttached();
    await page.screenshot({
      path: `.omo/evidence/generation-inspector-${width}.png`,
      fullPage: true,
    });
  }
  await inspector.getByRole("button", { name: "Inspect" }).first().click();
  await expect(inspector.getByRole("heading", { name: "evaluation · attempt 1" })).toBeVisible();
  await expect(inspector.getByText("Recorded structured call", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(inspector).toBeHidden();
  await expect(inspectorTrigger).toBeFocused();
  await page.reload();

  await expect(page.getByText("Saved request in progress", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View generation details" }).click();
  await expect(page.getByText("Extracting relevant concepts", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close generation details" }).click();
  await request.post("/__test__/generation/release");
  await page.getByRole("button", { name: "Continue saved request" }).click();
  await expect(page.locator(".message-tutor")).toHaveCount(1);
  await expect(page.getByText("Saved request in progress", { exact: true })).toBeHidden();
});

test("keeps a failed recorded stage inspectable after reload", async ({ page, request }) => {
  await request.post("/__test__/generation", { data: { failStage: "final" } });
  await page.getByRole("textbox", { name: "Ask your tutor" }).fill("Fail with provenance");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByText("Saved request needs attention", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View generation details" }).click();
  await expect(page.getByText("Finalizing the response failed", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Saved request needs attention", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View generation details" }).click();
  await expect(page.getByText("Finalizing the response failed", { exact: true })).toBeVisible();
});

test("shows exact answer revisions and opt-in official summaries at every viewport", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Open settings" }).click();
  const settings = page.getByRole("dialog", { name: "Session & model" });
  await settings
    .getByRole("checkbox", { name: /Save provider reasoning summaries for debugging/ })
    .check();
  await expect(
    settings.getByRole("checkbox", { name: /Save provider reasoning summaries for debugging/ }),
  ).toBeChecked();
  await settings.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("textbox", { name: "Ask your tutor" }).fill("Explain a transition guard");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message-tutor")).toHaveCount(1);

  const provenanceButton = page.getByRole("button", { name: "Sources & knowledge" });
  await provenanceButton.click();
  const provenance = page.locator(".answer-provenance-body");
  await expect(provenance.getByRole("region", { name: "Provided to model" })).toBeVisible();
  await expect(provenance.getByText("Created during this answer")).toBeVisible();
  await expect(provenance.getByText("Exposed in answer")).toBeVisible();
  await expect(provenance.getByText("Provider reasoning summary")).toBeVisible();
  await expect(provenance.getByText(/Checked the recorded final inputs/)).toBeVisible();

  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    if (width <= 720) await expect(page.locator(".thread-pane")).toHaveCSS("opacity", "0");
    if (width <= 1120) await expect(page.locator(".knowledge-pane")).toHaveCSS("opacity", "0");
    await expectHeaderControlsWithinViewport(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `.omo/evidence/answer-provenance-${width}.png`,
      fullPage: true,
    });
  }

  await provenance
    .getByRole("region", { name: "Created during this answer" })
    .getByRole("link")
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Knowledge manager" })).toBeVisible();
  await expect(page.locator(".manager-history details[open]")).toContainText("Revision 1");
});

test("serves fingerprinted assets with compression and immutable caching", async ({ request }) => {
  const indexResponse = await request.get("/");
  const html = await indexResponse.text();
  const [, assetPath = ""] = html.match(/src="([^"]+\.js)"/) ?? [];
  expect(assetPath).not.toBe("");

  const assetResponse = await request.get(assetPath, {
    headers: { "accept-encoding": "gzip" },
  });

  expect(assetResponse.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
  expect(assetResponse.headers()["content-encoding"]).toBe("gzip");
});

test("manages a project and question lifecycle, then resumes the same thread", async ({ page }) => {
  await startThread(page, "FSM 상태 관리", "모순된 상태를 방지하는 컨트롤러 만들기");
  await page.getByRole("textbox", { name: "New open question" }).fill("왜 전이가 필요한가?");
  await page.getByRole("button", { name: "Add question", exact: true }).click();
  await page.getByRole("button", { name: "Park question", exact: true }).click();
  await page.getByRole("button", { name: "Reopen question", exact: true }).click();
  await page.getByRole("button", { name: "Resolve question", exact: true }).click();
  await page.getByRole("textbox", { name: "Ask your tutor" }).fill("Explain an FSM");
  await page.getByRole("textbox", { name: "Ask your tutor" }).press("Control+Enter");
  await expect(page.locator(".message-tutor")).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "Ask your tutor" })).toHaveValue("");
  await page.getByRole("button", { name: /Edit learning thread goal/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("textbox", { name: "Desired outcome" })
    .fill("검증 가능한 컨트롤러 완성하기");
  await dialog.getByRole("button", { name: /Save/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("검증 가능한 컨트롤러 완성하기", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Pause / }).click();
  await page.getByRole("button", { name: /^Resume / }).click();
  await expect(page.getByRole("button", { name: /^Pause / })).toBeVisible();
  const url = page.url();
  expect(url).toContain("conversation=");
  await page.reload();
  await expect(page.locator(".message-tutor")).toHaveCount(1);
  await expect(page.getByText("검증 가능한 컨트롤러 완성하기", { exact: true })).toBeVisible();
});

test("resolves ambiguous saved input without submitting a second learner message", async ({
  page,
}) => {
  await startThread(page, "FSM", "First controller");
  await startThread(page, "FSM", "Second controller");
  await page.getByRole("button", { name: "New conversation", exact: true }).click();
  await page.getByRole("textbox", { name: "Ask your tutor" }).fill("FSM");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Choose the learning thread for this message")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(900);
  await page.setViewportSize({ width: 375, height: 900 });
  await page.locator(".conversation-scroll").evaluate((element) => {
    element.scrollTop = 0;
  });
  const recoveryWidth = await page.locator(".conversation-scroll").evaluate((element) => ({
    content: element.scrollWidth,
    available: element.clientWidth,
  }));
  expect(recoveryWidth.content).toBeLessThanOrEqual(recoveryWidth.available);
  const composerWidth = await page
    .locator(".composer-wrap")
    .evaluate((element) => element.getBoundingClientRect().right);
  expect(composerWidth).toBeLessThanOrEqual(375);
  const finalRecoveryOptionBottom = await page
    .getByRole("button", { name: /Start a new learning thread/ })
    .evaluate((element) => element.getBoundingClientRect().bottom);
  const composerTop = await page
    .locator(".composer-wrap")
    .evaluate((element) => element.getBoundingClientRect().top);
  expect(finalRecoveryOptionBottom).toBeLessThanOrEqual(composerTop);
  await page
    .locator(".recovery-options")
    .getByRole("button", { name: /First controller/ })
    .click();
  await expect(page.locator(".message-tutor")).toHaveCount(1);
  await expect(page.locator(".message-user")).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "Ask your tutor" })).toHaveValue("");
});

test("shows evaluation tracking failure on the affected reply after reload", async ({
  page,
  request,
}) => {
  await startThread(page, "Tracking", "Inspect what was assessed");
  await request.post("/__test__/evaluation", { data: { fail: true } });
  await page.getByRole("textbox", { name: "Ask your tutor" }).fill("Explain FSM");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message-tutor")).toHaveCount(1);
  await expect(page.getByRole("status", { name: "Response tracking notes" })).toContainText(
    "Evaluation skipped",
  );
  await page.reload();
  await expect(page.getByRole("status", { name: "Response tracking notes" })).toContainText(
    "Evaluation skipped",
  );
  await expect(page.locator(".message-user")).toHaveCount(1);
});

test("has keyboard-operable drawers and no horizontal overflow on mobile and tablet", async ({
  page,
}) => {
  for (const width of [375, 768]) {
    await page.setViewportSize({ width, height: 900 });
    const trigger = page.getByRole("button", { name: "Overview", exact: true });
    await trigger.click();
    await expect(page.locator(".knowledge-pane")).toHaveAttribute("data-open", "true");
    await expect(page.getByRole("dialog", { name: "Learning overview" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".knowledge-pane")).toHaveAttribute("data-open", "false");
    await expect(page.locator(".knowledge-pane")).toHaveAttribute("inert", "");
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test("keeps the composer visible and long questions readable inside bounded panes", async ({
  page,
}) => {
  await startThread(page, "긴 질문 실험", "읽을 수 있는 학습 기록 유지하기");
  await page
    .getByRole("textbox", { name: "New open question" })
    .fill("상태 전이를 어떻게 검증할까요? ".repeat(10));
  await page.getByRole("button", { name: "Add question", exact: true }).click();
  await expect(page.getByRole("button", { name: "Park question", exact: true })).toBeAttached();
  expect(
    await page.locator(".main-pane").evaluate((element) => element.clientHeight),
  ).toBeLessThanOrEqual(900);
  expect(
    await page
      .locator(".knowledge-pane .queue-row")
      .first()
      .evaluate((element) => element.firstElementChild?.getBoundingClientRect().width ?? 0),
  ).toBeGreaterThan(120);
  await expect(page.getByRole("textbox", { name: "Ask your tutor" })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(900);
});

test("browses and reviews knowledge without responsive overflow", async ({ page }) => {
  await startThread(page, "FSM 지식 검토", "상태 전이 정의를 검토하기");
  await page.getByRole("textbox", { name: "Ask your tutor" }).fill("Explain an FSM");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message-tutor")).toHaveCount(1);
  const created = await page.request.post("/api/knowledge", {
    data: {
      title: "상태 기계의 안전 전이",
      statement: "허용된 상태와 전이 규칙만 사용해 잘못된 상태 변화를 막는 모델입니다.",
      scope: "provisional",
      riskScope: "stable",
      confidence: 0.9,
    },
  });
  expect(created.ok()).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Manage knowledge" }).click();
  await expect(page.getByRole("heading", { name: "Knowledge manager" })).toBeVisible();
  await expect(page.locator(".manager-row").first()).toBeVisible();
  await page.getByRole("searchbox", { name: "Search knowledge" }).fill("상태 기계");
  await page.getByRole("button", { name: /상태 기계의 안전 전이/ }).click();

  await page.getByRole("button", { name: "Mark reviewed" }).click();
  await expect(page.locator(".manager-reader .status-badge")).toHaveText("reviewed");

  await expect(
    page.getByText(/Unreviewed definitions remain available to the tutor/),
  ).toBeVisible();

  for (const [index, width] of [1280, 768, 375].entries()) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => scrollTo(0, 0));
    await page.locator(".manager-detail").evaluate((element) => {
      element.scrollTop = 0;
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole("button", { name: "Suggest correction" }).click();
    await expect(page.getByRole("dialog", { name: "Suggest a correction" })).toBeVisible();
    await expect(page.getByLabel("Correction intent")).toHaveValue("revise");
    await page
      .getByRole("textbox", { name: "Correction" })
      .fill(`허용된 상태와 명시된 전이만 따르는 안전 모델입니다. 검토 ${index + 1}`);
    await page.screenshot({
      path: `.omo/evidence/knowledge-manager/correction-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Submit correction" }).click();
    await page.getByRole("button", { name: "Manage knowledge" }).click();
    await page.getByRole("searchbox", { name: "Search knowledge" }).fill("상태 기계");
    await page.getByRole("button", { name: /상태 기계의 안전 전이/ }).click();
    await expect(page.locator(".manager-reader .status-badge")).toHaveText("unreviewed");
    await expect(page.getByText(`Revision ${index + 2}`, { exact: true }).first()).toBeVisible();
    await page.screenshot({
      path: `.omo/evidence/knowledge-manager/manager-${width}.png`,
      fullPage: true,
    });
    await page.locator(".manager-definition").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `.omo/evidence/knowledge-manager/definition-${width}.png`,
    });
    if (width > 720) {
      await page.locator(".manager-detail").evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
    } else {
      await page.locator(".knowledge-manager-shell").evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
    }
    await expect(page.getByText("Revision 1", { exact: true }).first()).toBeVisible();
    await page.screenshot({
      path: `.omo/evidence/knowledge-manager/history-${width}.png`,
    });
  }
});

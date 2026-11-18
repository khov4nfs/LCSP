import { chromium } from "@playwright/test";
import path from "node:path";
import { existsSync, mkdirSync, readFileSync } from "node:fs";

const artifactDir = "/home/khovan/.gemini/antigravity-cli/brain/9e5390b6-0cbe-4e3f-92d5-8d900145f7bf";
if (!existsSync(artifactDir)) {
  mkdirSync(artifactDir, { recursive: true });
}

async function run() {
  console.log("Launching Chromium...");
  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 2, // High resolution retina captures
  });

  const page = await context.newPage();

  page.on("response", (res) => {
    if (res.status() >= 400) {
      console.error(`[HTTP ${res.status()}] ${res.url()}`);
    }
  });
  page.on("pageerror", (err) => {
    console.error("[Page Error]", err.message);
  });
  page.on("console", (msg) => {
    console.log(`[Browser Console ${msg.type()}]`, msg.text());
  });

  // Read validated mock data
  const mockFilePath = path.resolve(
    import.meta.dirname,
    "../apps/web/src/public/assets/mocks/enterprise-legal-compliance-workspace.json",
  );
  const mockData = JSON.parse(readFileSync(mockFilePath, "utf8"));

  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/assessments/") && url.includes("/repository-setup")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: mockData.repositorySetup }),
      });
    }
    if (url.includes("/api/assessments/") && (url.includes("/rule-audits") || url.includes("/rule-audit-catalog"))) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: mockData.catalog }),
      });
    }
    if (url.includes("/api/assessments/") && url.includes("/provenance")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: mockData.provenance }),
      });
    }
    if (url.includes("/api/assessments/") && url.includes("/human-requests")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: mockData.requests }),
      });
    }
    if (url.includes("/api/legal-library") && url.includes("/chunks")) {
      const is147 = url.includes("doc-row-nd-147");
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: is147 ? mockData.chunksDoc147 : mockData.chunksDoc13 }),
      });
    }
    if (url.includes("/api/legal-library")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: mockData.library }),
      });
    }
    if (url.includes("/api/assessments/")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: mockData.detail }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: {} }),
    });
  });

  console.log("Navigating to http://localhost:3000/preview-compliance...");
  await page.goto("http://localhost:3000/preview-compliance", {
    waitUntil: "networkidle",
    timeout: 30000,
  });

  // Wait for the legal rule outputs to be rendered
  await page.waitForSelector('[data-slot="legal-rule-output"]', { timeout: 15000 });
  console.log("Visual Compliance Workspace loaded successfully!");

  await page.waitForTimeout(1000);

  // 1. Capture Full Workspace Desktop Overview
  console.log("Capturing 01_compliance_workspace_desktop.png...");
  await page.screenshot({
    path: path.join(artifactDir, "01_compliance_workspace_desktop.png"),
    fullPage: false,
  });

  // Full page scroll
  console.log("Capturing 01_compliance_workspace_desktop_fullpage.png...");
  await page.screenshot({
    path: path.join(artifactDir, "01_compliance_workspace_desktop_fullpage.png"),
    fullPage: true,
  });

  // 2. Focused Non-Compliant Rule Card (Executive Verdict Banner + Quick Buttons)
  const rule147Card = page.locator('[data-rule-id="ER-RETENTION"]');
  await rule147Card.waitFor({ state: "visible", timeout: 10000 });
  console.log("Capturing 02_rule_nd147_executive_banner.png...");
  await rule147Card.screenshot({
    path: path.join(artifactDir, "02_rule_nd147_executive_banner.png"),
  });

  // 3. Open Code Evidence Drawer and Raw Legal Rule Drawer
  console.log("Clicking progressive disclosure button [Xem bằng chứng code]...");
  await rule147Card.locator('button:has-text("Xem bằng chứng code")').click();
  await page.waitForTimeout(400);

  console.log("Capturing 03_rule_nd147_drawers_open.png...");
  await rule147Card.screenshot({
    path: path.join(artifactDir, "03_rule_nd147_drawers_open.png"),
  });

  // Close evidence drawer
  await rule147Card.locator('button:has-text("Xem bằng chứng code")').click();
  await page.waitForTimeout(300);

  // 4. Capture HITL Question: Boolean (Có / Không)
  const hitlBoolean = page.locator('[data-slot="hitl-demo-boolean"]');
  if (await hitlBoolean.isVisible()) {
    console.log("Capturing 04_hitl_question_boolean.png...");
    await hitlBoolean.screenshot({
      path: path.join(artifactDir, "04_hitl_question_boolean.png"),
    });
  }

  // 5. Capture HITL Question: Single-Select Dropdown
  const hitlSelect = page.locator('[data-slot="hitl-demo-select"]');
  if (await hitlSelect.isVisible()) {
    console.log("Capturing 05_hitl_question_select.png...");
    await hitlSelect.screenshot({
      path: path.join(artifactDir, "05_hitl_question_select.png"),
    });
  }

  // 6. Capture Compliant Rule Card (Nghị định 13/2023/NĐ-CP - MFA)
  const rule13Card = page.locator('[data-rule-id="ER-MFA"]');
  if (await rule13Card.isVisible()) {
    console.log("Capturing 06_rule_nd13_compliant.png...");
    await rule13Card.screenshot({
      path: path.join(artifactDir, "06_rule_nd13_compliant.png"),
    });
  }

  // 7. Capture HITL Question: Multi-Select Checkboxes
  const hitlMulti = page.locator('[data-slot="hitl-demo-multiselect"]');
  if (await hitlMulti.isVisible()) {
    // Check one or two checkboxes to demonstrate interaction
    const firstCheckbox = hitlMulti.locator('input[type="checkbox"]').first();
    await firstCheckbox.check();
    await page.waitForTimeout(200);

    console.log("Capturing 07_hitl_question_multiselect.png...");
    await hitlMulti.screenshot({
      path: path.join(artifactDir, "07_hitl_question_multiselect.png"),
    });
  }

  // 8. Capture HITL Question: Free Text Textarea
  const hitlText = page.locator('[data-slot="hitl-demo-text"]');
  if (await hitlText.isVisible()) {
    const textarea = hitlText.locator("textarea");
    await textarea.fill("Đã chỉ định ông Nguyễn Văn A (dpo@acme.com) làm DPO. Quy trình tiếp nhận yêu cầu DSR được công khai tại https://acme.com/privacy/dsr.");
    await page.waitForTimeout(200);

    console.log("Capturing 08_hitl_question_text.png...");
    await hitlText.screenshot({
      path: path.join(artifactDir, "08_hitl_question_text.png"),
    });
  }

  // 9. Capture HITL Question: Resolved / Closed State with User Answer
  const hitlResolved = page.locator('[data-slot="hitl-demo-resolved"]');
  if (await hitlResolved.isVisible()) {
    console.log("Capturing 09_hitl_question_resolved.png...");
    await hitlResolved.screenshot({
      path: path.join(artifactDir, "09_hitl_question_resolved.png"),
    });
  }

  // 10. Capture Right Sidebar: Assessment Context Panel
  const contextPanel = page.locator('aside[aria-label="Assessment Context"]');
  if (await contextPanel.isVisible()) {
    console.log("Capturing 10_assessment_context_panel.png...");
    await contextPanel.screenshot({
      path: path.join(artifactDir, "10_assessment_context_panel.png"),
    });
  }

  // 11. Mobile Viewport Responsive Capture
  console.log("Testing mobile responsiveness (390x844)...");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);

  console.log("Capturing 11_compliance_workspace_mobile.png...");
  await page.screenshot({
    path: path.join(artifactDir, "11_compliance_workspace_mobile.png"),
    fullPage: false,
  });

  await browser.close();
  console.log("All screenshots successfully captured in:", artifactDir);
}

run().catch((err) => {
  console.error("Capture script failed:", err);
  process.exit(1);
});

import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE_URL = 'http://localhost:3000';
const OUTPUT_DIR = '/home/khovan/Workplaces/LCSP/screenshort';

if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureScreen(page, filename, options = {}) {
  const filePath = join(OUTPUT_DIR, `${filename}.png`);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.screenshot({ path: filePath, fullPage: options.fullPage ?? false });
      console.log(`[Captured] ${filename}.png`);
      return;
    } catch (e) {
      console.warn(`[Retry ${attempt}] Error capturing ${filename}: ${e.message}`);
      await sleep(attempt * 500);
    }
  }
}

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  // Base options for strict English rendering
  const contextOptions = {
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
  };

  // 1. Public Context
  const publicContext = await browser.newContext(contextOptions);
  await publicContext.addCookies([
    { name: 'lcsp_locale', value: 'en', domain: 'localhost', path: '/' },
  ]);

  // 2. Customer Context
  const customerContext = await browser.newContext(contextOptions);
  await customerContext.addCookies([
    { name: 'lcsp_locale', value: 'en', domain: 'localhost', path: '/' },
    { name: 'lcsp_session', value: 'mock-session:customer', domain: 'localhost', path: '/' },
    { name: 'lcsp_org_id', value: 'org-mock-customer', domain: 'localhost', path: '/' },
    { name: 'lcsp_role', value: 'customer', domain: 'localhost', path: '/' },
  ]);

  // 3. Admin Context
  const adminContext = await browser.newContext(contextOptions);
  await adminContext.addCookies([
    { name: 'lcsp_locale', value: 'en', domain: 'localhost', path: '/' },
    { name: 'lcsp_session', value: 'mock-session:admin', domain: 'localhost', path: '/' },
    { name: 'lcsp_org_id', value: 'org-mock-admin', domain: 'localhost', path: '/' },
    { name: 'lcsp_role', value: 'admin', domain: 'localhost', path: '/' },
  ]);

  console.log('--- Starting Targeted Captures ---');

  // --- 05-auth-sign-in-filled-active ---
  {
    const page = await publicContext.newPage();
    await page.goto(`${BASE_URL}/sign-in`);
    await sleep(600);
    const emailInput = page.locator('input[type="email"], input[name="email"]').first();
    const passwordInput = page.locator('input[type="password"]').first();
    if (await emailInput.isVisible()) await emailInput.fill('minhpnq1807@gmail.com');
    if (await passwordInput.isVisible()) await passwordInput.fill('CorrectHorseBatteryStaple!');
    const submitBtn = page.locator('button[type="submit"]').first();
    if (await submitBtn.isVisible()) await submitBtn.focus();
    await sleep(400);
    await captureScreen(page, '05-auth-sign-in-filled-active');
    await page.close();
  }

  // --- 14-workspace-select ---
  {
    const page = await customerContext.newPage();
    await page.goto(`${BASE_URL}/workspace/select`);
    await page.waitForSelector('text=LCSP', { timeout: 8000 });
    await sleep(600);
    await captureScreen(page, '14-workspace-select');
    await page.close();
  }

  // --- 15-workspace-dashboard ---
  {
    const page = await customerContext.newPage();
    await page.goto(`${BASE_URL}/workspace`);
    await page.waitForSelector('text=Compliance overview', { timeout: 8000 });
    await sleep(600);
    await captureScreen(page, '15-workspace-dashboard');
    await page.close();
  }

  // --- 16-workspace-sidebar-active ---
  {
    const page = await customerContext.newPage();
    await page.goto(`${BASE_URL}/workspace`);
    await page.waitForSelector('text=Compliance overview', { timeout: 8000 });
    const recentsButton = page.locator('[data-slot="sidebar-recents-scroll"] button, [data-slot="sidebar-recents-scroll"] a').first();
    if (await recentsButton.isVisible()) await recentsButton.hover();
    await sleep(400);
    await captureScreen(page, '16-workspace-sidebar-active');
    await page.close();
  }

  // --- 17-workspace-user-menu-popover ---
  {
    const page = await customerContext.newPage();
    await page.goto(`${BASE_URL}/workspace`);
    await page.waitForSelector('button[data-component="SidebarAccountTrigger"]', { timeout: 8000 });
    await sleep(500);
    const trigger = page.locator('button[data-component="SidebarAccountTrigger"]').first();
    await trigger.click();
    await sleep(600);
    await captureScreen(page, '17-workspace-user-menu-popover');
    await page.close();
  }

  // --- 18-workspace-assessments-list ---
  {
    const page = await customerContext.newPage();
    await page.goto(`${BASE_URL}/assessments`);
    await page.waitForSelector('text=Assessments and repositories', { timeout: 8000 });
    await sleep(600);
    await captureScreen(page, '18-workspace-assessments-list');
    await page.close();
  }

  // --- 20-assessment-detail-main ---
  {
    const page = await customerContext.newPage();
    await page.goto(`${BASE_URL}/assessments/11111111-1111-4111-8111-111111111111`);
    await page.waitForSelector('text=Choose rules to audit', { timeout: 8000 });
    await sleep(600);
    await captureScreen(page, '20-assessment-detail-main');
    await page.close();
  }

  // --- 21-assessment-detail-question-open ---
  {
    const page = await customerContext.newPage();
    await page.goto(`${BASE_URL}/assessments/11111111-1111-4111-8111-111111111111`);
    await page.waitForSelector('text=Choose rules to audit', { timeout: 8000 });
    // Expand a question or rule if accordion exists
    const ruleItem = page.locator('button:has-text("ER-"), button:has-text("Lưu trữ"), [data-slot="accordion-trigger"]').first();
    if (await ruleItem.isVisible()) {
      await ruleItem.click();
      await sleep(500);
    }
    await captureScreen(page, '21-assessment-detail-question-open');
    await page.close();
  }

  // --- 22-assessment-provenance ---
  {
    const page = await customerContext.newPage();
    await page.goto(`${BASE_URL}/assessments/11111111-1111-4111-8111-111111111111/provenance`);
    await page.waitForSelector('text=Assessment provenance', { timeout: 8000 });
    await sleep(600);
    await captureScreen(page, '22-assessment-provenance');
    await page.close();
  }

  // --- 23-assessment-report ---
  {
    const page = await customerContext.newPage();
    await page.goto(`${BASE_URL}/assessments/11111111-1111-4111-8111-111111111111/report`);
    await page.waitForSelector('text=Assessment report', { timeout: 8000 });
    await sleep(600);
    await captureScreen(page, '23-assessment-report');
    await page.close();
  }

  // --- 24-workspace-compliance ---
  {
    const page = await customerContext.newPage();
    await page.goto(`${BASE_URL}/workspace/compliance`);
    await page.waitForSelector('text=Obligations to follow up', { timeout: 8000 });
    await sleep(600);
    await captureScreen(page, '24-workspace-compliance');
    await page.close();
  }

  // --- 25-workspace-laws ---
  {
    const page = await customerContext.newPage();
    await page.goto(`${BASE_URL}/laws`);
    await page.waitForSelector('text=Legal Library', { timeout: 8000 });
    await sleep(600);
    await captureScreen(page, '25-workspace-laws');
    await page.close();
  }

  // --- 26-workspace-laws-detail ---
  {
    const page = await customerContext.newPage();
    await page.goto(`${BASE_URL}/laws/11111111-1111-4111-8111-111111111111`);
    await page.waitForSelector('text=Synthetic first provision content', { timeout: 8000 });
    await sleep(600);
    await captureScreen(page, '26-workspace-laws-detail');
    await page.close();
  }

  // --- 27-workspace-reports ---
  {
    const page = await customerContext.newPage();
    await page.goto(`${BASE_URL}/workspace/reports`);
    await page.waitForSelector('text=Reports', { timeout: 8000 });
    await sleep(600);
    await captureScreen(page, '27-workspace-reports');
    await page.close();
  }

  // --- 32-workspace-settings-modal-billing ---
  {
    const page = await customerContext.newPage();
    await page.goto(`${BASE_URL}/workspace/settings?section=billing`);
    await page.waitForSelector('text=Prepaid balance', { timeout: 8000 });
    await sleep(600);
    await captureScreen(page, '32-workspace-settings-modal-billing');
    await page.close();
  }

  // --- 50-admin-legal-sources ---
  {
    const page = await adminContext.newPage();
    await page.goto(`${BASE_URL}/admin/legal-sources`);
    await page.waitForSelector('text=Legal Sources', { timeout: 8000 });
    await sleep(600);
    await captureScreen(page, '50-admin-legal-sources');
    await page.close();
  }

  // --- 51-admin-legal-source-detail ---
  {
    const page = await adminContext.newPage();
    await page.goto(`${BASE_URL}/admin/legal-sources/11111111-1111-4111-8111-111111111111`);
    await page.waitForSelector('text=ADMIN', { timeout: 8000 });
    await sleep(600);
    await captureScreen(page, '51-admin-legal-source-detail');
    await page.close();
  }

  // --- 52-admin-compliance-rule-sets ---
  {
    const page = await adminContext.newPage();
    await page.goto(`${BASE_URL}/admin/compliance-rule-sets`);
    await page.waitForSelector('text=Compliance rule sets', { timeout: 8000 });
    await sleep(600);
    await captureScreen(page, '52-admin-compliance-rule-sets');
    await page.close();
  }

  // --- 53-admin-compliance-rule-set-detail ---
  {
    const page = await adminContext.newPage();
    await page.goto(`${BASE_URL}/admin/compliance-rule-sets/cccccccc-cccc-4ccc-8ccc-cccccccccccc`);
    await page.waitForSelector('text=ADMIN', { timeout: 8000 });
    await sleep(600);
    await captureScreen(page, '53-admin-compliance-rule-set-detail');
    await page.close();
  }

  // --- 54-admin-compliance-prepare-modal ---
  {
    const page = await adminContext.newPage();
    await page.goto(`${BASE_URL}/admin/compliance-rule-sets`);
    await page.waitForSelector('text=Compliance rule sets', { timeout: 8000 });
    await sleep(500);
    const prepareBtn = page.locator('button:has-text("Prepare"), button:has-text("Create"), button:has-text("New")').first();
    if (await prepareBtn.isVisible()) {
      await prepareBtn.click();
      await sleep(600);
    }
    await captureScreen(page, '54-admin-compliance-prepare-modal');
    await page.close();
  }

  // --- 56-admin-usage ---
  {
    const page = await adminContext.newPage();
    await page.goto(`${BASE_URL}/admin/usage`);
    await page.waitForSelector('text=AI token usage', { timeout: 8000 });
    await sleep(600);
    await captureScreen(page, '56-admin-usage');
    await page.close();
  }

  console.log('--- All 21 Targeted Screen Captures Finished ---');
  await browser.close();
}

run().catch((err) => {
  console.error('Fatal error during capture:', err);
  process.exit(1);
});

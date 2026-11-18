import { chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:3000';

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const inspect = async (context, url, name, action = null) => {
    const page = await context.newPage();
    const failed = [];
    const consoleErrors = [];
    page.on('requestfailed', (req) => failed.push(req.url()));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(2500); // let queries settle
      if (action) await action(page);
      await sleep(1000);

      const skeletons = await page.locator('.animate-pulse, [data-slot="skeleton"], svg.animate-spin, [role="progressbar"]').count();
      const loadingElements = await page.locator('text=/loading/i').allInnerTexts();
      const bodyText = await page.locator('body').innerText();
      const excerpt = bodyText.replace(/\s+/g, ' ').slice(0, 300);

      console.log(`\n=== [${name}] URL: ${url} ===`);
      console.log(`Skeletons/Spinners count: ${skeletons}`);
      console.log(`Loading texts:`, loadingElements);
      console.log(`Console errors (${consoleErrors.length}):`, consoleErrors.slice(0, 3));
      console.log(`Failed reqs (${failed.length}):`, failed.slice(0, 3));
      console.log(`Excerpt: ${excerpt}`);
    } catch (e) {
      console.error(`Error on ${name}:`, e.message);
    } finally {
      await page.close();
    }
  };

  const publicContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
  });
  await publicContext.addCookies([{ name: 'lcsp_locale', value: 'en', domain: 'localhost', path: '/' }]);

  const customerContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
  });
  await customerContext.addCookies([
    { name: 'lcsp_locale', value: 'en', domain: 'localhost', path: '/' },
    { name: 'lcsp_session', value: 'mock-session:customer', domain: 'localhost', path: '/' },
    { name: 'lcsp_org_id', value: 'org-mock-customer', domain: 'localhost', path: '/' },
    { name: 'lcsp_role', value: 'customer', domain: 'localhost', path: '/' },
  ]);

  const adminContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
  });
  await adminContext.addCookies([
    { name: 'lcsp_locale', value: 'en', domain: 'localhost', path: '/' },
    { name: 'lcsp_session', value: 'mock-session:admin', domain: 'localhost', path: '/' },
    { name: 'lcsp_org_id', value: 'org-mock-admin', domain: 'localhost', path: '/' },
    { name: 'lcsp_role', value: 'admin', domain: 'localhost', path: '/' },
  ]);

  // 1. 05-auth-sign-in-filled-active
  await inspect(publicContext, `${BASE_URL}/sign-in`, '05-auth-sign-in-filled-active', async (p) => {
    const email = p.locator('input[type="email"], input[name="email"]').first();
    const pass = p.locator('input[type="password"]').first();
    if (await email.isVisible()) await email.fill('minhpnq1807@gmail.com');
    if (await pass.isVisible()) await pass.fill('CorrectHorseBatteryStaple!');
  });

  // 2. 14-workspace-select
  await inspect(customerContext, `${BASE_URL}/workspace/select`, '14-workspace-select');

  // 3. 15-workspace-dashboard
  await inspect(customerContext, `${BASE_URL}/workspace`, '15-workspace-dashboard');

  // 4. 16-workspace-sidebar-active
  await inspect(customerContext, `${BASE_URL}/workspace`, '16-workspace-sidebar-active');

  // 5. 17-workspace-user-menu-popover
  await inspect(customerContext, `${BASE_URL}/workspace`, '17-workspace-user-menu-popover', async (p) => {
    const trigger = p.locator('button[data-component="SidebarAccountTrigger"]').first();
    if (await trigger.isVisible()) await trigger.click();
  });

  // 6. 18-workspace-assessments-list
  await inspect(customerContext, `${BASE_URL}/assessments`, '18-workspace-assessments-list');

  // 7. 20-assessment-detail-main
  await inspect(customerContext, `${BASE_URL}/assessments/11111111-1111-4111-8111-111111111111`, '20-assessment-detail-main');

  // 8. 21-assessment-detail-question-open
  await inspect(customerContext, `${BASE_URL}/assessments/11111111-1111-4111-8111-111111111111`, '21-assessment-detail-question-open');

  // 9. 22-assessment-provenance
  await inspect(customerContext, `${BASE_URL}/assessments/11111111-1111-4111-8111-111111111111/provenance`, '22-assessment-provenance');

  // 10. 23-assessment-report
  await inspect(customerContext, `${BASE_URL}/assessments/11111111-1111-4111-8111-111111111111/report`, '23-assessment-report');

  // 11. 24-workspace-compliance
  await inspect(customerContext, `${BASE_URL}/workspace/compliance`, '24-workspace-compliance');

  // 12. 25-workspace-laws
  await inspect(customerContext, `${BASE_URL}/laws`, '25-workspace-laws');

  // 13. 26-workspace-laws-detail
  await inspect(customerContext, `${BASE_URL}/laws/law-mock-1`, '26-workspace-laws-detail');

  // 14. 27-workspace-reports
  await inspect(customerContext, `${BASE_URL}/workspace/reports`, '27-workspace-reports');

  // 15. 32-workspace-settings-modal-billing
  await inspect(customerContext, `${BASE_URL}/workspace`, '32-workspace-settings-modal-billing', async (p) => {
    const trigger = p.locator('button[data-component="SidebarAccountTrigger"]').first();
    if (await trigger.isVisible()) await trigger.click();
    await sleep(400);
    const settingsItem = p.locator('[data-component="AccountPopover"] button, [role="menuitem"]').filter({ hasText: /settings/i }).first();
    if (await settingsItem.isVisible()) await settingsItem.click();
    await sleep(600);
    const billingTab = p.locator('button[data-settings-tab="billing"]').first();
    if (await billingTab.isVisible()) await billingTab.click();
  });

  // 16. 50-admin-legal-sources
  await inspect(adminContext, `${BASE_URL}/admin/legal-sources`, '50-admin-legal-sources');

  // 17. 51-admin-legal-source-detail
  await inspect(adminContext, `${BASE_URL}/admin/legal-sources/11111111-1111-4111-8111-111111111111`, '51-admin-legal-source-detail');

  // 18. 52-admin-compliance-rule-sets
  await inspect(adminContext, `${BASE_URL}/admin/compliance-rule-sets`, '52-admin-compliance-rule-sets');

  // 19. 53-admin-compliance-rule-set-detail
  await inspect(adminContext, `${BASE_URL}/admin/compliance-rule-sets/cccccccc-cccc-4ccc-8ccc-cccccccccccc`, '53-admin-compliance-rule-set-detail');

  // 20. 54-admin-compliance-prepare-modal
  await inspect(adminContext, `${BASE_URL}/admin/compliance-rule-sets`, '54-admin-compliance-prepare-modal', async (p) => {
    const btn = p.locator('button').filter({ hasText: /Prepare|Create/i }).first();
    if (await btn.isVisible()) await btn.click();
  });

  // 21. 56-admin-usage
  await inspect(adminContext, `${BASE_URL}/admin/usage`, '56-admin-usage');

  await browser.close();
}

run();

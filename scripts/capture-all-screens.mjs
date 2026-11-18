import { chromium } from '@playwright/test';
import { mkdirSync } from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:3000';
const OUT_DIR = '/home/khovan/Workplaces/LCSP/screenshort';

mkdirSync(OUT_DIR, { recursive: true });

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureScreen(page, filename, description) {
  const filePath = path.join(OUT_DIR, filename);
  await sleep(700);
  try {
    await page.screenshot({ path: filePath, fullPage: false, animations: 'disabled' });
  } catch {
    await sleep(600);
    await page.screenshot({ path: filePath, fullPage: false, animations: 'disabled' });
  }
  console.log(`[CAPTURED EN] ${filename} - ${description}`);
}

async function createContextWithLocale(browser, extraCookies = []) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    extraHTTPHeaders: {
      'accept-language': 'en-US,en;q=0.9',
    },
  });

  const cookies = [
    {
      name: 'lcsp_locale',
      value: 'en',
      domain: 'localhost',
      path: '/',
    },
    ...extraCookies,
  ];

  await context.addCookies(cookies);
  return context;
}

async function captureRoute(context, url, filename, description, action = null) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(800);
    if (action) {
      await action(page);
    }
    await captureScreen(page, filename, description);
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  console.log('Starting LCSP UI capture session in ENGLISH locale (en) only with mock data...');
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  // ==========================================
  // PART 1: PUBLIC & LANDING & AUTH SCREENS (EN)
  // ==========================================
  console.log('\n--- PART 1: PUBLIC & AUTH SCREENS (EN) ---');
  const publicContext = await createContextWithLocale(browser);

  // 1. Landing Home (EN)
  await captureRoute(publicContext, `${BASE_URL}/en`, '01-landing-home-en.png', 'Landing page (English)');

  // 2. Landing Features (EN)
  await captureRoute(publicContext, `${BASE_URL}/en/features`, '02-landing-features-en.png', 'Features overview (English)');

  // 3. Pricing (EN)
  await captureRoute(publicContext, `${BASE_URL}/en/pricing`, '03-landing-pricing-en.png', 'Pricing plans (English)');

  // 4. Sign-in Clean (EN)
  await captureRoute(publicContext, `${BASE_URL}/sign-in`, '04-auth-sign-in.png', 'Sign-in page default state (English)');

  // 5. Sign-in Filled & Active Button (EN)
  await captureRoute(
    publicContext,
    `${BASE_URL}/sign-in`,
    '05-auth-sign-in-filled-active.png',
    'Sign-in filled with active button (English)',
    async (p) => {
      const email = p.locator('input[type="email"], input[name="email"]').first();
      const pass = p.locator('input[type="password"]').first();
      if (await email.isVisible()) await email.fill('minhpnq1807@gmail.com');
      if (await pass.isVisible()) await pass.fill('CorrectHorseBatteryStaple!');
      const btn = p.locator('button[type="submit"]').first();
      if (await btn.isVisible()) await btn.focus().catch(() => {});
    }
  );

  // 6. Sign-in Error State (EN)
  await captureRoute(
    publicContext,
    `${BASE_URL}/sign-in`,
    '06-auth-sign-in-error.png',
    'Sign-in error state (English)',
    async (p) => {
      const email = p.locator('input[type="email"], input[name="email"]').first();
      const pass = p.locator('input[type="password"]').first();
      if (await email.isVisible()) await email.fill('wrong@user.com');
      if (await pass.isVisible()) await pass.fill('invalidpassword');
      const btn = p.locator('button[type="submit"]').first();
      if (await btn.isVisible()) {
        await btn.click({ timeout: 4000 }).catch(() => {});
        await sleep(1200);
      }
    }
  );

  // 7. Sign-up Clean (EN)
  await captureRoute(publicContext, `${BASE_URL}/sign-up`, '07-auth-sign-up.png', 'Sign-up page default state (English)');

  // 8. Sign-up Filled (EN)
  await captureRoute(
    publicContext,
    `${BASE_URL}/sign-up`,
    '08-auth-sign-up-filled.png',
    'Sign-up with credentials filled (English)',
    async (p) => {
      const name = p.locator('input[name="display_name"], input[placeholder*="name" i]').first();
      const email = p.locator('input[type="email"], input[name="email"]').first();
      const pass = p.locator('input[type="password"]').first();
      if (await name.isVisible()) await name.fill('Alice Customer');
      if (await email.isVisible()) await email.fill('alice@client.io');
      if (await pass.isVisible()) await pass.fill('SecurePassword123!');
    }
  );

  // 9. MFA Verify Clean (EN)
  await captureRoute(publicContext, `${BASE_URL}/mfa/verify`, '09-auth-mfa-verify.png', 'MFA OTP code challenge screen (English)');

  // 10. MFA Verify Filled (EN)
  await captureRoute(
    publicContext,
    `${BASE_URL}/mfa/verify`,
    '10-auth-mfa-verify-filled.png',
    'MFA code filled active state (English)',
    async (p) => {
      const otpInputs = p.locator('input[type="text"], input[inputmode="numeric"]');
      if (await otpInputs.count() >= 6) {
        for (let i = 0; i < 6; i++) {
          await otpInputs.nth(i).fill(String(i + 1));
        }
      } else if (await otpInputs.count() === 1) {
        await otpInputs.first().fill('123456');
      }
    }
  );

  // 11. MFA Enroll (EN)
  await captureRoute(publicContext, `${BASE_URL}/mfa/enroll`, '11-auth-mfa-enroll.png', 'MFA authenticator app enrollment QR screen (English)');

  // 12. Password Recovery Request (EN)
  await captureRoute(publicContext, `${BASE_URL}/recovery/request`, '12-auth-recovery-request.png', 'Password recovery request screen (English)');

  // 13. Password Recovery Confirm (EN)
  await captureRoute(publicContext, `${BASE_URL}/recovery/confirm?token=mock-token`, '13-auth-recovery-confirm.png', 'Password recovery reset confirmation screen (English)');

  await publicContext.close();

  // ==========================================
  // PART 2: CUSTOMER WORKSPACE SCREENS (EN)
  // ==========================================
  console.log('\n--- PART 2: CUSTOMER WORKSPACE SCREENS (EN) ---');
  const customerContext = await createContextWithLocale(browser, [
    {
      name: 'lcsp_session',
      value: 'mock-session:customer',
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  // 14. Workspace Select (EN)
  await captureRoute(customerContext, `${BASE_URL}/workspace/select`, '14-workspace-select.png', 'Workspace organization selector card (English)');

  // 15. Workspace Home / Dashboard (EN)
  await captureRoute(customerContext, `${BASE_URL}/workspace`, '15-workspace-dashboard.png', 'Workspace dashboard main view (English)');

  // 16. Workspace Sidebar Navigation Active (EN)
  await captureRoute(
    customerContext,
    `${BASE_URL}/workspace`,
    '16-workspace-sidebar-active.png',
    'Workspace sidebar with active hover state (English)',
    async (p) => {
      const sidebarLinks = p.locator('nav a, aside a, [data-sidebar] a');
      if (await sidebarLinks.count() > 1) {
        await sidebarLinks.nth(1).hover({ timeout: 1000 }).catch(() => {});
        await sleep(300);
      }
    }
  );

  // 17. Workspace User Menu Popover (EN)
  await captureRoute(
    customerContext,
    `${BASE_URL}/workspace`,
    '17-workspace-user-menu-popover.png',
    'Workspace user profile popover open (English)',
    async (p) => {
      const userAccountTrigger = p.locator('button[data-component="SidebarAccountTrigger"]').first();
      if (await userAccountTrigger.isVisible()) {
        await userAccountTrigger.click();
        await sleep(600);
      }
    }
  );

  // 18. Assessments List (EN)
  await captureRoute(customerContext, `${BASE_URL}/assessments`, '18-workspace-assessments-list.png', 'Assessments list overview (English)');

  // 19. New Assessment Form / Wizard (EN)
  await captureRoute(customerContext, `${BASE_URL}/assessments/new`, '19-workspace-assessment-new.png', 'New assessment creation wizard (English)');

  // 20. Assessment Detail (EN)
  await captureRoute(
    customerContext,
    `${BASE_URL}/assessments/11111111-1111-4111-8111-111111111111`,
    '20-assessment-detail-main.png',
    'Assessment interactive analysis detail (English)'
  );

  // 21. Assessment Detail Interactive (expanded question turn / finding) (EN)
  await captureRoute(
    customerContext,
    `${BASE_URL}/assessments/11111111-1111-4111-8111-111111111111`,
    '21-assessment-detail-question-open.png',
    'Assessment detail with interactive turn active (English)',
    async (p) => {
      const questionTurn = p.locator('[data-turn], [data-finding], button[aria-expanded="false"]').first();
      if (await questionTurn.isVisible()) {
        await questionTurn.click();
        await sleep(500);
      }
    }
  );

  // 22. Assessment Provenance (EN)
  await captureRoute(
    customerContext,
    `${BASE_URL}/assessments/11111111-1111-4111-8111-111111111111/provenance`,
    '22-assessment-provenance.png',
    'Assessment provenance & legal citation trace (English)'
  );

  // 23. Assessment Report (EN)
  await captureRoute(
    customerContext,
    `${BASE_URL}/assessments/11111111-1111-4111-8111-111111111111/report`,
    '23-assessment-report.png',
    'Assessment summary report view (English)'
  );

  // 24. Workspace Compliance (EN)
  await captureRoute(customerContext, `${BASE_URL}/workspace/compliance`, '24-workspace-compliance.png', 'Workspace compliance obligations tracker (English)');

  // 25. Workspace Laws / Legal Library (EN)
  await captureRoute(customerContext, `${BASE_URL}/laws`, '25-workspace-laws.png', 'Legal regulatory library (English)');

  // 26. Law Detail Viewer (EN)
  await captureRoute(
    customerContext,
    `${BASE_URL}/laws/11111111-1111-4111-8111-111111111111`,
    '26-workspace-laws-detail.png',
    'Legal document detail viewer (English)'
  );

  // 27. Workspace Reports (EN)
  await captureRoute(customerContext, `${BASE_URL}/workspace/reports`, '27-workspace-reports.png', 'Workspace reports archive (English)');

  // 28. Workspace Artifacts (EN)
  await captureRoute(customerContext, `${BASE_URL}/artifacts`, '28-workspace-artifacts.png', 'Workspace statutory audit artifacts explorer (English)');

  // ==========================================
  // PART 3: COMPLETE SETTINGS MODALS & VIEWS (EN)
  // ==========================================
  console.log('\n--- PART 3: COMPLETE SETTINGS MODALS (EN) ---');

  // Helper to open Settings Modal
  async function openSettingsModal(p) {
    const trigger = p.locator('button[data-component="SidebarAccountTrigger"]').first();
    if (await trigger.isVisible()) {
      await trigger.click();
      await sleep(400);
      const settingsItem = p.getByRole('menuitem', { name: /settings/i }).or(p.locator('text=Settings')).first();
      if (await settingsItem.isVisible()) {
        await settingsItem.click();
        await sleep(700);
      }
    }
  }

  // 29. Settings Modal - General
  await captureRoute(
    customerContext,
    `${BASE_URL}/workspace`,
    '29-workspace-settings-modal-general.png',
    'Settings modal - General tab (English)',
    async (p) => {
      await openSettingsModal(p);
    }
  );

  // 30. Settings Modal - Account
  await captureRoute(
    customerContext,
    `${BASE_URL}/workspace`,
    '30-workspace-settings-modal-account.png',
    'Settings modal - Account tab (English)',
    async (p) => {
      await openSettingsModal(p);
      const dialog = p.locator('[role="dialog"]').first();
      const tab = dialog.locator('button[data-settings-tab="account"]').or(dialog.locator('button', { hasText: 'Account' })).first();
      if (await tab.isVisible()) {
        await tab.click();
        await sleep(600);
      }
    }
  );

  // 31. Settings Modal - Privacy
  await captureRoute(
    customerContext,
    `${BASE_URL}/workspace`,
    '31-workspace-settings-modal-privacy.png',
    'Settings modal - Privacy tab (English)',
    async (p) => {
      await openSettingsModal(p);
      const dialog = p.locator('[role="dialog"]').first();
      const tab = dialog.locator('button[data-settings-tab="privacy"]').or(dialog.locator('button', { hasText: 'Privacy' })).first();
      if (await tab.isVisible()) {
        await tab.click();
        await sleep(600);
      }
    }
  );

  // 32. Settings Modal - Billing
  await captureRoute(
    customerContext,
    `${BASE_URL}/workspace`,
    '32-workspace-settings-modal-billing.png',
    'Settings modal - Billing tab (English)',
    async (p) => {
      await openSettingsModal(p);
      const dialog = p.locator('[role="dialog"]').first();
      const tab = dialog.locator('button[data-settings-tab="billing"]').or(dialog.locator('button', { hasText: 'Billing' })).first();
      if (await tab.isVisible()) {
        await tab.click();
        await sleep(700);
      }
    }
  );

  // 33. Settings Modal - Usage
  await captureRoute(
    customerContext,
    `${BASE_URL}/workspace`,
    '33-workspace-settings-modal-usage.png',
    'Settings modal - Usage tab (English)',
    async (p) => {
      await openSettingsModal(p);
      const dialog = p.locator('[role="dialog"]').first();
      const tab = dialog.locator('button[data-settings-tab="usage"]').or(dialog.locator('button', { hasText: 'Usage' })).first();
      if (await tab.isVisible()) {
        await tab.click();
        await sleep(700);
      }
    }
  );

  // 34. Settings Modal - Capabilities
  await captureRoute(
    customerContext,
    `${BASE_URL}/workspace`,
    '34-workspace-settings-modal-capabilities.png',
    'Settings modal - Capabilities tab (English)',
    async (p) => {
      await openSettingsModal(p);
      const dialog = p.locator('[role="dialog"]').first();
      const tab = dialog.locator('button[data-settings-tab="capabilities"]').or(dialog.locator('button', { hasText: 'Capabilities' })).first();
      if (await tab.isVisible()) {
        await tab.click();
        await sleep(600);
      }
    }
  );

  // 35. Settings Modal - Connectors
  await captureRoute(
    customerContext,
    `${BASE_URL}/workspace`,
    '35-workspace-settings-modal-connectors.png',
    'Settings modal - Connectors tab (English)',
    async (p) => {
      await openSettingsModal(p);
      const dialog = p.locator('[role="dialog"]').first();
      const tab = dialog.locator('button[data-settings-tab="connectors"]').or(dialog.locator('button', { hasText: 'Connectors' })).first();
      if (await tab.isVisible()) {
        await tab.click();
        await sleep(800);
      }
    }
  );

  // 36. Settings Modal - Manage Provider Credential Dialog
  await captureRoute(
    customerContext,
    `${BASE_URL}/workspace`,
    '36-workspace-settings-modal-manage-provider.png',
    'Provider credential dialog - Manage PAT mode (English)',
    async (p) => {
      await openSettingsModal(p);
      const dialog = p.locator('[role="dialog"]').first();
      const tab = dialog.locator('button[data-settings-tab="connectors"]').or(dialog.locator('button', { hasText: 'Connectors' })).first();
      if (await tab.isVisible()) {
        await tab.click();
        await sleep(700);
      }
      const manageBtn = dialog.locator('[data-component="ConnectorProviderRow"] button', { hasText: /manage/i }).first();
      if (await manageBtn.isVisible()) {
        await manageBtn.click();
        await sleep(600);
      }
    }
  );

  // 37. Settings Modal - Provider Disconnect Confirm Dialog
  await captureRoute(
    customerContext,
    `${BASE_URL}/workspace`,
    '37-workspace-settings-modal-disconnect-confirm.png',
    'Provider credential disconnect confirmation modal (English)',
    async (p) => {
      await openSettingsModal(p);
      const dialog = p.locator('[role="dialog"]').first();
      const tab = dialog.locator('button[data-settings-tab="connectors"]').or(dialog.locator('button', { hasText: 'Connectors' })).first();
      if (await tab.isVisible()) {
        await tab.click();
        await sleep(700);
      }
      const manageBtn = dialog.locator('[data-component="ConnectorProviderRow"] button', { hasText: /manage/i }).first();
      if (await manageBtn.isVisible()) {
        await manageBtn.click();
        await sleep(600);
        const disconnectBtn = p.locator('[role="dialog"] button', { hasText: /disconnect/i }).last();
        if (await disconnectBtn.isVisible()) {
          await disconnectBtn.click();
          await sleep(600);
        }
      }
    }
  );

  // 38. Settings Modal - Connect Provider (GitLab / Bitbucket) Dialog
  await captureRoute(
    customerContext,
    `${BASE_URL}/workspace`,
    '38-workspace-settings-modal-connect-provider.png',
    'Provider credential dialog - Connect provider PAT mode (English)',
    async (p) => {
      await openSettingsModal(p);
      const dialog = p.locator('[role="dialog"]').first();
      const tab = dialog.locator('button[data-settings-tab="connectors"]').or(dialog.locator('button', { hasText: 'Connectors' })).first();
      if (await tab.isVisible()) {
        await tab.click();
        await sleep(700);
      }
      const connectBtn = dialog.locator('[data-component="ConnectorProviderRow"] button', { hasText: /connect/i }).first();
      if (await connectBtn.isVisible()) {
        await connectBtn.click();
        await sleep(600);
      }
    }
  );

  // 39. Settings Modal - Confirm Access / Reauthentication Dialog
  await captureRoute(
    customerContext,
    `${BASE_URL}/workspace`,
    '39-workspace-settings-modal-confirm-access.png',
    'Settings confirm access & reauthentication challenge modal (English)',
    async (p) => {
      await openSettingsModal(p);
      const dialog = p.locator('[role="dialog"]').first();
      const tab = dialog.locator('button[data-settings-tab="account"]').or(dialog.locator('button', { hasText: 'Account' })).first();
      if (await tab.isVisible()) {
        await tab.click();
        await sleep(700);
      }
      const revokeBtn = dialog.locator('button', { hasText: /revoke/i }).first();
      if (await revokeBtn.isVisible()) {
        await revokeBtn.click();
        await sleep(600);
      }
    }
  );

  // 40. Preview Compliance Screen (EN)
  await captureRoute(customerContext, `${BASE_URL}/preview-compliance`, '40-preview-compliance.png', 'Preview compliance rich split view (English)');

  // 41. Preview Compliance Interactive (Click Rule / Question) (EN)
  await captureRoute(
    customerContext,
    `${BASE_URL}/preview-compliance`,
    '41-preview-compliance-expanded.png',
    'Preview compliance with expanded finding/rule (English)',
    async (p) => {
      const previewItem = p.locator('[data-assessment-rule], button[aria-expanded="false"], [role="button"]').first();
      if (await previewItem.isVisible()) {
        await previewItem.click();
        await sleep(600);
      }
    }
  );

  await customerContext.close();

  // ==========================================
  // PART 4: ADMIN PORTAL SCREENS (EN)
  // ==========================================
  console.log('\n--- PART 4: ADMIN PORTAL SCREENS (EN) ---');
  const adminContext = await createContextWithLocale(browser, [
    {
      name: 'lcsp_session',
      value: 'mock-session:admin',
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  // 42. Admin Overview (EN)
  await captureRoute(adminContext, `${BASE_URL}/admin/overview`, '42-admin-overview.png', 'Admin overview metrics & charts (English)');

  // 43. Admin Overview Period Popover (EN)
  await captureRoute(
    adminContext,
    `${BASE_URL}/admin/overview`,
    '43-admin-overview-period-popover.png',
    'Admin overview period popover open (English)',
    async (p) => {
      const periodSelector = p.locator('[data-period-selector], button[aria-haspopup="listbox"], button[aria-haspopup="menu"]').first();
      if (await periodSelector.isVisible()) {
        await periodSelector.click();
        await sleep(500);
      }
    }
  );

  // 44. Admin User Popover (EN)
  await captureRoute(
    adminContext,
    `${BASE_URL}/admin/overview`,
    '44-admin-overview-user-popover.png',
    'Admin user profile popover open (English)',
    async (p) => {
      const adminUserBtn = p.locator('[data-user-menu], button[aria-haspopup="menu"]').first();
      if (await adminUserBtn.isVisible()) {
        await adminUserBtn.click();
        await sleep(500);
      }
    }
  );

  // 45. Admin Users (EN)
  await captureRoute(adminContext, `${BASE_URL}/admin/users`, '45-admin-users.png', 'Admin user accounts management table (English)');

  // 46. Admin User Detail (EN)
  await captureRoute(adminContext, `${BASE_URL}/admin/users/usr_1`, '46-admin-user-detail.png', 'Admin user account detail & lifecycle view (English)');

  // 47. Admin Billing (EN)
  await captureRoute(adminContext, `${BASE_URL}/admin/billing`, '47-admin-billing.png', 'Admin billing dark dashboard & payments reconciliation (English)');

  // 48. Admin Billing Filter Popover (EN)
  await captureRoute(
    adminContext,
    `${BASE_URL}/admin/billing`,
    '48-admin-billing-filter-popover.png',
    'Admin billing filter popover open (English)',
    async (p) => {
      const billingFilter = p.locator('button[aria-haspopup="menu"], button[aria-haspopup="listbox"], button[role="combobox"]').first();
      if (await billingFilter.isVisible()) {
        await billingFilter.click();
        await sleep(500);
      }
    }
  );

  // 49. Admin Billing Export Modal (EN)
  await captureRoute(
    adminContext,
    `${BASE_URL}/admin/billing`,
    '49-admin-billing-export-modal.png',
    'Admin billing export report modal open (English)',
    async (p) => {
      const exportBtn = p.locator('button').filter({ hasText: /export|download/i }).first();
      if (await exportBtn.isVisible()) {
        await exportBtn.click();
        await sleep(600);
      }
    }
  );

  // 50. Admin Legal Sources (EN)
  await captureRoute(adminContext, `${BASE_URL}/admin/legal-sources`, '50-admin-legal-sources.png', 'Admin legal sources management catalog (English)');

  // 51. Admin Legal Source Detail (EN)
  await captureRoute(
    adminContext,
    `${BASE_URL}/admin/legal-sources/11111111-1111-4111-8111-111111111111`,
    '51-admin-legal-source-detail.png',
    'Admin legal source detail & versions view (English)'
  );

  // 52. Admin Compliance Rule Sets (EN)
  await captureRoute(adminContext, `${BASE_URL}/admin/compliance-rule-sets`, '52-admin-compliance-rule-sets.png', 'Admin compliance rule sets history (English)');

  // 53. Admin Compliance Rule Set Detail (EN)
  await captureRoute(
    adminContext,
    `${BASE_URL}/admin/compliance-rule-sets/cccccccc-cccc-4ccc-8ccc-cccccccccccc`,
    '53-admin-compliance-rule-set-detail.png',
    'Admin compliance rule set detail view (English)'
  );

  // 54. Admin Compliance Prepare Modal (EN)
  await captureRoute(
    adminContext,
    `${BASE_URL}/admin/compliance-rule-sets`,
    '54-admin-compliance-prepare-modal.png',
    'Admin prepare rule set modal open (English)',
    async (p) => {
      const prepareBtn = p.locator('button').filter({ hasText: /prepare|create/i }).first();
      if (await prepareBtn.isVisible()) {
        await prepareBtn.click();
        await sleep(600);
      }
    }
  );

  // 55. Admin Tracking (EN)
  await captureRoute(adminContext, `${BASE_URL}/admin/tracking`, '55-admin-tracking.png', 'Admin operational telemetry & audit stream (English)');

  // 56. Admin Usage (EN)
  await captureRoute(adminContext, `${BASE_URL}/admin/usage`, '56-admin-usage.png', 'Admin token usage & platform metrics (English)');

  // 57. Admin Sidebar Mobile / Sheet (EN)
  const mPage = await adminContext.newPage();
  await mPage.setViewportSize({ width: 768, height: 1024 });
  await mPage.goto(`${BASE_URL}/admin/overview`, { waitUntil: 'domcontentloaded' });
  await sleep(800);
  const menuToggle = mPage.locator('button[aria-label*="navigation" i], button[aria-label*="menu" i], header button').first();
  if (await menuToggle.isVisible()) {
    await menuToggle.click();
    await sleep(600);
  }
  await captureScreen(mPage, '57-admin-sidebar-mobile-sheet.png', 'Admin mobile sheet sidebar open (English)');
  await mPage.close().catch(() => {});

  await adminContext.close();
  await browser.close();

  console.log('\n[SUCCESS] All screens, popovers, and settings modals successfully captured in ENGLISH (en) into: ' + OUT_DIR);
}

main().catch((err) => {
  console.error('[ERROR]', err);
  process.exit(1);
});

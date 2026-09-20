import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("Billing Settings renders the server-backed customer surface", async () => {
  const [settings, billing] = await Promise.all([
    read("../src/features/settings/components/organisms/settings-page.tsx"),
    read(
      "../src/features/billing/components/organisms/billing-settings-panel.tsx",
    ),
  ]);
  const billingStart = settings.indexOf(
    "activeSection === SETTINGS_SECTION_IDS.billing ?",
  );
  const billingEnd = settings.indexOf(
    "activeSection === SETTINGS_SECTION_IDS.usage ?",
    billingStart,
  );
  const billingBranch = settings.slice(billingStart, billingEnd);

  assert.match(billingBranch, /BillingSettingsPanel/);
  assert.doesNotMatch(billingBranch, /UnsupportedSettingsPanel/);
  assert.match(billing, /useBillingWalletQuery/);
  assert.match(billing, /useBillingHistoryQuery/);
  assert.match(billing, /useBillingHistoryQuery\(historyPage\)/);
  assert.match(billing, /pages\.workspace\.settingsHub\.billing\.nextPage/);
  assert.match(billing, /useCreateBillingOrderMutation/);
  assert.doesNotMatch(billing, /mock|fake|fixture/i);
});

test("Billing top-up uses authenticated BFF requests and idempotency", async () => {
  const [client, ordersRoute, historyRoute, walletRoute] = await Promise.all([
    read("../src/lib/api/billing-client.ts"),
    read("../src/app/api/billing/orders/route.ts"),
    read("../src/app/api/billing/history/route.ts"),
    read("../src/app/api/billing/wallet/route.ts"),
  ]);

  assert.match(client, /apiRequest/);
  assert.match(client, /idempotency-key/);
  assert.match(ordersRoute, /idempotency-key/);
  assert.match(ordersRoute, /requireSessionToken/);
  assert.match(
    await read(
      "../src/features/billing/components/organisms/billing-settings-panel.tsx",
    ),
    /orderIntent\?\.amountVnd === values\.amountVnd/,
  );
  assert.match(historyRoute, /requireSessionToken/);
  assert.match(walletRoute, /requireSessionToken/);
});

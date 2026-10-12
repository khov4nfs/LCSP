import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const customerBillingPaths = [
  "apps/web/src/features/billing/components/organisms/billing-settings-panel.tsx",
  "apps/web/src/features/billing/schemas/billing-top-up.schema.ts",
  "apps/web/src/features/billing/utils/billing-order-presentation.ts",
  "apps/web/src/lib/api/billing-client.ts",
  "apps/web/src/lib/api/billing-queries.ts",
  "apps/web/src/app/api/billing/estimate/route.ts",
  "apps/web/src/app/api/billing/history/route.ts",
  "apps/web/src/app/api/billing/orders/route.ts",
  "apps/web/src/app/api/billing/orders/[id]/route.ts",
  "apps/web/src/app/api/billing/wallet/route.ts",
];

const adminBillingPaths = [
  "apps/web/src/app/(admin)/admin/billing/page.tsx",
  "apps/web/src/app/api/admin/billing/route.ts",
  "apps/web/src/features/admin/components/organisms/admin-billing-page.tsx",
  "apps/web/src/lib/api/admin-billing-client.ts",
  "apps/web/src/lib/api/admin-billing-queries.ts",
];

const [customerContents, adminContents] = await Promise.all([
  Promise.all(customerBillingPaths.map((path) => readFile(path, "utf8"))),
  Promise.all(adminBillingPaths.map((path) => readFile(path, "utf8"))),
]);
const customerSource = customerContents.join("\n");
const adminSource = adminContents.join("\n");
const productionSource = `${customerSource}\n${adminSource}`;

assert.match(customerSource, /useBillingWalletQuery\(/);
assert.match(customerSource, /getBillingWallet\(/);
assert.match(customerSource, /upstreamRequest\("\/billing\/wallet"/);
assert.match(adminSource, /useAdminBillingQuery\(/);
assert.match(adminSource, /validatedBillingUpstreamJson\(/);
assert.match(adminSource, /billingAdminDashboardSchema\.safeParse\(/);
assert.doesNotMatch(
  productionSource,
  /assets\/mocks|isMockModeEnabled|mockJsonResponse|readMockJson|mockFallback|fallbackBalance|fallbackRevenue|fallbackPayment|fabricated/i,
  "Customer and Admin Billing production paths must use validated API data only",
);

console.log("Billing release gate source checks passed.");

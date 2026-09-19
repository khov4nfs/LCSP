import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it } from "@jest/globals";
import { BillingModule } from "../src/modules/billing/billing.module.js";
import { BillingAccountingKernel } from "../src/modules/billing/application/shared/billing-accounting.kernel.js";
import { BillingPaymentKernel } from "../src/modules/billing/application/shared/billing-payment.kernel.js";
import { BILLING_USAGE_KERNEL } from "../src/modules/billing/application/shared/billing-usage.kernel.js";

describe("BillingModule dependency injection", () => {
  let moduleRef: { close: () => Promise<void> } | undefined;

  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
  });

  it("resolves billing command handlers through the runtime transaction token", async () => {
    const compiled = await Test.createTestingModule({
      imports: [BillingModule],
    }).compile();
    moduleRef = compiled;
    expect(compiled.get(BillingAccountingKernel)).toBeInstanceOf(
      BillingAccountingKernel,
    );
    expect(compiled.get(BillingPaymentKernel)).toBeInstanceOf(
      BillingPaymentKernel,
    );
    expect(compiled.get(BILLING_USAGE_KERNEL)).toBeDefined();
  });
});

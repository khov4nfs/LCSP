import { describe, expect, it } from "@jest/globals";
import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import {
  ADMISSION_STATES,
  MODEL_USAGE_DEBIT_MODES,
  TOKEN_BUCKET_POLICIES,
} from "@lcsp/contracts/billing";

import { PrismaModule } from "../../infrastructure/prisma/prisma.module.js";
import { AuditModule } from "../../platform/audit/audit.module.js";
import { RbacModule } from "../../platform/rbac/rbac.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { BillingModule } from "./billing.module.js";
import {
  BILLING_USAGE_KERNEL,
  type BillingUsageKernel,
} from "./application/shared/billing-usage.kernel.js";
import { BillingAccountingKernel } from "./application/shared/billing-accounting.kernel.js";
import { BillingPaymentKernel } from "./application/shared/billing-payment.kernel.js";
import { BillingDomainError } from "./domain/billing.errors.js";

const admissionFixture = {
  invocationId: "inv-di-test-1",
  walletId: "wallet-di-1",
  maximumExposureMicrocredits: 200_000n,
  ratesMicrocreditsPerMillion: {
    input: 1_000_000n,
    output: 2_000_000n,
    reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
  },
};

describe("BillingModule DI", () => {
  it("compiles and resolves all billing controllers and core kernels", async () => {
    // Why: Ensure BillingModule graph compiles completely and registers all controllers and kernels.
    // How: Compile a TestingModule importing BillingModule alongside its platform dependencies.
    // Invariants: Kernels and controllers must be instantiable without missing dependency errors.
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        AuditModule,
        RbacModule,
        AuthModule,
        BillingModule,
      ],
    }).compile();

    expect(moduleRef.get(BillingAccountingKernel)).toBeDefined();
    expect(moduleRef.get(BillingPaymentKernel)).toBeDefined();
    expect(moduleRef.get(BILLING_USAGE_KERNEL)).toBeDefined();
  });

  it("resolves BILLING_USAGE_KERNEL via DI with ConfigService providing SHADOW mode", async () => {
    // Why: Verify the factory provider in billing.module.ts (line 79) injects ConfigService into BillingUsageKernel
    // so that SHADOW configuration reaches the kernel without requiring manual test instantiation.
    // How: Initialize ConfigModule with modelUsageDebit.mode = SHADOW, resolve BILLING_USAGE_KERNEL via DI,
    // and verify settleAdmittedUsage automatically uses SHADOW debit mode when caller leaves input.debitMode unset.
    // Invariants: Configured mode must drive kernel settlement when caller does not override.
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              modelUsageDebit: {
                mode: MODEL_USAGE_DEBIT_MODES.SHADOW,
              },
            }),
          ],
        }),
        PrismaModule,
        AuditModule,
        RbacModule,
        AuthModule,
        BillingModule,
      ],
    }).compile();

    const kernel = moduleRef.get<BillingUsageKernel>(BILLING_USAGE_KERNEL);
    expect(kernel).toBeDefined();

    const settled = kernel.settleAdmittedUsage({
      admission: admissionFixture,
      reportedUsage: {
        invocationId: "inv-di-test-1",
        inputTokens: 50_000n,
        outputTokens: 25_000n,
      },
      currentLedgerBalanceMicrocredits: 1_000_000n,
    });

    expect(settled.debitMode).toBe(MODEL_USAGE_DEBIT_MODES.SHADOW);
    expect(settled.actualChargeMicrocredits).toBe(100_000n);
    expect(settled.state).toBe(ADMISSION_STATES.SETTLED);
    expect(settled.projectedWallet.ledgerBalanceMicrocredits).toBe("900000");
  });

  it("resolves BILLING_USAGE_KERNEL via DI with ConfigService providing ON mode and fails closed", async () => {
    // Why: Verify fail-closed security gate works when ConfigService provides ON through the live DI container.
    // How: Initialize ConfigModule with modelUsageDebit.mode = ON and assert settleAdmittedUsage throws BillingDomainError.
    // Invariants: MODEL_USAGE_DEBIT = ON must never execute in WP8 regardless of entry point.
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              modelUsageDebit: {
                mode: MODEL_USAGE_DEBIT_MODES.ON,
              },
            }),
          ],
        }),
        PrismaModule,
        AuditModule,
        RbacModule,
        AuthModule,
        BillingModule,
      ],
    }).compile();

    const kernel = moduleRef.get<BillingUsageKernel>(BILLING_USAGE_KERNEL);
    expect(kernel).toBeDefined();

    expect(() =>
      kernel.settleAdmittedUsage({
        admission: admissionFixture,
        reportedUsage: {
          invocationId: "inv-di-test-1",
          inputTokens: 10n,
          outputTokens: 10n,
        },
        currentLedgerBalanceMicrocredits: 1_000_000n,
      }),
    ).toThrow(BillingDomainError);
  });
});

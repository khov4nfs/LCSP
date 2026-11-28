import { BILLING_ACTIONS } from "@lcsp/contracts/billing";
import type { CommandBus, QueryBus } from "@nestjs/cqrs";
import { HttpException } from "@nestjs/common";
import { RBAC_ACTIONS_METADATA_KEY } from "../../../../platform/rbac/decorators/require-actions.decorator.js";
import { BillingAdminReconciliationController } from "./billing-admin-reconciliation.controller.js";

describe("Billing Admin reconciliation mutation authority", () => {
  it("requires the reconciliation decision action for both no-usage resolution routes", () => {
    // Why: Either route can close an unresolved billable invocation and release its wallet slot.
    // How: Inspect the action metadata consumed by RbacGuard for each mutation endpoint.
    // Invariant: An ADMIN role alone never grants financial reconciliation authority.
    const decisionMethod: unknown = Object.getOwnPropertyDescriptor(
      BillingAdminReconciliationController.prototype,
      "decideCase",
    )?.value;
    const legacyMethod: unknown = Object.getOwnPropertyDescriptor(
      BillingAdminReconciliationController.prototype,
      "resolveNoUsage",
    )?.value;
    const decision = Reflect.getMetadata(
      RBAC_ACTIONS_METADATA_KEY,
      decisionMethod as object,
    ) as readonly string[] | undefined;
    const legacyResolution = Reflect.getMetadata(
      RBAC_ACTIONS_METADATA_KEY,
      legacyMethod as object,
    ) as readonly string[] | undefined;

    expect(decision).toContain(BILLING_ACTIONS.reconciliationDecision);
    expect(legacyResolution).toContain(BILLING_ACTIONS.reconciliationDecision);
  });

  it("preserves the request correlation ID when a case-list query fails", async () => {
    // Why: Admin queue failures must remain traceable to the request across the BFF and API.
    // How: Exercise the controller's problem mapping with a known query validation failure.
    // Invariant: A fixed fallback ID must not replace a supplied correlation ID.
    const queryBus = {
      execute: () =>
        Promise.reject(new Error("BILLING_REPORTING_INVALID_INPUT: page")),
    } as unknown as QueryBus;
    const controller = new BillingAdminReconciliationController(
      {} as never,
      queryBus,
    );

    try {
      await controller.listCases(
        { page: 1, take: 10 } as never,
        { correlationId: "corr-reconciliation-red" } as never,
      );
      throw new Error("Expected a billing validation problem");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      if (!(error instanceof HttpException)) throw error;
      expect(JSON.stringify(error.getResponse())).toContain(
        '"correlationId":"corr-reconciliation-red"',
      );
    }
  });

  it("binds the authenticated Admin identity to a no-usage resolution", async () => {
    // Why: A literal actor name cannot identify who authorized release of financial exposure.
    // How: Inspect the command sent to the handler from the authenticated request context.
    // Invariant: The eventual resolvedBy audit field must be attributable to this Admin.
    const dispatched: unknown[] = [];
    const commandBus = {
      execute: (command: unknown) => {
        dispatched.push(command);
        return Promise.resolve({ slotReleased: false });
      },
    } as unknown as CommandBus;
    const controller = new BillingAdminReconciliationController(
      commandBus,
      {} as never,
    );

    await controller.resolveNoUsage(
      {} as never,
      {
        correlationId: "corr-admin-actor",
        rbacContext: { userId: "admin-user-123" },
      } as never,
    );

    expect(dispatched[0]).toMatchObject({ actorId: "admin-user-123" });
  });
});

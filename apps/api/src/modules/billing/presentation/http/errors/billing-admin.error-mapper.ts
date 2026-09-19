import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { BILLING_RECONCILIATION_ERROR_CODES } from "@lcsp/contracts/billing";

export function toBillingAdminProblem(
  error: unknown,
  correlationId: string,
): never {
  const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
  const mapped =
    code === "PAYMENT_NOT_FOUND"
      ? ([BILLING_RECONCILIATION_ERROR_CODES.paymentNotFound, 404] as const)
      : code === "RATIONALE_REQUIRED"
        ? ([BILLING_RECONCILIATION_ERROR_CODES.rationaleRequired, 400] as const)
        : code === "BILLING_RECONCILIATION_OWNERSHIP_CONFLICT"
          ? ([
              BILLING_RECONCILIATION_ERROR_CODES.ownershipConflict,
              409,
            ] as const)
          : code === "BILLING_ORDER_NOT_ELIGIBLE"
            ? ([
                BILLING_RECONCILIATION_ERROR_CODES.orderNotEligible,
                409,
              ] as const)
            : code === "BILLING_AMOUNT_MISMATCH"
              ? ([
                  BILLING_RECONCILIATION_ERROR_CODES.amountMismatch,
                  422,
                ] as const)
              : code === "RECONCILIATION_VERSION_CONFLICT" ||
                  code === "BILLING_ORDER_STATE_CONFLICT"
                ? ([
                    BILLING_RECONCILIATION_ERROR_CODES.staleDecision,
                    409,
                  ] as const)
                : null;
  if (!mapped) {
    if (error instanceof Error) throw error;
    throw new Error("INTERNAL_ERROR", { cause: error });
  }
  throw problemException(mapped[0], correlationId, { status: mapped[1] });
}

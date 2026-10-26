import {
  ADMIN_ACCOUNT_ERRORS,
  adminUserActionSchema,
  type AdminUserActionInput,
} from "@lcsp/contracts/auth";
import { HttpStatus } from "@nestjs/common";

import { problemException } from "../../../../platform/http/filters/error.factory.js";

/**
 * CommandBus and direct application calls must enforce the same strict
 * suspend/restore contract as the HTTP boundary. In particular, a retired
 * role property must never reach an account lifecycle transaction.
 */
export function validateAdminUserAction(
  input: unknown,
  correlationId: string,
): AdminUserActionInput {
  const parsed = adminUserActionSchema.safeParse(input);
  if (!parsed.success) {
    throw problemException(ADMIN_ACCOUNT_ERRORS.invalidInput, correlationId, {
      status: HttpStatus.BAD_REQUEST,
    });
  }
  return parsed.data;
}

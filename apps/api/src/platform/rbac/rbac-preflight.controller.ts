import { Body, Controller, Post, UseGuards } from "@nestjs/common";

import { resultEnvelope } from "../http/filters/error.factory.js";
import { ZodValidationPipe } from "../http/pipes/zod-validation.pipe.js";
import { WorkerApiKeyGuard } from "./guards/worker-api-key.guard.js";
import {
  parseRequiredRoles,
  rbacPreflightSchema,
  type RbacPreflightDto,
} from "./rbac-preflight.dto.js";
import { normalizeCorrelationId } from "./correlation-id.js";
import { RbacPreflightService } from "./rbac-preflight.service.js";

/**
 * Exposes the internal worker preflight endpoint used to re-evaluate RBAC immediately before task execution.
 * Protected by WorkerApiKeyGuard to ensure only authorized internal worker services can invoke it.
 */
@UseGuards(WorkerApiKeyGuard)
@Controller("internal/rbac")
export class RbacPreflightController {
  /**
   * Creates the controller with RBAC evaluation service dependency.
   *
   * @param preflightService - Service that re-evaluates worker task authorization.
   */
  constructor(private readonly preflightService: RbacPreflightService) {}

  /**
   * Business purpose: Evaluate RBAC permissions for internal worker operations before execution.
   * Business rules:
   * - Caller must be an authenticated internal worker verified via WorkerApiKeyGuard.
   * - Preflight evaluation resolves allowable actions based on provided user ID and required roles.
   * - Both reasonCode and reason_code are included in response for cross-language compatibility.
   * Execution flow:
   * 1. WorkerApiKeyGuard validates the x-worker-api-key header before entering this handler.
   * 2. ZodValidationPipe validates and sanitizes incoming preflight request payload.
   * 3. Extract normalized user identifier and filter required roles against allowed role values.
   * 4. Invoke RbacPreflightService to evaluate authorization decision.
   * 5. Wrap authorization decision and reason codes in standard resultEnvelope.
   * Failure cases:
   * - Missing or invalid worker API key triggers 401 UNAUTHORIZED in WorkerApiKeyGuard.
   * - Malformed request body triggers 400 BAD_REQUEST in ZodValidationPipe.
   * Side effects:
   * - Pure evaluation; records authorization decision in database via RbacPreflightService.
   */
  @Post("preflight")
  async preflight(
    @Body(new ZodValidationPipe(rbacPreflightSchema)) body: RbacPreflightDto,
  ) {
    // Rationale (Why):
    // Support both snake_case (Python worker) and camelCase (TS clients) property names.
    // Mechanism (How):
    // Fall back to snake_case if camelCase is not present, ensuring consistent payload parsing.
    // Invariants (What):
    // Output is wrapped in standard canonical result envelope { ok: true, data: { ... } }.
    const userId = body.userId ?? body.user_id ?? "";
    const rawRoles = body.requiredRoles ?? body.required_roles;
    const requiredRoles = parseRequiredRoles(rawRoles);
    const correlationId = normalizeCorrelationId(body.correlationId);

    const result = await this.preflightService.evaluate({
      userId,
      requiredRoles,
      correlationId,
    });

    return resultEnvelope({
      decision: result.decision,
      reasonCode: result.reasonCode,
      reason_code: result.reasonCode,
      correlationId: result.correlationId,
    });
  }
}

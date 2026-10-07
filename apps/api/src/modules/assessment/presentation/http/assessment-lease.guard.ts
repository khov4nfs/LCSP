import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  assessmentRootClaimSchema,
} from "@lcsp/contracts/assessment-domain";
import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
} from "@nestjs/common";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";

export const ASSESSMENT_LEASE_HEADER = "x-assessment-lease";

/**
 * Authority before content: a Root tool call without a lease is rejected before any body is
 * parsed. The lease itself is verified against server state by the use-case handler.
 */
@Injectable()
export class AssessmentLeaseGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const lease = request.headers?.[ASSESSMENT_LEASE_HEADER];
    if (!assessmentRootClaimSchema.shape.leaseToken.safeParse(lease).success) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.EXECUTION_LEASE_INVALID,
        request.correlationId ?? "",
        { status: HttpStatus.FORBIDDEN },
      );
    }
    return true;
  }
}

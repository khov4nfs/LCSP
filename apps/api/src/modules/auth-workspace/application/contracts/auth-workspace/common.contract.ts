import type { AuthMembershipStatus, ProblemResult } from "@lcsp/contracts/auth";

export type SafeUserProjection = {
  user_id: string;
  email: string;
  organization_id: string;
  membership_status: AuthMembershipStatus;
  // Roles are policy-defined and may extend beyond the built-in PBAC roles.
  subject_attributes: { role?: string };
};

export type RequestMeta = {
  correlationId?: string;
  app_origin?: string;
};

export type AuthProblemResult = ProblemResult;

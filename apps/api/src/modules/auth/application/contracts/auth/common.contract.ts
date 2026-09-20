import type { AuthUserRole, ProblemResult } from "@lcsp/contracts/auth";

export type SafeUserProjection = {
  user_id: string;
  email: string;
  subject_attributes: { role: AuthUserRole };
};

export type RequestMeta = {
  correlationId?: string;
  app_origin?: string;
};

export type AuthProblemResult = ProblemResult;

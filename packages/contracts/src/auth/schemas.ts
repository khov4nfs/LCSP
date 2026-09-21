import { z } from "zod";

import {
  ADMIN_ACCOUNT_FILTERS,
  ADMIN_ACCOUNT_QUERY_LIMITS,
} from "./admin-accounts.ts";
import { ADMIN_OVERVIEW_PERIODS } from "./admin-overview.ts";
import { AUTH_BACKUP_EMAIL_POLICIES } from "./backup-email-policy.ts";
import { MFA_RECOVERY_CODE_ACCESS_ACTIONS } from "./mfa.ts";
import { AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES } from "./primary-email-address-policy.ts";
import { AUTH_USER_ROLES } from "./roles.ts";
import { AUTH_ACCOUNT_STATUSES } from "./states.ts";

/**
 * Validation schema and input type for user sign-in.
 */
export const signInSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});
export type SignInInput = z.infer<typeof signInSchema>;

/**
 * Validation schema and input type for self-service user registration.
 */
export const signUpSchema = z.object({
  display_name: z.string().trim().min(1).max(100),
  email: z.string().trim().email(),
  password: z.string().min(12),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

/**
 * Validation schema and input type for session revocation by session token.
 */
export const revokeSessionSchema = z.object({
  session_token: z.string().min(1),
});
export type RevokeSessionInput = z.infer<typeof revokeSessionSchema>;

/**
 * Validation schema and input type for verifying MFA TOTP during sign-in.
 */
export const verifyMfaOtpSchema = z.object({
  session_token: z.string().min(1),
  otp: z.string().trim().min(1),
});
export type VerifyMfaOtpInput = z.infer<typeof verifyMfaOtpSchema>;

/**
 * Validation schema and input type for verifying MFA backup recovery code during sign-in.
 */
export const verifyMfaRecoveryCodeSchema = z.object({
  session_token: z.string().min(1),
  code: z.string().trim().min(1),
});
export type VerifyMfaRecoveryCodeInput = z.infer<
  typeof verifyMfaRecoveryCodeSchema
>;

/**
 * Validation schema and input type for recording audit access to MFA recovery codes.
 */
export const recordMfaRecoveryCodeAccessSchema = z.object({
  action: z.enum(
    Object.values(MFA_RECOVERY_CODE_ACCESS_ACTIONS) as [
      (typeof MFA_RECOVERY_CODE_ACCESS_ACTIONS)[keyof typeof MFA_RECOVERY_CODE_ACCESS_ACTIONS],
      ...(typeof MFA_RECOVERY_CODE_ACCESS_ACTIONS)[keyof typeof MFA_RECOVERY_CODE_ACCESS_ACTIONS][],
    ],
  ),
});
export type RecordMfaRecoveryCodeAccessInput = z.infer<
  typeof recordMfaRecoveryCodeAccessSchema
>;

/**
 * Validation schema and input type for initiating a password recovery flow.
 */
export const requestPasswordRecoverySchema = z.object({
  email: z.string().trim().email(),
});
export type RequestPasswordRecoveryInput = z.infer<
  typeof requestPasswordRecoverySchema
>;

/**
 * Validation schema and input type for confirming password recovery with token and new password.
 */
export const confirmPasswordRecoveryObjectSchema = z.object({
  token: z.string().min(1).optional(),
  recovery_token: z.string().min(1).optional(),
  new_password: z.string().min(12),
});

export const confirmPasswordRecoverySchema = confirmPasswordRecoveryObjectSchema
  .refine((data) => Boolean(data.token || data.recovery_token), {
    message: "Either token or recovery_token must be provided",
  })
  .transform((data) => ({
    ...data,
    token: data.token ?? data.recovery_token ?? "",
  }));
export type ConfirmPasswordRecoveryInput = z.infer<
  typeof confirmPasswordRecoverySchema
>;

/**
 * Validation schema and input type for step-up password re-authentication on sensitive actions.
 */
export const passwordReauthSchema = z.object({
  password: z
    .string()
    .min(1)
    .refine((val) => val.trim().length > 0, {
      message: "Password cannot be empty or whitespace only",
    }),
});
export type PasswordReauthInput = z.infer<typeof passwordReauthSchema>;

/**
 * Validation schema and input type for updating user profile settings and email policies.
 */
export const updateProfileSchema = z
  .object({
    display_name: z.string().trim().max(120).optional(),
    recovery_email: z.string().trim().email().or(z.literal("")).optional(),
    primary_email_address_policy: z
      .enum(
        Object.values(AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES) as [
          (typeof AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES)[keyof typeof AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES],
          ...(typeof AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES)[keyof typeof AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES][],
        ],
      )
      .optional(),
    backup_recovery_email_policy: z
      .enum(
        Object.values(AUTH_BACKUP_EMAIL_POLICIES) as [
          (typeof AUTH_BACKUP_EMAIL_POLICIES)[keyof typeof AUTH_BACKUP_EMAIL_POLICIES],
          ...(typeof AUTH_BACKUP_EMAIL_POLICIES)[keyof typeof AUTH_BACKUP_EMAIL_POLICIES][],
        ],
      )
      .optional(),
  })
  .refine(
    (data) =>
      data.display_name !== undefined ||
      data.recovery_email !== undefined ||
      data.primary_email_address_policy !== undefined ||
      data.backup_recovery_email_policy !== undefined,
    {
      message: "At least one profile field must be provided for update",
    },
  );
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Validation schema and input type for checking if a sensitive route requires step-up re-authentication.
 */
export const checkSensitiveRouteSchema = z
  .object({
    method: z.string().trim().min(1),
    path: z.string().optional(),
    route: z.string().optional(),
  })
  .refine(
    (data) =>
      Boolean(
        (data.path && data.path.trim().length > 0) ||
        (data.route && data.route.trim().length > 0),
      ),
    {
      message: "Either path or route must be provided",
    },
  );
export type CheckSensitiveRouteInput = z.infer<
  typeof checkSensitiveRouteSchema
>;

/**
 * Validation schema and input type for starting an OAuth authentication flow.
 */
export const oauthStartSchema = z.object({
  provider: z.string().min(1),
  redirect_uri: z.string().min(1),
});
export type OAuthStartInput = z.infer<typeof oauthStartSchema>;

/**
 * Validation schema and input type for OAuth callback handling.
 */
export const oauthCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  provider: z.string().min(1),
});
export type OAuthCallbackInput = z.infer<typeof oauthCallbackSchema>;

/**
 * Validation schema and input type for initiating OAuth account linking.
 */
export const oauthLinkStartSchema = z.object({
  provider: z.string().min(1),
  redirect_uri: z.string().min(1),
});
export type OAuthLinkStartInput = z.infer<typeof oauthLinkStartSchema>;

/**
 * Validation schema and input type for completing OAuth account linking.
 */
export const oauthLinkCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  provider: z.string().min(1),
});
export type OAuthLinkCallbackInput = z.infer<typeof oauthLinkCallbackSchema>;

/**
 * Validation schema and input type for Admin user account actions (suspend / restore).
 */
export const adminUserActionSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type AdminUserActionInput = z.infer<typeof adminUserActionSchema>;

const RAW_PAGINATION_REGEX = /^[1-9][0-9]*$/;

function validateRawPaginationField(
  value: unknown,
  ctx: z.RefinementCtx,
  path: (string | number)[],
  maxLimit: number,
): void {
  if (value === undefined) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 1 || value > maxLimit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Value must be an integer between 1 and ${maxLimit}`,
        path,
      });
    }
    return;
  }
  if (typeof value === "string") {
    if (!RAW_PAGINATION_REGEX.test(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Value must be a positive integer matching /^[1-9][0-9]*$/",
        path,
      });
      return;
    }
    const num = Number.parseInt(value, 10);
    if (num < 1 || num > maxLimit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Value must be between 1 and ${maxLimit}`,
        path,
      });
    }
    return;
  }
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: "Value must be a string or integer",
    path,
  });
}

/**
 * Validation schema and input type for Admin user list query parameters.
 */
export const adminListUsersQuerySchema = z
  .object({
    query: z.string().max(ADMIN_ACCOUNT_QUERY_LIMITS.maxQueryLength).optional(),
    q: z.string().max(ADMIN_ACCOUNT_QUERY_LIMITS.maxQueryLength).optional(),
    status: z
      .enum([
        AUTH_ACCOUNT_STATUSES.active,
        AUTH_ACCOUNT_STATUSES.suspended,
        ADMIN_ACCOUNT_FILTERS.all,
      ] as [string, ...string[]])
      .optional(),
    role: z
      .enum([
        AUTH_USER_ROLES.admin,
        AUTH_USER_ROLES.customer,
        ADMIN_ACCOUNT_FILTERS.all,
      ] as [string, ...string[]])
      .optional(),
    page: z.unknown().optional(),
    pageSize: z.unknown().optional(),
    page_size: z.unknown().optional(),
  })
  .superRefine((data, ctx) => {
    if (
      data.query !== undefined &&
      data.q !== undefined &&
      data.query !== data.q
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Conflicting query parameters: 'query' and 'q' must not have different values",
        path: ["query"],
      });
    }
    if (
      data.pageSize !== undefined &&
      data.page_size !== undefined &&
      data.pageSize !== data.page_size
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Conflicting query parameters: 'pageSize' and 'page_size' must not have different values",
        path: ["pageSize"],
      });
    }
    validateRawPaginationField(
      data.page,
      ctx,
      ["page"],
      ADMIN_ACCOUNT_QUERY_LIMITS.maxPage,
    );
    validateRawPaginationField(
      data.pageSize,
      ctx,
      ["pageSize"],
      ADMIN_ACCOUNT_QUERY_LIMITS.maxPageSize,
    );
    validateRawPaginationField(
      data.page_size,
      ctx,
      ["page_size"],
      ADMIN_ACCOUNT_QUERY_LIMITS.maxPageSize,
    );
  })
  .transform((data) => {
    const parseNumber = (val: unknown, fallback: number): number => {
      if (typeof val === "number") return val;
      if (typeof val === "string") return Number.parseInt(val, 10);
      return fallback;
    };
    const resolvedPageSize =
      data.pageSize !== undefined
        ? parseNumber(data.pageSize, ADMIN_ACCOUNT_QUERY_LIMITS.defaultPageSize)
        : data.page_size !== undefined
          ? parseNumber(
              data.page_size,
              ADMIN_ACCOUNT_QUERY_LIMITS.defaultPageSize,
            )
          : ADMIN_ACCOUNT_QUERY_LIMITS.defaultPageSize;

    const result: {
      query?: string;
      q?: string;
      status?: string;
      role?: string;
      page?: number;
      pageSize?: number;
      page_size?: number;
    } = {
      page: data.page !== undefined ? parseNumber(data.page, 1) : 1,
      pageSize: resolvedPageSize,
    };

    if (data.query !== undefined || data.q !== undefined) {
      result.query = data.query ?? data.q;
    }
    if (data.q !== undefined) {
      result.q = data.q;
    }
    if (data.status !== undefined) {
      result.status = data.status;
    }
    if (data.role !== undefined) {
      result.role = data.role;
    }
    if (data.page_size !== undefined) {
      result.page_size = parseNumber(data.page_size, resolvedPageSize);
    }

    return result;
  });
export type AdminListUsersQueryInput = z.infer<
  typeof adminListUsersQuerySchema
>;

/**
 * Validation schema and input type for Admin overview metrics query parameters.
 * Preserves legacy fallback: unsupported periods or missing values default to 30D.
 */
export const adminOverviewQuerySchema = z.object({
  period: z
    .string()
    .optional()
    .transform((raw) => {
      if (raw === ADMIN_OVERVIEW_PERIODS.p7d) return ADMIN_OVERVIEW_PERIODS.p7d;
      if (raw === ADMIN_OVERVIEW_PERIODS.p90d) return ADMIN_OVERVIEW_PERIODS.p90d;
      return ADMIN_OVERVIEW_PERIODS.p30d;
    }),
});
export type AdminOverviewQueryInput = z.infer<typeof adminOverviewQuerySchema>;

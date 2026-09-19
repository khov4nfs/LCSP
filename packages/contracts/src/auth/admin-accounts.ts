export const USER_ACCESS_STATUSES = {
  active: "ACTIVE",
  suspended: "SUSPENDED",
} as const;
export type UserAccessStatus =
  (typeof USER_ACCESS_STATUSES)[keyof typeof USER_ACCESS_STATUSES];

export const ADMIN_ACCOUNT_REFERENCE_TYPES = {
  user: "USER",
} as const;

export const ADMIN_ACCOUNT_OPERATIONS = {
  suspend: "SUSPEND",
  restore: "RESTORE",
} as const;
export type AdminAccountOperation =
  (typeof ADMIN_ACCOUNT_OPERATIONS)[keyof typeof ADMIN_ACCOUNT_OPERATIONS];

export const ADMIN_ACCOUNT_QUERY_LIMITS = {
  defaultPageSize: 20,
  maxPageSize: 100,
  maxPage: 10000,
  maxQueryLength: 200,
} as const;

export const ADMIN_ACCOUNT_FILTERS = { all: "ALL" } as const;

export const ADMIN_ACCOUNT_ERRORS = {
  invalidInput: "ADMIN_ACCOUNT_INVALID_INPUT",
  staleVersion: "ADMIN_ACCOUNT_STALE_VERSION",
  invalidState: "ADMIN_ACCOUNT_INVALID_STATE",
  lastUsableAdmin: "LAST_USABLE_ADMIN_REQUIRED",
  selfSuspend: "CANNOT_SUSPEND_SELF",
  idempotencyRequired: "ADMIN_IDEMPOTENCY_KEY_REQUIRED",
  idempotencyConflict: "ADMIN_IDEMPOTENCY_KEY_CONFLICT",
  concurrentChange: "ADMIN_ACCOUNT_CONCURRENT_CHANGE",
  duplicateAccount: "ADMIN_ACCOUNT_EMAIL_EXISTS",
  accountSuspended: "ACCOUNT_SUSPENDED",
} as const;

export type AdminAccountReferenceType =
  (typeof ADMIN_ACCOUNT_REFERENCE_TYPES)[keyof typeof ADMIN_ACCOUNT_REFERENCE_TYPES];

export interface AdminRestoreUserInput {
  expectedVersion: number;
  reason?: string;
}

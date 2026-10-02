---
created: 2026-07-02
status: proposed
owner: engineering
based_on:
  - docs/planning-artifacts/research/technical-migrate-apps-api-apps-web-packages-tests-tu-javascript-sang-typescript-research-2026-07-02.md
  - docs/architecture/architecture.md
  - docs/project-context.md
---

# TypeScript + i18n Migration Implementation Plan

## Mục tiêu

Chuyển `apps/api`, `apps/web`, `packages/*`, `tests/*` từ JavaScript sang TypeScript theo retained topology của LCSP, đồng thời:

- tách shared contracts khỏi user-facing copy;
- tạo shared i18n dictionary cho `vi` và `en`;
- đổi backend sang trả stable keys + metadata;
- đổi frontend sang resolve message từ dictionary;
- giữ `node:test` và ESM hiện tại;
- triển khai theo PR nhỏ, rollback đơn giản.

## Phạm vi hiện tại

Code runtime hiện có trong repo:

- `apps/api/src/app.js`
- `apps/api/src/security.js`
- `apps/api/src/store.js`
- `apps/web/src/auth-entry.js`
- `apps/web/src/workspace-routes.js`
- `packages/contracts/src/auth-contracts.js`
- `tests/story-1-1.api.test.js`
- `tests/story-1-1.web.test.js`

## Nguyên tắc triển khai

- Giữ `apps/api`, `apps/web`, `packages/*` là topology chính thức.
- Không trộn presentation text vào `packages/contracts`.
- Backend trả semantic problem contract; frontend chịu trách nhiệm localization.
- Migrate theo package boundary, không rename toàn repo trong một PR.
- Chỉ tăng strictness mạnh sau khi contract flow và imports đã ổn định.

## Target Layout

```text
.
├── package.json
├── tsconfig.base.json
├── tsconfig.json
├── apps/
│   ├── api/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── app.ts
│   │       ├── security.ts
│   │       ├── store.ts
│   │       └── index.ts
│   └── web/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── auth-entry.ts
│           ├── workspace-routes.ts
│           └── index.ts
├── packages/
│   ├── contracts/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── auth/
│   │       │   ├── codes.ts
│   │       │   ├── actions.ts
│   │       │   ├── problems.ts
│   │       │   └── index.ts
│   │       ├── shared/
│   │       │   ├── locale.ts
│   │       │   ├── result.ts
│   │       │   └── index.ts
│   │       └── index.ts
│   └── i18n/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── locales/
│           │   ├── en/
│           │   │   ├── auth.ts
│           │   │   ├── common.ts
│           │   │   └── index.ts
│           │   └── vi/
│           │       ├── auth.ts
│           │       ├── common.ts
│           │       └── index.ts
│           ├── resolver.ts
│           ├── schema.ts
│           ├── types.ts
│           └── index.ts
└── tests/
    ├── tsconfig.json
    ├── story-1-1.api.test.ts
    └── story-1-1.web.test.ts
```

## tsconfig Layout

### Root `tsconfig.base.json`

Mục đích: shared compiler defaults cho toàn monorepo.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": false,
    "allowJs": true,
    "checkJs": true,
    "noEmit": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "esModuleInterop": false,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  }
}
```

Ghi chú:

- `allowJs + checkJs` chỉ là bridge phase đầu.
- `strict: false` ở phase đầu để giảm friction.
- Sau PR cuối mới xem xét tăng strictness.

### Root `tsconfig.json`

Mục đích: solution config cho `tsc -b`.

```json
{
  "files": [],
  "references": [
    { "path": "./packages/contracts" },
    { "path": "./packages/i18n" },
    { "path": "./apps/api" },
    { "path": "./apps/web" },
    { "path": "./tests" }
  ]
}
```

### Leaf config pattern

Mỗi package/app/test dùng:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "rootDir": "src",
    "outDir": "dist",
    "noEmit": true
  },
  "include": ["src/**/*.ts", "src/**/*.js"],
  "references": []
}
```

Điều chỉnh:

- `apps/api` reference `../../packages/contracts` và `../../packages/i18n`
- `apps/web` reference `../../packages/contracts` và `../../packages/i18n`
- `packages/i18n` reference `../contracts`
- `tests` reference tất cả packages/apps cần dùng

## Package Skeleton

### `packages/contracts`

Mục tiêu: chỉ giữ semantic contracts.

`packages/contracts/src/auth/codes.ts`

```ts
export const AUTH_ERROR_CODES = {
  authRequired: "AUTH_REQUIRED",
  invalidCredentials: "INVALID_CREDENTIALS",
  invalidInviteState: "INVALID_INVITE_STATE",
  membershipMissing: "MEMBERSHIP_MISSING",
  emailVerificationRequired: "EMAIL_VERIFICATION_REQUIRED",
  sessionInvalid: "SESSION_INVALID",
  temporaryLock: "TEMPORARY_LOCKED",
  authzPolicyUnavailable: "AUTHZ_POLICY_UNAVAILABLE",
  authzSubjectIncomplete: "AUTHZ_SUBJECT_INCOMPLETE",
  authzTenantScopeMismatch: "AUTHZ_TENANT_SCOPE_MISMATCH",
  authzStateGateBlocked: "AUTHZ_STATE_GATE_BLOCKED",
  authzEvaluatorFailure: "AUTHZ_EVALUATOR_FAILURE",
  validationFailed: "VALIDATION_FAILED"
} as const;

export type AuthErrorCode = typeof AUTH_ERROR_CODES[keyof typeof AUTH_ERROR_CODES];
```

`packages/contracts/src/auth/actions.ts`

```ts
export const REQUIRED_ACTIONS = {
  signIn: "sign_in",
  verifyEmail: "verify_email",
  acceptInvite: "accept_valid_invite",
  contactOwner: "contact_organization_owner",
  waitAndRetry: "wait_and_retry",
  none: "none"
} as const;

export type RequiredAction = typeof REQUIRED_ACTIONS[keyof typeof REQUIRED_ACTIONS];
```

`packages/contracts/src/shared/result.ts`

```ts
export type ApiSuccess<T> = {
  ok: true;
  data: T;
};

export type ApiFailure<TProblem> = {
  ok: false;
  problem: TProblem;
};

export type ApiResult<T, TProblem> = ApiSuccess<T> | ApiFailure<TProblem>;
```

`packages/contracts/src/auth/problems.ts`

```ts
import type { RequiredAction } from "./actions.js";
import type { AuthErrorCode } from "./codes.js";

export type ProblemKey =
  | "auth.errors.invalidCredentials.title"
  | "auth.errors.invalidCredentials.detail"
  | "auth.errors.membershipMissing.title"
  | "auth.errors.membershipMissing.detail";

export type ProblemMeta = Record<string, string | number | boolean | null>;

export type AppProblem<TCode extends string = AuthErrorCode> = {
  type: string;
  status: number;
  code: TCode;
  titleKey: ProblemKey;
  detailKey: ProblemKey;
  requiredAction: RequiredAction;
  correlationId: string;
  meta?: ProblemMeta;
};
```

Không để trong `contracts`:

- chuỗi tiếng Việt;
- chuỗi tiếng Anh;
- UI title/body copy;
- resolver locale.

### `packages/i18n`

Mục tiêu: dictionaries + resolver + typed locale surface.

`packages/i18n/src/locales/en/auth.ts`

```ts
export const enAuth = {
  errors: {
    invalidCredentials: {
      title: "Sign-in unavailable",
      detail: "The email or password is invalid."
    },
    membershipMissing: {
      title: "Workspace unavailable",
      detail: "You do not have access to this workspace."
    }
  }
} as const;
```

`packages/i18n/src/locales/vi/auth.ts`

```ts
import type { AuthMessages } from "../../types.js";

export const viAuth = {
  errors: {
    invalidCredentials: {
      title: "Không thể đăng nhập",
      detail: "Email hoặc mật khẩu không hợp lệ."
    },
    membershipMissing: {
      title: "Workspace chưa khả dụng",
      detail: "Bạn chưa có quyền truy cập workspace này."
    }
  }
} as const satisfies AuthMessages;
```

`packages/i18n/src/types.ts`

```ts
import type { enAuth } from "./locales/en/auth.js";

export type AuthMessages = typeof enAuth;
export type Locale = "en" | "vi";
```

`packages/i18n/src/resolver.ts`

```ts
import { enAuth } from "./locales/en/auth.js";
import { viAuth } from "./locales/vi/auth.js";
import type { Locale } from "./types.js";

const dictionaries = {
  en: { auth: enAuth },
  vi: { auth: viAuth }
} as const;

export function resolveMessage(locale: Locale, key: string): string {
  const dict = dictionaries[locale] ?? dictionaries.en;
  const path = key.split(".");
  let cursor: unknown = dict;

  for (const segment of path) {
    if (typeof cursor !== "object" || cursor == null || !(segment in cursor)) {
      return key;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }

  return typeof cursor === "string" ? cursor : key;
}
```

## App Integration Shape

### Backend

Thay `createSafeError()` hiện tại bằng factory trả `AppProblem`.

Pseudo-shape:

```ts
return {
  ok: false,
  problem: {
    type: "auth/invalid-credentials",
    status: 401,
    code: AUTH_ERROR_CODES.invalidCredentials,
    titleKey: "auth.errors.invalidCredentials.title",
    detailKey: "auth.errors.invalidCredentials.detail",
    requiredAction: REQUIRED_ACTIONS.signIn,
    correlationId
  }
};
```

### Frontend

Thay `titleByCode` + `apiResult.message` bằng resolver flow:

```ts
const title = resolveMessage(locale, problem.titleKey);
const body = resolveMessage(locale, problem.detailKey);
```

### Transitional compatibility

Trong một PR trung gian có thể tạm trả:

- `problem`
- `message` cũ

Nhưng `apps/web` mới phải ưu tiên `problem.titleKey/detailKey`.

## PR-by-PR Checklist

## PR-01: TypeScript bootstrap

Mục tiêu:

- thêm `tsconfig.base.json`
- thêm root solution `tsconfig.json`
- thêm leaf `tsconfig.json` cho `apps/api`, `apps/web`, `packages/contracts`, `tests`
- cập nhật `package.json` scripts với `typecheck`

Checklist:

- [ ] root `tsconfig.base.json` được thêm
- [ ] root `tsconfig.json` có `references`
- [ ] leaf configs tồn tại và resolve đúng relative paths
- [ ] `npm test` vẫn pass
- [ ] `tsc -b` chạy được với `allowJs + checkJs`

Done when:

- repo typecheck được mà chưa cần rename file

## PR-02: `packages/contracts` sang TypeScript

Mục tiêu:

- đổi `packages/contracts/src/auth-contracts.js` thành các module `.ts`
- tách codes/actions/result/problem types
- bỏ hardcoded text khỏi contract layer

Checklist:

- [ ] tạo `codes.ts`, `actions.ts`, `problems.ts`, `result.ts`
- [ ] export public entrypoints từ `packages/contracts/src/index.ts`
- [ ] các app/tests import qua entrypoint mới hoặc public module paths
- [ ] không còn chuỗi `Bạn ...` hoặc English UI copy trong `packages/contracts`

Done when:

- `packages/contracts` chỉ còn semantic types/constants

## PR-03: Tạo `packages/i18n`

Mục tiêu:

- thêm package mới `packages/i18n`
- tạo dictionaries `en` và `vi`
- thêm resolver và locale types

Checklist:

- [ ] `packages/i18n/package.json` tồn tại
- [ ] `locales/en/*` là base schema
- [ ] `locales/vi/*` dùng `satisfies` cùng structure
- [ ] có `resolveMessage(locale, key)`
- [ ] có test cho fallback khi thiếu key

Done when:

- repo có shared typed dictionary package dùng được độc lập

## PR-04: API problem-contract migration

Mục tiêu:

- migrate `apps/api` sang `.ts`
- đổi error flow sang `problem` contract
- giữ audit/redaction behavior hiện có

Checklist:

- [ ] `app.js`, `security.js`, `store.js` đổi sang `.ts`
- [ ] `createSafeError` trả `problem` typed hoặc được thay bằng factory mới
- [ ] response failures thống nhất `ok: false, problem: ...`
- [ ] metadata như `correlationId` vẫn giữ nguyên
- [ ] không leak secret/token/password

Done when:

- backend không còn là source of localized user copy

## PR-05: Web localization migration

Mục tiêu:

- migrate `apps/web` sang `.ts`
- dùng `packages/i18n` để resolve blocked-state copy
- bỏ hardcoded `titleByCode`

Checklist:

- [ ] `auth-entry.js` và `workspace-routes.js` đổi sang `.ts`
- [ ] `buildBlockedAuthViewModel` consume `problem.titleKey/detailKey`
- [ ] route logic vẫn redirect đúng cho `authRequired` và `sessionInvalid`
- [ ] blocked states đã locale-aware theo `vi/en`

Done when:

- frontend không còn phụ thuộc `apiResult.message` hardcoded

## PR-06: Test migration

Mục tiêu:

- đổi tests sang `.ts`
- chuyển assertions từ copy-based sang semantic-based
- thêm localization coverage

Checklist:

- [ ] `tests/*.test.js` đổi sang `.test.ts`
- [ ] API tests assert `problem.code`, `requiredAction`, `correlationId`
- [ ] web tests assert resolved title/body theo locale
- [ ] thêm contract test: mỗi `AuthErrorCode` có mapping key hợp lệ
- [ ] thêm i18n test: `en` và `vi` cùng đủ key

Done when:

- test suite không phụ thuộc trực tiếp vào backend-returned human text

## PR-07: Public package entrypoints + cleanup

Mục tiêu:

- thêm `package.json` `exports` cho internal packages
- bỏ deep relative imports vào `packages/*/src/**`
- dọn bridge compatibility fields nếu không còn cần

Checklist:

- [ ] `packages/contracts/package.json` có `exports`
- [ ] `packages/i18n/package.json` có `exports`
- [ ] app/test imports không còn đi vào `src/**`
- [ ] transitional `message` field được remove nếu đã safe

Done when:

- package boundaries rõ và ổn định cho refactor tiếp theo

## PR-08: Strictness ratchet

Mục tiêu:

- tăng dần strictness sau khi flow ổn định

Checklist:

- [ ] bật `strict: true`
- [ ] cân nhắc `noImplicitAny`
- [ ] cân nhắc `exactOptionalPropertyTypes`
- [ ] cân nhắc `noUncheckedIndexedAccess`
- [ ] fix hết violations phát sinh

Done when:

- compile-time guarantees tăng mà không làm vỡ architecture đã chốt

## Risks and Guards

- Rủi ro: import churn lớn.
  Guard: mỗi PR chỉ đổi import ở các file liên quan trực tiếp.

- Rủi ro: drift giữa `AuthErrorCode` và dictionary keys.
  Guard: thêm contract completeness test ở PR-06.

- Rủi ro: backend/frontend cùng đổi payload trong một lúc gây regression.
  Guard: cho phép bridge field ngắn hạn ở PR-04/05.

- Rủi ro: strictness quá sớm làm chậm tiến độ.
  Guard: để strictness ratchet ở PR-08.

## Definition of Done

- `apps/api`, `apps/web`, `packages/contracts`, `packages/i18n`, `tests` dùng TypeScript.
- Backend không còn hardcoded localized error copy trong contract layer.
- Frontend resolve blocked-state copy từ shared dictionary.
- `vi` và `en` có key coverage đồng nhất cho auth flow hiện tại.
- `node:test` pass.
- `tsc -b` pass.

## Immediate Next Action

Bắt đầu với PR-01 và PR-02 trong cùng sprint nếu muốn giữ momentum, vì hai PR này tạo nền cho toàn bộ phần còn lại mà ít rủi ro behavior nhất.

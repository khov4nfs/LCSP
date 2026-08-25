---
task_id: MW-web-001
module: web
runtime: nextjs
priority: P0
status: READY_FOR_DEV
epic_story: 1.2
depends_on:
  - auth-workspace/01-sign-in-endpoint.md
---

# Sign-In Page

## Outcome

Render a sign-in form that submits to `POST /auth/sign-in`. Handle MFA pending state (redirect to MFA verify page). Handle account lockout message. Link users without an account to the self-signup page. Store session token in httpOnly cookie or secure client store. No password or session token in URL params.

## Module Files

| File                                           | Action | Notes                                                           |
| ---------------------------------------------- | ------ | --------------------------------------------------------------- |
| `apps/web/app/(auth)/sign-in/page.tsx`         | Create | Sign-in page                                                    |
| `apps/web/app/(auth)/sign-in/sign-in-form.tsx` | Create | Form component                                                  |
| `apps/web/app/(auth)/sign-up/page.tsx`         | Create | Self-signup page                                                |
| `apps/web/app/api/auth/sign-up/route.ts`       | Create | BFF route that stores returned session token in httpOnly cookie |
| `apps/web/lib/api/auth-client.ts`              | Create | Client-side API wrapper for auth endpoints                      |
| `apps/web/lib/session/session-store.ts`        | Create | Session token storage (httpOnly cookie preferred)               |

## UI Components

| Component           | Notes                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| Email input         | Standard email validation                                                                          |
| Password input      | Masked, no autocomplete on shared devices warning                                                  |
| Submit button       | Loading state during request                                                                       |
| Error message       | Business-language: `Invalid credentials`, `Account temporarily locked`                             |
| OAuth button        | `Sign in with Google` → `GET /auth/oauth/start?provider=google`; GitHub OAuth login is not offered |
| Create account link | Routes to `/sign-up`                                                                               |
| Self-signup form    | Collects name, organization, email, password confirmation, and creates a Manager workspace account |

## Business Rules

1. On `sign_in_result.mfa_required = true` → redirect to `/mfa/verify` with `session_token` as state (not in URL — use session cookie or memory state). The `(auth)` route group does not add an `/auth` URL segment.
2. On success with `mfa_required = false` → redirect to `/workspace`.
3. On `ACCOUNT_LOCKED` error → show business-language message: "Account temporarily locked. Please try again later."
4. Password field must not be stored in component state after form submission.
5. Session token must not appear in URL, browser history, or console logs.
6. Error messages must not reveal whether the email exists in the system.
7. Self-signup success must redirect to `/workspace`; the BFF must not expose the session token to the browser client payload.

## Test Cases

| ID  | Scenario                         | Expected                                        |
| --- | -------------------------------- | ----------------------------------------------- |
| T01 | Valid credentials, no MFA        | Redirect to `/workspace`                        |
| T02 | MFA required                     | Redirect to `/auth/mfa/verify`                  |
| T03 | Invalid credentials              | Business-language error, no email hint          |
| T04 | Account locked                   | Lockout message shown                           |
| T05 | Session token not in URL         | Browser history inspection                      |
| T06 | Loading state on submit          | Button disabled during request                  |
| T07 | User follows create-account link | `/sign-up` form is available                    |
| T08 | Self-signup success              | Session cookie set and redirect to `/workspace` |

## Definition of Done

- Sign-in form functional with loading state.
- MFA redirect works correctly.
- Session token never in URL or console.
- Business-language error messages only.
- Self-signup form uses shared contracts/i18n and never exposes returned session token to client code.

## Known UX Compliance Issue (flagged 2026-07-11, resolved 2026-07-11)

The shipped implementation (`apps/web/src/features/auth/components/organisms/sign-in-page.tsx`) does not follow `DESIGN.md`'s "Brand & Style" rule: _"Avoid marketing hero layouts, decorative illustrations, large emotional gradients, or chatbot-style surfaces."_

Specifics:

- A 40%+ width split-screen hero panel (`bg-brand-surface`) with a large decorative gradient circle, a 5.7rem display heading, and a motion-safe fade/slide entrance animation — none of which are sanctioned by the spine.
- Three undocumented tokens invented in `apps/web/src/app/globals.css` (`--brand-surface`, `--brand-foreground`, `--brand-accent`) outside the spine's Colors table (`{colors.primary}`, `{colors.background}`, `{colors.surface}`, `{colors.surface-muted}`, `{colors.warning}`, `{colors.success}`, `{colors.danger}`, `{colors.info}`).

`DESIGN.md` now has an explicit **Auth Surface** pattern (single centered form card, no hero panel, no new brand-only tokens) added specifically so `MW-web-007` and `MW-web-008` do not repeat this drift.

**Resolved:** `apps/web/src/features/auth/components/organisms/sign-in-page.tsx` rebuilt as a single centered layout (`BrandMark` + `SignInForm`'s existing `{components.form-card}`, already `max-w-md`/~28rem). Removed the hero `<section>`, the decorative gradient circle, and the `--brand-surface`/`--brand-foreground`/`--brand-accent` custom properties from `apps/web/src/app/globals.css` (and the matching `@theme inline` mappings). `BrandMark` now uses the canonical `border-primary` token instead of `border-brand-accent`. Dropped the now-unused hero-only i18n keys (`pages.signIn.eyebrow`/`heading`/`introduction`/`assurance`) from `packages/i18n` (en/vi) and `PagesMessages` type — `formEyebrow`/`formTitle`/`formDescription` already covered that copy inside the form card. Verified via `tsc --noEmit` (web + i18n), the existing `tests/story-1-2.web.test.ts` suite (8/8 pass), and a real dev-server screenshot in light + dark mode (no console errors). The current auth UI offers Google OAuth only; GitHub login was removed and GitHub repository authorization remains in the separate GitHub App flow.

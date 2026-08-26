# Web Component Index

Last updated: August 25, 2026

## Shared shadcn primitives

Location: `apps/web/src/components/ui`

- Keep only source primitives and thin shadcn compositions here.
- Current exception that should not stay here:
  - `classification-status-card.tsx`

## Shared atomic components

Location: `apps/web/src/components`

### Atoms

- `atoms/brand-mark.tsx`

### Molecules

- `molecules/info-grid.tsx`
- `molecules/labeled-separator.tsx`
- `molecules/labeled-value-row.tsx`
- `molecules/section-heading.tsx`

### Organisms

- `organisms/form-card.tsx`

### Non-atomic support

- `providers/query-provider.tsx`
- `types/*`

## Feature component inventory

### Auth

- Molecules:
  - `credential-field.tsx`
- Organisms:
  - `auth-shell.tsx`
  - `mfa-enroll-form.tsx`
  - `mfa-verify-form.tsx`
  - `profile-safety-card.tsx`
  - `recovery-confirm-form.tsx`
  - `recovery-request-form.tsx`
  - `sign-in-form.tsx`
  - `sign-in-page.tsx`
  - `sign-up-form.tsx`
  - `sign-up-page.tsx`

### Classification

- Organisms:
  - `classification-status-page.tsx`

### Document

- Molecules:
  - `document-status-card.tsx`
- Organisms:
  - `document-list-view.tsx`
  - `document-request-panel.tsx`
  - `documents-page-client.tsx`

### Readiness

- Organisms:
  - `readiness-status-page.tsx`

### Reconciliation

- Molecules:
  - `conflict-card.tsx`
- Organisms:
  - `conflict-resolution-page.tsx`

### Settings

- Organisms:
  - `account-settings-section.tsx`
  - `appearance-settings-section.tsx`
  - `email-settings-section.tsx`
  - `notifications-settings-section.tsx`
  - `password-authentication-settings-section.tsx`
  - `repositories-settings-section.tsx`
  - `sessions-settings-section.tsx`
  - `settings-page.tsx`

### Wizard

- Molecules:
  - `wizard-checkbox-field.tsx`
  - `wizard-draft-status-badge.tsx`
  - `wizard-helper-button.tsx`
  - `wizard-select-field.tsx`
  - `wizard-status-row.tsx`
  - `wizard-textarea-field.tsx`
- Organisms:
  - `wizard-active-step-card.tsx`
  - `wizard-form-page.tsx`
  - `wizard-helper-sheet.tsx`
  - `wizard-navigation-actions.tsx`
  - `wizard-progress-sidebar.tsx`
  - `wizard-read-only-summary.tsx`

### Workspace

- Molecules:
  - `app-header.tsx`
  - `assessment-summary-card.tsx`
  - `overview-metric-card.tsx`
  - `sidebar-assessment-list.tsx`
  - `workspace-menu-row.tsx`
  - `workspace-header.tsx`
  - `workspace-switcher.tsx`
- Organisms:
  - `app-shell.tsx`
  - `app-sidebar.tsx`
  - `assessment-list.tsx`
  - `assessment-overview.tsx`
  - `assessments-directory.tsx`
  - `create-assessment-form.tsx`
  - `workspace-dashboard.tsx`
  - `workspace-overview.tsx`
  - `workspace-sidebar.tsx`

### Document

- Molecules:
  - `document-request-action-card.tsx`
  - `document-status-card.tsx`

## Confirmed cleanup actions

### Placement fixes

- Move `components/ui/classification-status-card.tsx` out of `ui/` into shared atomic components.

### Replace custom markup with shadcn

- `features/workspace/components/organisms/create-assessment-form.tsx`
  - replace raw `textarea` and label wrappers with `Textarea` and `Field` composition.
- `features/settings/components/organisms/sessions-settings-section.tsx`
  - replace ad hoc empty-state paragraph with `Empty`.
- `features/settings/components/organisms/repositories-settings-section.tsx`
  - replace ad hoc empty-state paragraph with `Empty`.
- `features/document/components/molecules/document-status-card.tsx`
  - replace custom status pill and custom action button markup with `Badge` and `Button`.

### Type extraction

- Keep document screen prop/state types in feature `types/` instead of inline inside organisms:
  - `document-list-view.types.ts`
  - `document-request-panel.types.ts`

### Shared extraction

- Shared status card pattern used by classification and readiness belongs in shared atomic components, not `ui/`.

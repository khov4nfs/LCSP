<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Next.js Web App Agent Instructions (`apps/web`)

## 1. Role & Scope
`apps/web` contains the Next.js App Router frontend. It enforces Atomic Design boundaries, isolated feature modules, Zod-validated forms, and strict Server/Client boundary separation.

---

## 2. Layer Responsibilities & Contrastive Examples

### Layer A: Shared UI Primitives (`components/ui` & `components/{atoms,molecules,organisms}`)
- **Role**: Domain-neutral, presentation-only components.
- **Rule**: NEVER import from `features/*` and NEVER call business APIs.

```tsx
// ❌ BAD: UI Atom importing from a feature module and fetching data
import { useAssessmentQuery } from "@/features/assessment/hooks";

export function BadgeAtom() {
  const { data } = useAssessmentQuery(); // ❌ Domain-specific logic in shared UI
  return <span>{data?.title}</span>;
}

// ✅ GOOD: Dumb presentation component controlled purely via props
interface StatusBadgeProps {
  label: string;
  variant: "default" | "success" | "warning";
}

export function StatusBadge({ label, variant }: StatusBadgeProps) {
  return <span className={badgeVariants({ variant })}>{label}</span>;
}
```

### Layer B: Feature Modules (`features/<feature>/`)
- **Structure**:
  ```
  features/<feature>/
  ├── components/{molecules,organisms}/  # Feature UI composition
  ├── hooks/                             # TanStack Query (*-queries.ts)
  ├── schemas/                           # Zod validation schemas
  └── types/                             # Local types
  ```
- **Rule**: NEVER inline `z.object({...})` in component files. ALWAYS store form schemas in sibling `schemas/`.
- **Rule**: NEVER build forms using manual `useState` field maps. ALWAYS use `react-hook-form` + `zod` via `FormProvider`.

```tsx
// ❌ BAD: Inlining Zod schema and using ad hoc useState for form management
export function EditProfileForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const schema = z.object({ email: z.string().email() }); // ❌ Inlined schema
  ...
}

// ✅ GOOD: Importing schema from schemas/ and binding via react-hook-form
import { editProfileSchema, type EditProfileFormData } from "../schemas/edit-profile.schema";

export function EditProfileForm() {
  const form = useForm<EditProfileFormData>({
    resolver: zodResolver(editProfileSchema),
  });
  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <FormField name="email" ... />
      </form>
    </FormProvider>
  );
}
```

### Layer C: Server Layer & Upstream BFF Proxy (`lib/server/`)
- **Rule**: Upstream server helpers MUST use `import 'server-only'`. NEVER import into Client Components (`'use client'`).
- **Rule**: NEVER prefix private API keys or database tokens with `NEXT_PUBLIC_`.

```typescript
// ✅ GOOD: Guaranteed server-only execution
import 'server-only';

export async function requestUpstreamApi(path: string, options: RequestInit) {
  const baseUrl = process.env.LCSP_API_BASE_URL;
  // Upstream fetch logic
}
```

---

## 3. Styling & Internationalization Invariants

### Tailwind CSS v4.3 Policy
- **Rule**: Use canonical Tailwind v4.3 utilities over arbitrary values.
- ❌ **BAD**: `min-h-[18rem]`, `rounded-[2px]`, `min-h-[100dvh]`
-  **GOOD**: `min-h-72`, `rounded-sm`, `min-h-dvh`

### Zero Hardcoded Text Copy
- **Rule**: All user-facing strings must resolve from `@lcsp/i18n`.
- ❌ **BAD**: `<button>Lưu thay đổi</button>`
-  **GOOD**: `<button>{t("common.actions.save")}</button>`

---

## 4. Verification Checklist (Before declaring complete)
- [ ] Run fast scoped test for changed file: `pnpm exec tsx --tsconfig apps/web/tsconfig.test.json --test <path-to-test>` (~1s)
- [ ] Check for unneeded arbitrary Tailwind classes: `rg '-\[' apps/web/src`
- [ ] Verify form schemas reside strictly in `schemas/` directories.
- [ ] Verify explanatory comments are added on all changed code, especially BFF proxies, server actions, and core form state logic.
- [ ] Verify all display text uses `@lcsp/i18n` translation keys.
- [ ] For ADMIN live telemetry, verify the browser uses a dedicated `/api/admin/**` SSE route, forwards one `x-correlation-id` across the BFF, and never subscribes to customer `/api/workspace/runtime-events`.
- [ ] For role-separated customer/ADMIN routes, stop rendering on profile verification failure and reject unknown role strings instead of treating them as an authenticated customer.
- [ ] For PAT dialog changes, verify dismissal during step-up prevents a later write and a failed post-save read retries only the status read.
- [ ] For nested Settings confirmation dialogs at narrow or enlarged text sizes, verify child content remains readable inside the scroll body and Escape restores focus to a mounted parent control.

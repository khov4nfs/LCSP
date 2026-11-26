import { z } from "zod";

export const providerCredentialSchema = z.object({
  credential: z
    .string()
    .trim()
    .min(1, "pages.workspace.settingsHub.repositories.credentialRequired"),
  organization: z.string().trim(),
  email: z.string().trim(),
  expiresAt: z.string().optional(),
});

const declaredExpiry = providerCredentialSchema.refine(
  ({ expiresAt }) =>
    expiresAt === undefined || expiresAt === "" || isValidDeclaredExpiry(expiresAt),
  {
    path: ["expiresAt"],
    message: "pages.workspace.settingsHub.repositories.credentialExpiryInvalid",
  },
);

/**
 * Business purpose: Accept only a real calendar date for a user-declared provider credential expiry.
 * Business rules:
 * - The optional date must use ISO `YYYY-MM-DD` and round-trip as the same UTC calendar day.
 * Execution flow:
 * 1. Check the fixed-width date format.
 * 2. Parse it at UTC midnight.
 * 3. Compare the normalized date with the submitted value.
 * Failure cases:
 * - Malformed or impossible calendar dates return false and cannot be submitted as credential metadata.
 * Side effects:
 * - Pure validation; no clock or credential data is modified.
 */
function isValidDeclaredExpiry(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export const bitbucketProviderCredentialSchema = declaredExpiry.refine(
  ({ email }) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email),
  {
    path: ["email"],
    message: "pages.workspace.settingsHub.repositories.credentialEmailRequired",
  },
);

export const azureProviderCredentialSchema = declaredExpiry.refine(
  ({ organization }) => /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/u.test(organization),
  {
    path: ["organization"],
    message:
      "pages.workspace.settingsHub.repositories.credentialOrganizationRequired",
  },
);

export type ProviderCredentialValues = z.infer<typeof providerCredentialSchema>;

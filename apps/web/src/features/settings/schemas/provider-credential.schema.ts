import { z } from "zod";

// Keep validation local to the form and allow Azure's existing organization:PAT format.
export const providerCredentialSchema = z.object({
  credential: z
    .string()
    .trim()
    .min(1, "pages.workspace.settingsHub.repositories.credentialRequired"),
  organization: z.string().trim(),
});

export const azureProviderCredentialSchema = providerCredentialSchema.refine(
  (values) => values.organization.length > 0 || values.credential.includes(":"),
  {
    path: ["organization"],
    message:
      "pages.workspace.settingsHub.repositories.credentialOrganizationRequired",
  },
);

export type ProviderCredentialValues = z.infer<typeof providerCredentialSchema>;

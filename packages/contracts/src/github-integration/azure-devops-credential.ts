export const AZURE_DEVOPS_CREDENTIAL_TYPES = {
  organizationPat: "AZURE_DEVOPS_ORGANIZATION_PAT",
} as const;

export type AzureDevOpsOrganizationPatCredential = {
  type: typeof AZURE_DEVOPS_CREDENTIAL_TYPES.organizationPat;
  organization: string;
  pat: string;
};

/**
 * Business purpose: Serialize the explicitly scoped Azure organization credential into the existing encrypted-secret boundary.
 * Business rules:
 * - One safe Azure DevOps Services organization and one opaque PAT are accepted; PATs cannot contain header-control characters.
 * Execution flow:
 * 1. Normalize the organization locator.
 * 2. Validate its shape and PAT bounds, then encode the fixed credential discriminator.
 * Failure cases:
 * - Invalid organization or PAT input is rejected without returning submitted values.
 * Side effects:
 * - Pure serialization; no credential material is logged, persisted, or transmitted.
 */
export function encodeAzureDevOpsOrganizationPatCredential(
  input: Omit<AzureDevOpsOrganizationPatCredential, "type">,
): string {
  const organization = input.organization.trim();
  const pat = input.pat;
  if (
    !/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/u.test(organization) ||
    pat.length === 0 ||
    pat.length > 4096 ||
    pat.includes("\0") ||
    pat.includes("\r") ||
    pat.includes("\n")
  ) {
    throw new Error("azure_devops_credential_invalid");
  }
  return JSON.stringify({
    type: AZURE_DEVOPS_CREDENTIAL_TYPES.organizationPat,
    organization,
    pat,
  } satisfies AzureDevOpsOrganizationPatCredential);
}

/**
 * Business purpose: Decode only the current organization-scoped Azure PAT from encrypted credential bytes.
 * Business rules:
 * - Legacy opaque secrets are rejected and organization context must be explicit.
 * Execution flow:
 * 1. Parse the JSON discriminator.
 * 2. Validate the exact key set and reuse the encoder's field rules.
 * Failure cases:
 * - Malformed, legacy, or inconsistent values fail without exposing secret data.
 * Side effects:
 * - Pure parsing of transient credential material.
 */
export function decodeAzureDevOpsOrganizationPatCredential(
  secret: string,
): AzureDevOpsOrganizationPatCredential {
  let value: unknown;
  try {
    value = JSON.parse(secret) as unknown;
  } catch {
    throw new Error("azure_devops_credential_invalid");
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "organization,pat,type" ||
    !("type" in value) ||
    value.type !== AZURE_DEVOPS_CREDENTIAL_TYPES.organizationPat ||
    !("organization" in value) ||
    typeof value.organization !== "string" ||
    !("pat" in value) ||
    typeof value.pat !== "string"
  ) {
    throw new Error("azure_devops_credential_invalid");
  }
  return JSON.parse(
    encodeAzureDevOpsOrganizationPatCredential({
      organization: value.organization,
      pat: value.pat,
    }),
  ) as AzureDevOpsOrganizationPatCredential;
}

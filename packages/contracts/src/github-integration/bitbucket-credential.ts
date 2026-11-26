export const BITBUCKET_CREDENTIAL_TYPES = {
  atlassianApiToken: "ATLASSIAN_API_TOKEN",
} as const;

export type BitbucketCredentialType =
  (typeof BITBUCKET_CREDENTIAL_TYPES)[keyof typeof BITBUCKET_CREDENTIAL_TYPES];

export type BitbucketApiTokenCredential = {
  type: typeof BITBUCKET_CREDENTIAL_TYPES.atlassianApiToken;
  email: string;
  apiToken: string;
};

/**
 * Business purpose: Convert the typed Atlassian API Token request into LCSP's encrypted string-secret representation.
 * Business rules:
 * - Only bounded email and token values without control-line injection are accepted.
 * - The token remains an opaque secret.
 * Execution flow:
 * 1. Normalize the email's surrounding whitespace.
 * 2. Validate both fields.
 * 3. Serialize the explicit API Token discriminator with those values.
 * Failure cases:
 * - Invalid email or token values raise a neutral credential validation error without including submitted data.
 * Side effects:
 * - Pure serialization; this function does not log, persist, or transmit credentials.
 */
export function encodeBitbucketApiTokenCredential(
  credential: Omit<BitbucketApiTokenCredential, "type">,
): string {
  const email = credential.email.trim();
  const apiToken = credential.apiToken;
  if (
    email.length === 0 ||
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ||
    apiToken.length === 0 ||
    apiToken.length > 4096 ||
    containsForbiddenTokenControl(apiToken)
  ) {
    throw new Error("bitbucket_credential_invalid");
  }
  return JSON.stringify({
    type: BITBUCKET_CREDENTIAL_TYPES.atlassianApiToken,
    email,
    apiToken,
  } satisfies BitbucketApiTokenCredential);
}

/**
 * Business purpose:
 * - Prevent control characters from changing Basic-auth header structure.
 * Business rules:
 * - NUL, carriage return, and line feed are rejected while other token characters remain unchanged.
 * Execution flow:
 * 1. Check the three forbidden code points directly.
 * Failure cases:
 * - Return true when the encoder must reject the token.
 * Side effects:
 * - Pure validation without persistence or external requests.
 */
function containsForbiddenTokenControl(value: string): boolean {
  return value.includes("\0") || value.includes("\r") || value.includes("\n");
}

/**
 * Business purpose: Recover only the approved Atlassian API Token credential from encrypted provider secret bytes.
 * Business rules:
 * - The discriminator must identify the current email/API Token contract.
 * - Legacy opaque values and malformed fields are rejected.
 * Execution flow:
 * 1. Parse JSON.
 * 2. Validate the exact credential type and fields.
 * 3. Reuse the encoder's field constraints and return a normalized credential.
 * Failure cases:
 * - Invalid JSON, wrong credential type, or invalid fields raise a neutral validation error.
 * Side effects:
 * - Pure parsing; the returned object is transient credential data and must not be logged or passed to Deep Agents.
 */
export function decodeBitbucketApiTokenCredential(
  secret: string,
): BitbucketApiTokenCredential {
  let value: unknown;
  try {
    value = JSON.parse(secret) as unknown;
  } catch {
    throw new Error("bitbucket_credential_invalid");
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "apiToken,email,type" ||
    !("type" in value) ||
    value.type !== BITBUCKET_CREDENTIAL_TYPES.atlassianApiToken ||
    !("email" in value) ||
    typeof value.email !== "string" ||
    !("apiToken" in value) ||
    typeof value.apiToken !== "string"
  ) {
    throw new Error("bitbucket_credential_invalid");
  }
  return JSON.parse(
    encodeBitbucketApiTokenCredential({
      email: value.email,
      apiToken: value.apiToken,
    }),
  ) as BitbucketApiTokenCredential;
}

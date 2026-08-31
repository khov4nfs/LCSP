import type { CredentialStorageContext } from "../../application/ports/security/credential-store.port.js";
import { CREDENTIAL_PROVIDERS } from "@lcsp/contracts/github-integration";

export const CREDENTIAL_ENVELOPE_AAD_SCHEMA_VERSION = 1;
export const CREDENTIAL_ENVELOPE_AAD_LAYERS = {
  credential: "CREDENTIAL",
  dekWrap: "DEK_WRAP",
} as const;
type CredentialEnvelopeAadLayer =
  (typeof CREDENTIAL_ENVELOPE_AAD_LAYERS)[keyof typeof CREDENTIAL_ENVELOPE_AAD_LAYERS];

export class CredentialEnvelopeAadError extends Error {
  constructor() {
    super("credential_encryption_context_invalid");
    this.name = "CredentialEnvelopeAadError";
  }
}

export function encodeCredentialEnvelopeAad(
  context: CredentialStorageContext,
  layer: CredentialEnvelopeAadLayer,
): Buffer {
  assertContext(context);
  return Buffer.from(
    [
      `aadSchemaVersion=${CREDENTIAL_ENVELOPE_AAD_SCHEMA_VERSION}`,
      `layer=${layer}`,
      `envelopeVersion=${context.envelopeVersion}`,
      `provider=${context.provider}`,
      `providerCredentialId=${context.providerCredentialId}`,
      `ownerUserId=${context.ownerUserId}`,
      `credentialVersion=${context.credentialVersion}`,
    ].join("\n"),
    "utf8",
  );
}

function assertContext(context: CredentialStorageContext): void {
  const ids = [context.providerCredentialId, context.ownerUserId];
  if (
    (context.provider !== CREDENTIAL_PROVIDERS.github &&
      context.provider !== CREDENTIAL_PROVIDERS.gitlab) ||
    !Number.isSafeInteger(context.credentialVersion) ||
    context.credentialVersion < 1 ||
    context.envelopeVersion !== 1 ||
    ids.some((value) => !value || value.length > 255 || /[\r\n=]/u.test(value))
  ) {
    throw new CredentialEnvelopeAadError();
  }
}

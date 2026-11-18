import { PROVIDER_CREDENTIAL_STATUSES } from "@lcsp/contracts/github-integration";

import type { ProviderCredentialStatus } from "@/lib/api/github-repository-client";

import {
  PROVIDER_CONNECTION_STATES,
  type ProviderConnectionState,
} from "../config/provider-connection.config";

/**
 * Business purpose: Present a provider credential's backend-confirmed lifecycle to the customer.
 * Business rules:
 * - Only an ACTIVE credential is connected; expired and failed credentials stay manageable but are not shown as healthy.
 * - A provider without a credential, or a revoked one, is not connected.
 * Execution flow:
 * 1. Read the configured flag first, then classify the remaining lifecycle status.
 * Failure cases:
 * - Missing status data is treated as not connected rather than guessed.
 * Side effects:
 * - Pure classification without network access.
 */
export function getProviderConnectionState(
  status: ProviderCredentialStatus | null | undefined,
): ProviderConnectionState {
  if (!status) return PROVIDER_CONNECTION_STATES.notConnected;
  if (status.configured) return PROVIDER_CONNECTION_STATES.connected;
  switch (status.status) {
    case undefined:
    case null:
    case PROVIDER_CREDENTIAL_STATUSES.revoked:
      return PROVIDER_CONNECTION_STATES.notConnected;
    case PROVIDER_CREDENTIAL_STATUSES.expired:
      return PROVIDER_CONNECTION_STATES.expired;
    default:
      return PROVIDER_CONNECTION_STATES.attention;
  }
}

/**
 * Business purpose: Decide whether a provider can be managed (updated or disconnected).
 * Business rules:
 * - Manageable whenever a credential exists, healthy or not, so expired credentials can be replaced or removed.
 * Execution flow:
 * 1. Classify the connection state and compare it with not connected.
 * Failure cases:
 * - Missing status data is not manageable rather than guessed.
 * Side effects:
 * - Pure check without network access.
 */
export function hasProviderCredential(
  status: ProviderCredentialStatus | null | undefined,
): boolean {
  return (
    getProviderConnectionState(status) !==
    PROVIDER_CONNECTION_STATES.notConnected
  );
}

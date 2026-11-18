import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CREDENTIAL_PROVIDERS,
  PROVIDER_CREDENTIAL_STATUSES,
} from "@lcsp/contracts/github-integration";

import type { ProviderCredentialStatus } from "../src/lib/api/github-repository-client.ts";
import { PROVIDER_CONNECTION_STATES } from "../src/features/settings/config/provider-connection.config.ts";
import {
  getProviderConnectionState,
  hasProviderCredential,
} from "../src/features/settings/utils/provider-connection.utils.ts";

const status = (
  overrides: Partial<ProviderCredentialStatus>,
): ProviderCredentialStatus => ({
  provider: CREDENTIAL_PROVIDERS.github,
  configured: false,
  status: null,
  account: null,
  ...overrides,
});

test("only an ACTIVE credential is presented as connected", () => {
  assert.equal(
    getProviderConnectionState(
      status({
        configured: true,
        status: PROVIDER_CREDENTIAL_STATUSES.active,
        account: { id: "1", username: "octo" },
      }),
    ),
    PROVIDER_CONNECTION_STATES.connected,
  );
});

test("expired and failed credentials stay manageable but are not healthy", () => {
  const account = { id: "1", username: "octo" };
  const expired = status({
    status: PROVIDER_CREDENTIAL_STATUSES.expired,
    account,
  });
  const invalid = status({
    status: PROVIDER_CREDENTIAL_STATUSES.invalid,
    account,
  });
  assert.equal(
    getProviderConnectionState(expired),
    PROVIDER_CONNECTION_STATES.expired,
  );
  assert.equal(
    getProviderConnectionState(invalid),
    PROVIDER_CONNECTION_STATES.attention,
  );
  assert.equal(hasProviderCredential(expired), true);
  assert.equal(hasProviderCredential(invalid), true);
});

test("missing, revoked or unknown data is never shown as connected", () => {
  for (const value of [
    undefined,
    null,
    status({}),
    status({ status: PROVIDER_CREDENTIAL_STATUSES.revoked }),
  ]) {
    assert.equal(
      getProviderConnectionState(value),
      PROVIDER_CONNECTION_STATES.notConnected,
    );
    assert.equal(hasProviderCredential(value), false);
  }
});

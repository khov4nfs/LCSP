import assert from "node:assert/strict";
import { test } from "node:test";

import {
  azureProviderCredentialSchema,
  bitbucketProviderCredentialSchema,
} from "../src/features/settings/schemas/provider-credential.schema";

test("provider credential schemas accept typed identities and valid declared expiry", () => {
  assert.equal(
    bitbucketProviderCredentialSchema.safeParse({
      email: "owner@example.com",
      credential: "api-token",
      organization: "",
      expiresAt: "2027-02-28",
    }).success,
    true,
  );
  assert.equal(
    azureProviderCredentialSchema.safeParse({
      email: "",
      organization: "acme-org",
      credential: "pat",
      expiresAt: "2028-02-29",
    }).success,
    true,
  );
});

test("provider credential schemas reject impossible dates and invalid identities", () => {
  assert.equal(
    bitbucketProviderCredentialSchema.safeParse({
      email: "owner@example.com",
      credential: "api-token",
      organization: "",
      expiresAt: "2027-02-29",
    }).success,
    false,
  );
  assert.equal(
    bitbucketProviderCredentialSchema.safeParse({
      email: "not-an-email",
      credential: "api-token",
      organization: "",
      expiresAt: "",
    }).success,
    false,
  );
  assert.equal(
    azureProviderCredentialSchema.safeParse({
      email: "",
      organization: "https://dev.azure.com/acme",
      credential: "pat",
      expiresAt: "",
    }).success,
    false,
  );
});

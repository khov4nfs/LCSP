import { describe, expect, it } from "@jest/globals";

import {
  BITBUCKET_CREDENTIAL_TYPES,
  decodeBitbucketApiTokenCredential,
  encodeBitbucketApiTokenCredential,
} from "../../src/github-integration/bitbucket-credential.ts";

describe("Bitbucket API Token credential contract", () => {
  it("round-trips the explicit email and API Token credential type", () => {
    const encoded = encodeBitbucketApiTokenCredential({
      email: " user@example.com ",
      apiToken: "opaque-token",
    });

    expect(decodeBitbucketApiTokenCredential(encoded)).toEqual({
      type: BITBUCKET_CREDENTIAL_TYPES.atlassianApiToken,
      email: "user@example.com",
      apiToken: "opaque-token",
    });
  });

  it("rejects retired opaque credential values without echoing them", () => {
    expect(() =>
      decodeBitbucketApiTokenCredential("retired-app-password"),
    ).toThrow("bitbucket_credential_invalid");
  });

  it("rejects extra or mismatched credential fields", () => {
    expect(() =>
      decodeBitbucketApiTokenCredential(
        JSON.stringify({
          type: BITBUCKET_CREDENTIAL_TYPES.atlassianApiToken,
          email: "user@example.com",
          apiToken: "token",
          organization: "unexpected",
        }),
      ),
    ).toThrow("bitbucket_credential_invalid");
  });
});

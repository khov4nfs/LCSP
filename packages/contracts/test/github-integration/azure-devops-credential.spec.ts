import { describe, expect, it } from "@jest/globals";
import {
  AZURE_DEVOPS_CREDENTIAL_TYPES,
  decodeAzureDevOpsOrganizationPatCredential,
  encodeAzureDevOpsOrganizationPatCredential,
} from "../../src/github-integration/azure-devops-credential.ts";

describe("Azure organization PAT credential contract", () => {
  it("preserves one explicit organization and PAT in the typed encrypted-secret payload", () => {
    const encoded = encodeAzureDevOpsOrganizationPatCredential({
      organization: " fabrikam ",
      pat: "opaque-pat",
    });
    expect(decodeAzureDevOpsOrganizationPatCredential(encoded)).toEqual({
      type: AZURE_DEVOPS_CREDENTIAL_TYPES.organizationPat,
      organization: "fabrikam",
      pat: "opaque-pat",
    });
  });

  it("rejects legacy opaque Azure credential strings", () => {
    expect(() =>
      decodeAzureDevOpsOrganizationPatCredential("fabrikam:old-pat"),
    ).toThrow("azure_devops_credential_invalid");
  });
});

import { describe, expect, it } from "@jest/globals";
import {
  CREDENTIAL_PROVIDERS,
  buildCanonicalRepositoryUrl,
} from "@lcsp/contracts/github-integration";

import { renderReportSourceLocator } from "./assessment-report-source-link.js";

const commitSha = "a".repeat(40);

describe("renderReportSourceLocator", () => {
  it.each([
    [CREDENTIAL_PROVIDERS.github, "owner/repo"],
    [CREDENTIAL_PROVIDERS.gitlab, "group/subgroup/repo"],
    [CREDENTIAL_PROVIDERS.bitbucket, "workspace/repo"],
    [CREDENTIAL_PROVIDERS.azureDevOps, "org/Project Space/repo name"],
  ] as const)(
    "links %s evidence to its pinned repository",
    (provider, fullName) => {
      const canonicalRepositoryUrl = buildCanonicalRepositoryUrl(
        provider,
        fullName,
      );
      expect(canonicalRepositoryUrl).not.toBeNull();
      const html = renderReportSourceLocator("src/file.ts:4-8", {
        provider,
        canonicalRepositoryUrl: canonicalRepositoryUrl as string,
        commitSha,
      });
      expect(html).toContain(`<a href="`);
      expect(html).toContain(commitSha);
      expect(html).toContain("src/file.ts:4-8");
      expect(html).toContain('rel="noopener noreferrer"');
    },
  );

  it("keeps invalid locators and incomplete provenance internal", () => {
    const source = {
      provider: CREDENTIAL_PROVIDERS.github,
      canonicalRepositoryUrl: "https://github.com/owner/repo",
      commitSha,
    };
    expect(renderReportSourceLocator("../secret.ts:1-2", source)).not.toContain(
      "<a ",
    );
    expect(renderReportSourceLocator("src/file.ts:4-8", null)).not.toContain(
      "<a ",
    );
    expect(renderReportSourceLocator("<script>:4-8", null)).toContain(
      "&lt;script&gt;",
    );
  });
});

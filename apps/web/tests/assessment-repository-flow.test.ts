import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { ASSESSMENT_REPOSITORY_PROVIDERS } from "@lcsp/contracts/assessment";

import {
  repositoryEntrySchema,
  repositorySetupSchema,
} from "../src/features/assessment-flow/schemas/repository-setup.schema";
import { REPOSITORY_SETUP_ISSUES } from "../src/features/assessment-flow/config/repository-setup-issues";

const newAssessmentPagePath = new URL(
  "../src/app/(workspace)/assessments/new/page.tsx",
  import.meta.url,
);
const repositorySetupPath = new URL(
  "../src/features/assessment-flow/components/organisms/repository-setup-step.tsx",
  import.meta.url,
);
const repositoryConnectionResultPath = new URL(
  "../src/features/assessment-flow/components/molecules/repository-connection-result.tsx",
  import.meta.url,
);

test("new assessment page creates through the canonical form and repository setup runs inside the assessment", async () => {
  const [page, setup] = await Promise.all([
    readFile(newAssessmentPagePath, "utf8"),
    readFile(repositorySetupPath, "utf8"),
  ]);

  assert.match(page, /CreateAssessmentForm/);
  assert.doesNotMatch(page, /RepositorySetupStep/);
  assert.match(setup, /RepositorySetupLayout/);
  assert.match(setup, /ProviderCredentialDialog/);
  assert.match(setup, /ConfirmAccessDialog/);
  assert.match(setup, /onReauthenticate/);
  assert.doesNotMatch(
    setup,
    /useDeleteAssessmentMutation|deleteAssessment\.mutateAsync/,
  );
  assert.match(setup, /connectAssessmentRepository/);
  assert.match(setup, /startRepositoryAnalysis/);
  assert.match(setup, /RepositoryPicker/);
});

test("repository setup accepts only valid repository URLs matching supported provider rules", () => {
  assert.equal(
    repositoryEntrySchema.safeParse({
      sourcePathPrefix: null,
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.github,
      repositoryUrl: "https://github.com/acme/payments.git",
    }).success,
    true,
  );
  assert.equal(
    repositoryEntrySchema.safeParse({
      sourcePathPrefix: null,
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.gitlab,
      repositoryUrl: "https://gitlab.com/org/team/subgroup/project.git",
    }).success,
    true,
  );
  assert.equal(
    repositoryEntrySchema.safeParse({
      sourcePathPrefix: null,
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.bitbucket,
      repositoryUrl: "https://bitbucket.org/workspace-slug/repo-slug",
    }).success,
    true,
  );
  assert.equal(
    repositoryEntrySchema.safeParse({
      sourcePathPrefix: null,
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.azureDevOps,
      repositoryUrl:
        "https://dev.azure.com/acme/Platform%20Team/_git/service%20api",
    }).success,
    true,
  );
  assert.equal(
    repositoryEntrySchema.safeParse({
      sourcePathPrefix: null,
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.azureDevOps,
      repositoryUrl:
        "https://acme.visualstudio.com/Platform%20Team/_git/service%20api",
    }).success,
    true,
  );
  assert.equal(
    repositoryEntrySchema.safeParse({
      sourcePathPrefix: null,
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.bitbucket,
      repositoryUrl: "https://dev.azure.com/acme/project/_git/repo",
    }).success,
    false,
  );
  assert.equal(
    repositoryEntrySchema.safeParse({
      sourcePathPrefix: null,
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.gitlab,
      repositoryUrl: "https://github.com/acme/payments",
    }).success,
    false,
  );
  assert.equal(
    repositoryEntrySchema.safeParse({
      sourcePathPrefix: null,
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.bitbucket,
      repositoryUrl: "https://bitbucket.org/workspace/repo/src/main",
    }).success,
    false,
  );
  assert.equal(
    repositoryEntrySchema.safeParse({
      sourcePathPrefix: null,
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.github,
      repositoryUrl: "http://github.com/acme/payments",
    }).success,
    false,
  );
  assert.equal(
    repositoryEntrySchema.safeParse({
      sourcePathPrefix: null,
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.github,
      repositoryUrl: "https://github.com/acme/payments/tree/main",
    }).success,
    false,
  );
  assert.equal(
    repositoryEntrySchema.safeParse({
      sourcePathPrefix: null,
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.github,
      repositoryUrl: "https://github.com/acme/payments?tab=code",
    }).success,
    false,
  );
});

test("repository history row uses provider and commit icons without repeating the prompt", async () => {
  const source = await readFile(repositoryConnectionResultPath, "utf8");

  assert.match(source, /data-slot="repository-connection-result"/);
  assert.match(source, /next\/image/);
  assert.match(source, /GIT_PROVIDER_LOGOS/);
  assert.match(source, /GitBranchIcon/);
  assert.match(source, /repositoryFullName/);
  assert.match(source, /commitSha\?\.slice\(0, 12\)/);
  assert.doesNotMatch(source, /<svg/);
  assert.doesNotMatch(source, /SelectionHistoryRow/);
  assert.doesNotMatch(source, /selectedValue/);
});

const entry = (provider: string, repositoryUrl: string, prefix: string | null = null) => ({
  provider,
  repositoryUrl,
  sourcePathPrefix: prefix,
});

test("repository set accepts several distinct repositories and a monorepo once per directory", () => {
  const github = ASSESSMENT_REPOSITORY_PROVIDERS.github;
  const result = repositorySetupSchema.safeParse({
    provider: github,
    repositoryUrl: "",
    repositories: [
      entry(github, "https://github.com/acme/web"),
      entry(ASSESSMENT_REPOSITORY_PROVIDERS.gitlab, "https://gitlab.com/acme/api"),
      entry(github, "https://github.com/acme/mono", "apps/web"),
      entry(github, "https://github.com/acme/mono", "apps/admin"),
    ],
  });
  assert.equal(result.success, true);
});

test("repository set rejects the same repository twice with the same scope, ignoring GitHub letter case", () => {
  const github = ASSESSMENT_REPOSITORY_PROVIDERS.github;
  const result = repositorySetupSchema.safeParse({
    repositoryUrl: "",
    repositories: [
      entry(github, "https://github.com/Acme/Web"),
      entry(github, "https://github.com/acme/web.git"),
    ],
  });
  assert.equal(result.success, false);
  assert.deepEqual(
    result.error?.issues.map((issue) => [issue.path.join("."), issue.message]),
    [["repositories.1.repositoryUrl", REPOSITORY_SETUP_ISSUES.duplicateRepository]],
  );
});

test("repository set never exceeds the contract limit and rejects an unsupported entry", () => {
  const github = ASSESSMENT_REPOSITORY_PROVIDERS.github;
  const many = Array.from({ length: 6 }, (_, index) =>
    entry(github, `https://github.com/acme/repo-${index}`),
  );
  assert.equal(
    repositorySetupSchema.safeParse({ repositoryUrl: "", repositories: many })
      .success,
    false,
  );
  assert.equal(
    repositorySetupSchema.safeParse({
      repositoryUrl: "",
      repositories: [
        entry("unknown-provider", "https://example.com/acme/app"),
      ],
    }).success,
    false,
  );
});

test("repository entry keeps a canonical source scope and rejects an escaping one", () => {
  const github = ASSESSMENT_REPOSITORY_PROVIDERS.github;
  assert.equal(
    repositoryEntrySchema.safeParse(
      entry(github, "https://github.com/acme/mono", "apps/web"),
    ).success,
    true,
  );
  assert.equal(
    repositoryEntrySchema.safeParse(
      entry(github, "https://github.com/acme/mono", "../secrets"),
    ).success,
    false,
  );
});

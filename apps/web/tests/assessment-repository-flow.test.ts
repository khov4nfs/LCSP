import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { ASSESSMENT_REPOSITORY_PROVIDERS } from "@lcsp/contracts/assessment";

import { repositorySetupSchema } from "../src/features/assessment-flow/schemas/repository-setup.schema";

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
  assert.match(setup, /RepositorySetupConversation/);
  assert.match(setup, /ProviderCredentialDialog/);
  assert.match(setup, /ConfirmAccessDialog/);
  assert.match(setup, /onReauthenticate/);
  assert.doesNotMatch(
    setup,
    /useDeleteAssessmentMutation|deleteAssessment\.mutateAsync/,
  );
  assert.match(setup, /connectAssessmentRepository/);
  assert.match(setup, /startRepositoryAnalysis/);
  assert.match(setup, /AssessmentComposer/);
});

test("repository setup accepts only valid repository URLs matching supported provider rules", () => {
  assert.equal(
    repositorySetupSchema.safeParse({
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.github,
      repositoryUrl: "https://github.com/acme/payments.git",
    }).success,
    true,
  );
  assert.equal(
    repositorySetupSchema.safeParse({
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.gitlab,
      repositoryUrl: "https://gitlab.com/org/team/subgroup/project.git",
    }).success,
    true,
  );
  assert.equal(
    repositorySetupSchema.safeParse({
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.bitbucket,
      repositoryUrl: "https://bitbucket.org/workspace-slug/repo-slug",
    }).success,
    false,
  );
  assert.equal(
    repositorySetupSchema.safeParse({
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.gitlab,
      repositoryUrl: "https://github.com/acme/payments",
    }).success,
    false,
  );
  assert.equal(
    repositorySetupSchema.safeParse({
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.bitbucket,
      repositoryUrl: "https://bitbucket.org/workspace/repo/src/main",
    }).success,
    false,
  );
  assert.equal(
    repositorySetupSchema.safeParse({
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.github,
      repositoryUrl: "http://github.com/acme/payments",
    }).success,
    false,
  );
  assert.equal(
    repositorySetupSchema.safeParse({
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.github,
      repositoryUrl: "https://github.com/acme/payments/tree/main",
    }).success,
    false,
  );
  assert.equal(
    repositorySetupSchema.safeParse({
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
  assert.match(source, /\/assets\/figma\/settings\/logo-github\.svg/);
  assert.match(source, /GitBranchIcon/);
  assert.match(source, /repositoryFullName/);
  assert.match(source, /commitSha\.slice\(0, 12\)/);
  assert.doesNotMatch(source, /<svg/);
  assert.doesNotMatch(source, /SelectionHistoryRow/);
  assert.doesNotMatch(source, /selectedValue/);
});

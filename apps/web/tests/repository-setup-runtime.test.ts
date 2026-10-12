import assert from "node:assert/strict";
import { test } from "node:test";
import { ASSESSMENT_REPOSITORY_PROVIDERS } from "@lcsp/contracts/assessment";
import {
  parseGitHubRepositoryUrl,
  parseGitLabRepositoryUrl,
} from "@lcsp/contracts/github-integration";
import { repositorySetupSchema } from "../src/features/assessment-flow/schemas/repository-setup.schema";

const samples = [
  "https://github.com/acme/project",
  "https://github.com/acme/project.git/",
  "https://github.com/acme//project",
  "https://github.com/acme/project/tree/main",
  "http://github.com/acme/project",
  "https://github.com/acme/project?tab=code",
  "https://gitlab.com/acme/tree/subgroup/project.git",
  "https://gitlab.com/acme//project",
  "https://gitlab.com/acme/project/-/blob/main/file.ts",
  "https://github.com/acme/project#readme",
];
for (const repositoryUrl of samples) {
  test(`web schema agrees with the API's shared parser: ${repositoryUrl}`, () => {
    for (const provider of [
      ASSESSMENT_REPOSITORY_PROVIDERS.github,
      ASSESSMENT_REPOSITORY_PROVIDERS.gitlab,
    ]) {
      const parse =
        provider === ASSESSMENT_REPOSITORY_PROVIDERS.github
          ? parseGitHubRepositoryUrl
          : parseGitLabRepositoryUrl;
      assert.equal(
        repositorySetupSchema.safeParse({ provider, repositoryUrl }).success,
        parse(repositoryUrl) !== null,
      );
    }
  });
}

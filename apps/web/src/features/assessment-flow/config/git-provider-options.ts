import { ASSESSMENT_REPOSITORY_PROVIDERS } from "@lcsp/contracts/assessment";

export const GIT_PROVIDER_OPTIONS = [
  {
    id: ASSESSMENT_REPOSITORY_PROVIDERS.github,
    labelKey: "pages.assessmentFlow.providers.github",
    hostname: "github.com",
    supported: true,
  },
  {
    id: ASSESSMENT_REPOSITORY_PROVIDERS.gitlab,
    labelKey: "pages.assessmentFlow.providers.gitlab",
    hostname: "gitlab.com",
    supported: true,
  },
  {
    id: ASSESSMENT_REPOSITORY_PROVIDERS.bitbucket,
    labelKey: "pages.assessmentFlow.providers.bitbucket",
    hostname: "bitbucket.org",
    supported: true,
  },
  {
    id: ASSESSMENT_REPOSITORY_PROVIDERS.azureDevOps,
    labelKey: "pages.assessmentFlow.providers.azureDevOps",
    hostname: "dev.azure.com",
    supported: true,
  },
] as const;

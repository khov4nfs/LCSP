import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ASSESSMENT_REPOSITORY_PROVIDERS } from "@lcsp/contracts/assessment";
import { renderToStaticMarkup } from "react-dom/server";
import { useForm } from "react-hook-form";

import {
  GitAccountStrip,
  GitPermissionsBadges,
} from "../src/components/molecules/git-provider-identity";
import { GitProviderCard } from "../src/features/assessment-flow/components/molecules/git-provider-card";
import { RepositoryPicker } from "../src/features/assessment-flow/components/molecules/repository-picker";
import { SecureConnectionForm } from "../src/features/assessment-flow/components/molecules/secure-connection-form";
import {
  SETUP_STATUS_ROW_TONES,
  SetupStatusPanel,
} from "../src/features/assessment-flow/components/molecules/setup-status-panel";
import {
  SETUP_STEP_STATES,
  SetupStepper,
} from "../src/features/assessment-flow/components/molecules/setup-stepper";
import { SourceVersionPicker } from "../src/features/assessment-flow/components/molecules/source-version-picker";
import {
  RepositorySetupLayout,
  SETUP_HEADER_TONES,
  SUMMARY_STATUS_TONES,
} from "../src/features/assessment-flow/components/organisms/repository-setup-layout";
import type { RepositorySetupFormData } from "../src/features/assessment-flow/schemas/repository-setup.schema";
import { setAppLocale } from "../src/lib/locale";

function mockLocale(locale: "en" | "vi") {
  setAppLocale(locale);
}

function TestRepositoryPickerWrapper({
  errorMessage,
  canEnterRepository = true,
  pinnedCommitSha,
}: {
  errorMessage?: string;
  canEnterRepository?: boolean;
  pinnedCommitSha?: string | null;
}) {
  const form = useForm<RepositorySetupFormData>({
    defaultValues: {
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.github,
      repositoryUrl: "https://github.com/acme/notice-service",
    },
  });

  return (
    <RepositoryPicker
      control={form.control}
      provider={ASSESSMENT_REPOSITORY_PROVIDERS.github}
      connected={canEnterRepository}
      previewOnly={false}
      canEnterRepository={canEnterRepository}
      isSubmitting={false}
      pinnedCommitSha={pinnedCommitSha}
      errorMessage={errorMessage}
      onManageCredential={() => {}}
      onBack={() => {}}
    />
  );
}

describe("Repository setup UI components", () => {
  beforeEach(() => {
    mockLocale("en");
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("renders SetupStepper with 4 canonical steps and EN/VI support", () => {
    const htmlEn = renderToStaticMarkup(
      <SetupStepper
        steps={[
          {
            id: "1",
            label: "Git provider",
            state: SETUP_STEP_STATES.complete,
          },
          {
            id: "2",
            label: "Secure connection",
            state: SETUP_STEP_STATES.current,
          },
          {
            id: "3",
            label: "Repository source",
            state: SETUP_STEP_STATES.upcoming,
          },
          {
            id: "4",
            label: "Scan & activation",
            state: SETUP_STEP_STATES.attention,
          },
        ]}
      />,
    );
    assert.match(htmlEn, /Git provider/);
    assert.match(htmlEn, /Complete/);
    assert.match(htmlEn, /Current step/);
    assert.match(htmlEn, /Upcoming/);
    assert.match(htmlEn, /Needs attention/);
    assert.match(htmlEn, /aria-current="step"/);

    mockLocale("vi");
    const htmlVi = renderToStaticMarkup(
      <SetupStepper
        steps={[
          {
            id: "1",
            label: "Nhà cung cấp Git",
            state: SETUP_STEP_STATES.current,
          },
        ]}
      />,
    );
    assert.match(htmlVi, /Nhà cung cấp Git/);
    assert.match(htmlVi, /Bước hiện tại/);
  });

  it("renders GitProviderCard states including connected, needs-token, and preview-only", () => {
    const githubHtml = renderToStaticMarkup(
      <GitProviderCard
        provider={ASSESSMENT_REPOSITORY_PROVIDERS.github}
        hostname="github.com"
        selected
        connected
        enabled
        onSelect={() => {}}
      />,
    );
    assert.match(githubHtml, /GitHub/);
    assert.match(githubHtml, /Connected/);
    assert.match(githubHtml, /aria-pressed="true"/);

    const azureHtml = renderToStaticMarkup(
      <GitProviderCard
        provider={ASSESSMENT_REPOSITORY_PROVIDERS.azureDevOps}
        hostname="dev.azure.com"
        selected={false}
        connected={false}
        enabled={false}
        onSelect={() => {}}
      />,
    );
    assert.match(azureHtml, /Azure DevOps/);
    assert.match(azureHtml, /Preview only/);
  });

  it("renders SecureConnectionForm with READ/WRITE permissions and blocks preview-only continuation", () => {
    const previewHtml = renderToStaticMarkup(
      <SecureConnectionForm
        provider={ASSESSMENT_REPOSITORY_PROVIDERS.bitbucket}
        connected={false}
        previewOnly
        onConfigureCredential={() => {}}
        onContinue={() => {}}
        onBack={() => {}}
      />,
    );
    assert.match(previewHtml, /READ/);
    assert.match(previewHtml, /WRITE/);
    assert.match(previewHtml, /Preview-only provider paths cannot complete/);
    assert.match(previewHtml, /disabled=""/);
  });

  it("renders RepositoryPicker with URL input, pinned revision, and validation error alert", () => {
    const html = renderToStaticMarkup(
      <TestRepositoryPickerWrapper
        errorMessage="Enter a valid repository URL that matches the selected provider."
        pinnedCommitSha="abc1234567890"
      />,
    );
    assert.match(html, /https:\/\/github\.com\/acme\/notice-service/);
    assert.match(html, /abc1234/);
    assert.match(html, /role="alert"/);
    assert.match(html, /Enter a valid repository URL/);
  });

  it("renders SetupStatusPanel and RepositorySetupLayout in retry-safely error and waiting states", () => {
    const layoutHtml = renderToStaticMarkup(
      <RepositorySetupLayout
        steps={[
          {
            id: "1",
            label: "Git provider",
            state: SETUP_STEP_STATES.complete,
          },
          {
            id: "2",
            label: "Secure connection",
            state: SETUP_STEP_STATES.complete,
          },
          {
            id: "3",
            label: "Repository source",
            state: SETUP_STEP_STATES.complete,
          },
          {
            id: "4",
            label: "Scan & activation",
            state: SETUP_STEP_STATES.attention,
          },
        ]}
        stepTitle="Repository setup needs attention"
        stepSubtitle="We kept your saved connection and source checkpoint."
        headerTone={SETUP_HEADER_TONES.danger}
        assessmentTitle="notice-service"
        summaryStatusLabel="Needs attention"
        summaryStatusTone={SUMMARY_STATUS_TONES.danger}
        provider={ASSESSMENT_REPOSITORY_PROVIDERS.gitlab}
        repositoryLabel="https://gitlab.com/acme/notice-service"
        rulesLabel="Awaiting activation"
      >
        <SetupStatusPanel
          rows={[
            {
              id: "r1",
              label: "Repository connection saved",
              context: "GitLab",
              badgeLabel: "Done",
              tone: SETUP_STATUS_ROW_TONES.success,
            },
            {
              id: "r2",
              label: "Setup could not be completed",
              context: "Check credentials and retry.",
              badgeLabel: "Setup failed",
              tone: SETUP_STATUS_ROW_TONES.danger,
            },
          ]}
          noticeTitle="Retry safely"
          noticeBody="Your saved repository connection and source checkpoint remain intact."
          noticeTone={SETUP_STATUS_ROW_TONES.warning}
        />
      </RepositorySetupLayout>,
    );

    assert.match(layoutHtml, /Complete assessment setup/);
    assert.match(layoutHtml, /Repository setup needs attention/);
    assert.match(layoutHtml, /Assessment summary/);
    assert.match(layoutHtml, /Setup status is not a legal compliance result/);
    assert.match(layoutHtml, /Retry safely/);
    assert.match(layoutHtml, /Setup failed/);
  });

  it("renders shared GitAccountStrip, GitPermissionsBadges, and SourceVersionPicker", () => {
    const html = renderToStaticMarkup(
      <div>
        <GitAccountStrip
          provider={ASSESSMENT_REPOSITORY_PROVIDERS.github}
          connected
          subtitle="Verified token"
        />
        <GitPermissionsBadges />
        <SourceVersionPicker pinnedCommitSha={null} />
      </div>,
    );
    assert.match(html, /GitHub/);
    assert.match(html, /Verified token/);
    assert.match(html, /Default branch HEAD/);
  });
});

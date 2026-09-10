import { ASSESSMENT_REPOSITORY_PROVIDERS } from "@lcsp/contracts/assessment";
import type { MessageKey } from "@lcsp/i18n";
import { GitBranchIcon } from "lucide-react";
import Image from "next/image";

import { resolveAppMessage } from "@/lib/i18n";

import type { NormalizedAssessmentRepository } from "../../../workspace/types/assessment-runtime-adapter.types";

const PROVIDER_LOGOS = {
  [ASSESSMENT_REPOSITORY_PROVIDERS.github]:
    "/assets/figma/settings/logo-github.svg",
  [ASSESSMENT_REPOSITORY_PROVIDERS.gitlab]:
    "/assets/figma/settings/logo-gitlab.svg",
  [ASSESSMENT_REPOSITORY_PROVIDERS.bitbucket]:
    "/assets/figma/settings/logo-bitbucket.svg",
  [ASSESSMENT_REPOSITORY_PROVIDERS.azureDevOps]:
    "/assets/figma/settings/logo-azure-devops.svg",
} as const;

export function RepositoryContextCard({
  repository,
}: {
  repository: NormalizedAssessmentRepository;
}) {
  const fields = [
    ["pages.appShell.runtimePanelRepository", repository.repositoryFullName],
    ["pages.appShell.runtimePanelBranch", repository.branch],
    ["pages.appShell.runtimePanelPinnedCommit", repository.pinnedCommit],
  ] as const;

  return (
    <section
      className="rounded-xl border border-border/70 bg-card p-3.5 shadow-xs"
      aria-label={resolveAppMessage(
        "pages.appShell.runtimePanelRepository" as MessageKey,
      )}
    >
      <p className="text-[0.6875rem] font-semibold tracking-widest text-muted-foreground uppercase">
        {resolveAppMessage(
          "pages.appShell.runtimePanelRepository" as MessageKey,
        )}
      </p>
      <dl className="mt-3 space-y-2">
        {repository.provider ? (
          <div className="flex items-start justify-between gap-3 text-xs">
            <dt className="text-muted-foreground">
              {resolveAppMessage(
                "pages.appShell.runtimePanelProvider" as MessageKey,
              )}
            </dt>
            <dd className="flex min-w-0 items-center justify-end gap-1.5 text-right font-medium text-foreground">
              <ProviderIcon provider={repository.provider} />
              <span className="truncate">{repository.provider}</span>
            </dd>
          </div>
        ) : null}
        {fields.map(([label, value]) =>
          value ? (
            <div
              className="flex items-start justify-between gap-3 text-xs"
              key={label}
            >
              <dt className="text-muted-foreground">
                {resolveAppMessage(label as MessageKey)}
              </dt>
              <dd className="min-w-0 truncate text-right font-medium text-foreground">
                {value}
              </dd>
            </div>
          ) : null,
        )}
      </dl>
    </section>
  );
}

function ProviderIcon({ provider }: { provider: string }) {
  const logoSrc = providerLogoSrc(provider);

  if (!logoSrc) {
    return (
      <GitBranchIcon
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
    );
  }

  return (
    <Image
      alt=""
      aria-hidden="true"
      className="size-4 shrink-0"
      data-provider-icon={provider}
      height={16}
      src={logoSrc}
      width={16}
    />
  );
}

function providerLogoSrc(provider: string) {
  const normalizedProvider = provider
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

  if (Object.hasOwn(PROVIDER_LOGOS, normalizedProvider)) {
    return PROVIDER_LOGOS[normalizedProvider as keyof typeof PROVIDER_LOGOS];
  }

  return null;
}

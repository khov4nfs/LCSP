import { resolveMessage } from "@lcsp/i18n";
import { ASSESSMENT_REPOSITORY_PROVIDERS } from "@lcsp/contracts/assessment";
import { GitBranchIcon } from "lucide-react";
import Image from "next/image";

import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

import type { RepositoryHistory } from "../../types/assessment-flow.types";

const PROVIDER_LOGOS = {
  [ASSESSMENT_REPOSITORY_PROVIDERS.github]:
    "/assets/figma/settings/logo-github.svg",
  [ASSESSMENT_REPOSITORY_PROVIDERS.gitlab]:
    "/assets/figma/settings/logo-gitlab.svg",
} as const;

type RepositoryConnectionResultProps = RepositoryHistory & {
  className?: string;
};

export function RepositoryConnectionResult({
  provider,
  repositoryFullName,
  commitSha,
  className,
}: RepositoryConnectionResultProps) {
  const providerLabel = formatProvider(provider);
  const shortCommit = commitSha.slice(0, 12);

  return (
    <div
      data-slot="repository-connection-result"
      aria-label={`${providerLabel} ${repositoryFullName} ${t(
        "pages.assessmentFlow.repository.pinnedCommit",
      ).replace("{commit}", shortCommit)}`}
      className={cn(
        "flex min-h-6 min-w-0 items-center gap-2 text-[12.5px] leading-4.5 text-muted-foreground",
        className,
      )}
    >
      <ProviderIcon provider={provider} />
      <span className="min-w-0 truncate font-medium">{repositoryFullName}</span>
      <span aria-hidden="true" className="shrink-0 text-muted-foreground/70">
        ·
      </span>
      <GitBranchIcon
        aria-hidden="true"
        className="size-3.5 shrink-0 text-muted-foreground"
      />
      <span className="shrink-0 font-mono text-muted-foreground">
        {shortCommit}
      </span>
    </div>
  );
}

function ProviderIcon({ provider }: { provider: string }) {
  const logoSrc = providerLogoSrc(provider);

  if (logoSrc) {
    return (
      <Image
        alt=""
        aria-hidden="true"
        className="size-3.5 shrink-0"
        height={14}
        src={logoSrc}
        width={14}
      />
    );
  }

  return (
    <GitBranchIcon
      aria-hidden="true"
      className="size-3.5 shrink-0 text-muted-foreground"
    />
  );
}

function providerLogoSrc(provider: string) {
  if (
    provider === ASSESSMENT_REPOSITORY_PROVIDERS.github ||
    provider === ASSESSMENT_REPOSITORY_PROVIDERS.gitlab
  ) {
    return PROVIDER_LOGOS[provider];
  }
  return null;
}

function formatProvider(provider: string) {
  if (provider === ASSESSMENT_REPOSITORY_PROVIDERS.github) {
    return t("pages.assessmentFlow.providers.github");
  }
  if (provider === ASSESSMENT_REPOSITORY_PROVIDERS.gitlab) {
    return t("pages.assessmentFlow.providers.gitlab");
  }
  return provider;
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}

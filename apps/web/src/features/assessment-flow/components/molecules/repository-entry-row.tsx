"use client";

import { resolveMessage } from "@lcsp/i18n";
import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { appLocale } from "@/lib/locale";

import { RepositoryConnectionResult } from "./repository-connection-result";

type RepositoryEntryRowProps = {
  provider: string;
  repositoryFullName: string;
  sourcePathPrefix: string | null;
  /** Pinned commit; absent for a repository that is chosen but not saved yet. */
  commitSha?: string | null;
  /** Hides the remove action (a pinned repository can no longer be removed). */
  removable: boolean;
  removing?: boolean;
  onRemove: () => void;
};

/**
 * One chosen repository with its remove action. It is domain-specific to repository setup, so it lives in the
 * feature rather than in the shared Atomic Design folders.
 */
export function RepositoryEntryRow({
  provider,
  repositoryFullName,
  sourcePathPrefix,
  commitSha,
  removable,
  removing = false,
  onRemove,
}: RepositoryEntryRowProps) {
  return (
    <li
      data-slot="repository-entry-row"
      className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-muted/60 px-3.5 py-2"
    >
      <RepositoryConnectionResult
        provider={provider}
        repositoryFullName={repositoryFullName}
        sourcePathPrefix={sourcePathPrefix}
        commitSha={commitSha ?? undefined}
      />
      {removable ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={removing}
          aria-label={t("pages.assessmentFlow.removeRepository").replace(
            "{repository}",
            repositoryFullName,
          )}
          onClick={onRemove}
        >
          <XIcon aria-hidden="true" />
        </Button>
      ) : null}
    </li>
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}

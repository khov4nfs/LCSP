"use client";

import { resolveMessage } from "@lcsp/i18n";
import { useFieldArray, useFormContext } from "react-hook-form";

import { appLocale } from "@/lib/locale";

import type {
  RepositorySetupFormValues,
  SavedRepositoryRow,
} from "../../types/repository-setup.types";
import { repositoryFullNameOf } from "../../utils/repository-entry";
import { RepositoryEntryRow } from "../molecules/repository-entry-row";

type RepositorySetupListProps = {
  /** Repositories already saved on the server (candidates, or the pinned set once setup completed). */
  saved: readonly SavedRepositoryRow[];
  /** How many repositories one assessment may hold; shown next to the count. */
  limit: number;
  disabled?: boolean;
  removingSnapshotId?: string | null;
  onRemoveSaved: (snapshotId: string) => void;
};

/**
 * Lists every repository chosen for the assessment: saved ones first, then those still being collected in the form.
 * The pending ones are the form's `repositories` field array, read through the form context rather than props.
 */
export function RepositorySetupList({
  saved,
  limit,
  disabled = false,
  removingSnapshotId = null,
  onRemoveSaved,
}: RepositorySetupListProps) {
  const { control } = useFormContext<RepositorySetupFormValues>();
  const { fields, remove } = useFieldArray({ control, name: "repositories" });
  const total = saved.length + fields.length;
  if (total === 0) return null;

  return (
    <section
      data-slot="repository-setup-list"
      aria-label={t("pages.assessmentFlow.repositoriesTitle")
        .replace("{count}", String(total))
        .replace("{limit}", String(limit))}
      className="space-y-2"
    >
      <p className="text-sm font-medium text-foreground">
        {t("pages.assessmentFlow.repositoriesTitle")
          .replace("{count}", String(total))
          .replace("{limit}", String(limit))}
      </p>
      <ul className="flex min-w-0 flex-col gap-2">
        {saved.map((row) => (
          <RepositoryEntryRow
            key={row.snapshotId ?? `${row.provider}:${row.repositoryFullName}`}
            provider={row.provider}
            repositoryFullName={row.repositoryFullName}
            sourcePathPrefix={row.sourcePathPrefix}
            commitSha={row.commitSha}
            removable={!row.pinned && row.snapshotId !== null && !disabled}
            removing={removingSnapshotId === row.snapshotId}
            onRemove={() => {
              if (row.snapshotId) onRemoveSaved(row.snapshotId);
            }}
          />
        ))}
        {fields.map((field, index) => (
          <RepositoryEntryRow
            key={field.id}
            provider={field.provider}
            repositoryFullName={
              repositoryFullNameOf(field) ?? field.repositoryUrl
            }
            sourcePathPrefix={field.sourcePathPrefix}
            removable={!disabled}
            onRemove={() => remove(index)}
          />
        ))}
      </ul>
    </section>
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}

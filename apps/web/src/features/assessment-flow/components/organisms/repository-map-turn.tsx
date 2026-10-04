"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ASSESSMENT_REPOSITORY_PROVIDERS,
  ASSESSMENT_REPOSITORY_RELATION_TYPES,
  type AssessmentRepositoryRelationType,
  type AssessmentRepositorySetupRepository,
} from "@lcsp/contracts/assessment";
import { resolveMessage } from "@lcsp/i18n";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  AgentMessage,
  AgentTurn,
  ThoughtLine,
} from "@/features/workspace/components/molecules/agent-turn";
import { appLocale } from "@/lib/locale";
import {
  removeAssessmentRepository,
  saveAssessmentRepositoryRelation,
  removeAssessmentRepositoryRelation,
} from "@/lib/api/repository-analysis-client";

import {
  repositoryRelationSchema,
  type RepositoryRelationFormValues,
} from "../../schemas/repository-relation.schema";

type Relation = {
  id: string;
  fromSnapshotId: string;
  toSnapshotId: string;
  type: AssessmentRepositoryRelationType;
};

export function RepositoryMapTurn({
  assessmentId,
  repositories,
  relations,
  onChanged,
  onEditRepository,
  onAddRepository,
  onRelationEditorOpen,
  repositoryEntryActive = false,
  onReviewScope,
}: {
  assessmentId: string;
  repositories: AssessmentRepositorySetupRepository[];
  relations: Relation[];
  onChanged: () => void;
  onEditRepository?: (repository: AssessmentRepositorySetupRepository) => void;
  onAddRepository?: () => void;
  onRelationEditorOpen?: () => void;
  repositoryEntryActive?: boolean;
  onReviewScope?: () => void;
}) {
  const pinnableRepositories = repositories.filter(
    (repository) => repository.snapshot !== null,
  );
  const [editing, setEditing] = useState<Relation | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [confirmingRemoval, setConfirmingRemoval] = useState<string | null>(
    null,
  );
  const [submitError, setSubmitError] = useState(false);
  const form = useForm<RepositoryRelationFormValues>({
    resolver: zodResolver(repositoryRelationSchema),
    defaultValues: {
      fromSnapshotId: "",
      toSnapshotId: "",
      type: ASSESSMENT_REPOSITORY_RELATION_TYPES.runtimeApiInteraction,
    },
  });
  const snapshotLabel = (id: string) => {
    const repo = repositories.find((item) => item.snapshot?.id === id);
    return repo
      ? `${formatProvider(repo.provider)} · ${repo.repositoryFullName}`
      : id;
  };
  const beginEdit = (relation?: Relation) => {
    onRelationEditorOpen?.();
    setSubmitError(false);
    setEditing(relation ?? null);
    setEditorOpen(true);
    form.reset(
      relation
        ? {
            fromSnapshotId: relation.fromSnapshotId,
            toSnapshotId: relation.toSnapshotId,
            type: relation.type,
          }
        : {
            fromSnapshotId: pinnableRepositories[0]?.snapshot?.id ?? "",
            toSnapshotId: pinnableRepositories[1]?.snapshot?.id ?? "",
            type: ASSESSMENT_REPOSITORY_RELATION_TYPES.runtimeApiInteraction,
          },
    );
  };
  const submit = form.handleSubmit(async (values) => {
    try {
      await saveAssessmentRepositoryRelation(assessmentId, {
        ...values,
        relationId: editing?.id,
      });
      setEditing(null);
      setEditorOpen(false);
      form.reset();
      onChanged();
    } catch {
      setSubmitError(true);
    }
  });
  const affectedRelationCount = confirmingRemoval
    ? relations.filter((relation) => {
        const repository = repositories.find(
          (item) => item.connectionId === confirmingRemoval,
        );
        return (
          relation.fromSnapshotId === repository?.snapshot?.id ||
          relation.toSnapshotId === repository?.snapshot?.id
        );
      }).length
    : 0;

  return (
    <AgentTurn>
      <AgentMessage>
        <ThoughtLine
          label={t("pages.assessmentFlow.multiRepository.thought")}
        />
        <p className="mt-2">
          {t("pages.assessmentFlow.multiRepository.description")}
        </p>
      </AgentMessage>
      <div className="mt-3 overflow-x-auto rounded-md border">
        <table
          className="w-full min-w-136 text-left text-xs"
          aria-label={t("pages.assessmentFlow.multiRepository.tableLabel")}
        >
          <caption className="sr-only">
            {t("pages.assessmentFlow.multiRepository.tableLabel")}
          </caption>
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="p-2">
                {t("pages.assessmentFlow.multiRepository.repository")}
              </th>
              <th className="p-2">
                {t("pages.assessmentFlow.multiRepository.relations")} &middot;{" "}
                {relations.length}
              </th>
            </tr>
          </thead>
          <tbody>
            {repositories.map((repository) => (
              <tr
                key={repository.connectionId}
                className="border-b last:border-0"
              >
                <th scope="row" className="p-2 font-medium">
                  {repository.repositoryFullName}
                  <span className="block font-normal text-muted-foreground">
                    {formatProvider(repository.provider)} &middot;{" "}
                    {repository.snapshot?.commitSha.slice(0, 12) ??
                      t("pages.assessmentFlow.repository.pending")}
                  </span>
                  <div className="mt-2 flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (onEditRepository) onEditRepository(repository);
                        else beginEdit();
                      }}
                    >
                      {t("pages.assessmentFlow.multiRepository.edit")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setConfirmingRemoval(repository.connectionId)
                      }
                    >
                      {t(
                        "pages.assessmentFlow.multiRepository.removeRepository",
                      )}
                    </Button>
                  </div>
                </th>
                <td className="p-2">
                  {relations
                    .filter(
                      (relation) =>
                        relation.fromSnapshotId === repository.snapshot?.id ||
                        relation.toSnapshotId === repository.snapshot?.id,
                    )
                    .map((relation) => (
                      <button
                        key={relation.id}
                        type="button"
                        className="mr-2 rounded-sm underline"
                        onClick={() => beginEdit(relation)}
                      >
                        {snapshotLabel(relation.fromSnapshotId)} &rarr;{" "}
                        {snapshotLabel(relation.toSnapshotId)} &middot;{" "}
                        {relationTypeLabel(relation.type)}
                      </button>
                    ))}
                  {relations.every(
                    (relation) =>
                      relation.fromSnapshotId !== repository.snapshot?.id &&
                      relation.toSnapshotId !== repository.snapshot?.id,
                  ) ? (
                    <span className="text-muted-foreground">
                      {t("pages.assessmentFlow.multiRepository.noRelation")}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {confirmingRemoval ? (
        <AgentTurn>
          <AgentMessage>
            <p className="text-sm">
              {t("pages.assessmentFlow.multiRepository.removeConfirm")}
            </p>
            {affectedRelationCount > 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {t(
                  "pages.assessmentFlow.multiRepository.relationCount",
                ).replace("{count}", String(affectedRelationCount))}
              </p>
            ) : null}
          </AgentMessage>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="destructive"
              onClick={async () => {
                try {
                  await removeAssessmentRepository(
                    assessmentId,
                    confirmingRemoval,
                  );
                  setConfirmingRemoval(null);
                  onChanged();
                } catch {
                  setSubmitError(true);
                }
              }}
            >
              {t("pages.assessmentFlow.multiRepository.removeRepository")}
            </Button>
            <Button
              type="button"
              variant="outline"
              autoFocus
              onClick={() => setConfirmingRemoval(null)}
            >
              {t("pages.assessmentFlow.multiRepository.cancel")}
            </Button>
          </div>
        </AgentTurn>
      ) : null}
      {pinnableRepositories.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {pinnableRepositories.length > 1 ? (
            <Button
              type="button"
              variant="outline"
              aria-pressed={editorOpen}
              onClick={() => beginEdit()}
            >
              {t("pages.assessmentFlow.multiRepository.addRelation")}
            </Button>
          ) : null}
          {onAddRepository ? (
            <Button
              type="button"
              variant="outline"
              aria-pressed={repositoryEntryActive}
              onClick={() => {
                setEditing(null);
                setEditorOpen(false);
                form.reset();
                onAddRepository();
              }}
            >
              {t("pages.assessmentFlow.multiRepository.addRepository")}
            </Button>
          ) : null}
          {onReviewScope ? (
            <Button type="button" onClick={onReviewScope}>
              {t("pages.assessmentFlow.multiRepository.reviewTitle")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {submitError ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {t("pages.assessmentFlow.errors.repositorySetup")}
        </p>
      ) : null}
      {editorOpen ? (
        <form
          className="mt-3 grid gap-2 rounded-md border p-3"
          onSubmit={submit}
          aria-label={t("pages.assessmentFlow.multiRepository.editorLabel")}
        >
          <label>
            {t("pages.assessmentFlow.multiRepository.from")}
            <select
              className="mt-1 w-full rounded-md border bg-background p-2"
              {...form.register("fromSnapshotId")}
            >
              {pinnableRepositories.map((repo) => (
                <option key={repo.snapshot!.id} value={repo.snapshot!.id}>
                  {repo.repositoryFullName}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("pages.assessmentFlow.multiRepository.type")}
            <select
              className="mt-1 w-full rounded-md border bg-background p-2"
              {...form.register("type")}
            >
              {Object.values(ASSESSMENT_REPOSITORY_RELATION_TYPES).map(
                (type) => (
                  <option key={type} value={type}>
                    {relationTypeLabel(type)}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            {t("pages.assessmentFlow.multiRepository.to")}
            <select
              className="mt-1 w-full rounded-md border bg-background p-2"
              {...form.register("toSnapshotId")}
            >
              {pinnableRepositories.map((repo) => (
                <option key={repo.snapshot!.id} value={repo.snapshot!.id}>
                  {repo.repositoryFullName}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <Button type="submit">
              {t("pages.assessmentFlow.multiRepository.save")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEditing(null);
                setEditorOpen(false);
                form.reset();
              }}
            >
              {t("pages.assessmentFlow.multiRepository.cancel")}
            </Button>
            {editing ? (
              <Button
                type="button"
                variant="destructive"
                onClick={async () => {
                  await removeAssessmentRepositoryRelation(
                    assessmentId,
                    editing.id,
                  );
                  setEditing(null);
                  setEditorOpen(false);
                  onChanged();
                }}
              >
                {t("pages.assessmentFlow.multiRepository.remove")}
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
    </AgentTurn>
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}

function formatProvider(provider: string) {
  const key =
    provider === ASSESSMENT_REPOSITORY_PROVIDERS.github
      ? "github"
      : provider === ASSESSMENT_REPOSITORY_PROVIDERS.gitlab
        ? "gitlab"
        : provider === ASSESSMENT_REPOSITORY_PROVIDERS.bitbucket
          ? "bitbucket"
          : "azureDevOps";
  return t(`pages.assessmentFlow.providers.${key}`);
}

function relationTypeLabel(type: AssessmentRepositoryRelationType) {
  const key =
    type === ASSESSMENT_REPOSITORY_RELATION_TYPES.runtimeApiInteraction
      ? "runtimeApiInteraction"
      : type === ASSESSMENT_REPOSITORY_RELATION_TYPES.buildPackageDependency
        ? "buildPackageDependency"
        : type === ASSESSMENT_REPOSITORY_RELATION_TYPES.dataEventFlow
          ? "dataEventFlow"
          : "sharedLibrary";
  return t(`pages.assessmentFlow.multiRepository.relationTypes.${key}`);
}

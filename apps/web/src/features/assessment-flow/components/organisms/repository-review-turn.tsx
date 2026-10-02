"use client";

import {
  ASSESSMENT_REPOSITORY_PROVIDERS,
  ASSESSMENT_REPOSITORY_RELATION_TYPES,
  type AssessmentRepositoryRelationType,
  type AssessmentRepositorySetupRepository,
} from "@lcsp/contracts/assessment";
import { resolveMessage } from "@lcsp/i18n";

import { Button } from "@/components/ui/button";
import {
  AgentMessage,
  AgentTurn,
  ThoughtLine,
} from "@/features/workspace/components/molecules/agent-turn";
import { appLocale } from "@/lib/locale";

type ReviewRelation = {
  id: string;
  fromSnapshotId: string;
  toSnapshotId: string;
  type: AssessmentRepositoryRelationType;
};

export function RepositoryReviewTurn({
  repositories,
  relations,
  confirming,
  onConfirm,
  onBack,
  onEditMap,
  onAddRepository,
}: {
  repositories: AssessmentRepositorySetupRepository[];
  relations: ReviewRelation[];
  confirming?: boolean;
  onConfirm: () => void;
  onBack: () => void;
  onEditMap?: () => void;
  onAddRepository?: () => void;
}) {
  const repositoryBySnapshot = new Map(
    repositories
      .filter((repository) => repository.snapshot)
      .map((repository) => [repository.snapshot!.id, repository]),
  );

  return (
    <AgentTurn>
      <AgentMessage>
        <ThoughtLine
          label={t("pages.assessmentFlow.multiRepository.thought")}
        />
        <h2 className="mt-2 text-sm font-semibold">
          {t("pages.assessmentFlow.multiRepository.reviewTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("pages.assessmentFlow.multiRepository.reviewDescription")}
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
              <th scope="col" className="p-2">
                {t("pages.assessmentFlow.multiRepository.repository")}
              </th>
              <th scope="col" className="p-2">
                {t("pages.assessmentFlow.multiRepository.relations")} &middot;{" "}
                {t(
                  "pages.assessmentFlow.multiRepository.relationCount",
                ).replace("{count}", String(relations.length))}
              </th>
            </tr>
          </thead>
          <tbody>
            {repositories.map((repository) => {
              const snapshotId = repository.snapshot?.id;
              const repositoryRelations = relations.filter(
                (relation) =>
                  relation.fromSnapshotId === snapshotId ||
                  relation.toSnapshotId === snapshotId,
              );
              return (
                <tr
                  key={repository.connectionId}
                  className="border-b last:border-0"
                >
                  <th scope="row" className="p-2 align-top font-medium">
                    <span className="block">
                      {repository.repositoryFullName}
                    </span>
                    <span className="mt-1 block font-normal text-muted-foreground">
                      {t("pages.assessmentFlow.multiRepository.pinnedRevision")
                        .replace(
                          "{provider}",
                          formatProvider(repository.provider),
                        )
                        .replace(
                          "{branch}",
                          repository.snapshot?.branch ??
                            repository.defaultBranch,
                        )
                        .replace(
                          "{commit}",
                          repository.snapshot?.commitSha.slice(0, 12) ??
                            t("pages.assessmentFlow.repository.pending"),
                        )}
                    </span>
                  </th>
                  <td className="p-2 align-top text-muted-foreground">
                    {repositoryRelations.length === 0
                      ? t("pages.assessmentFlow.multiRepository.noRelation")
                      : repositoryRelations.map((relation) => {
                          const from = repositoryBySnapshot.get(
                            relation.fromSnapshotId,
                          );
                          const to = repositoryBySnapshot.get(
                            relation.toSnapshotId,
                          );
                          return (
                            <span className="mb-1 block" key={relation.id}>
                              {from?.repositoryFullName ??
                                relation.fromSnapshotId}{" "}
                              &rarr;{" "}
                              {to?.repositoryFullName ?? relation.toSnapshotId}{" "}
                              &middot; {relationTypeLabel(relation.type)}
                            </span>
                          );
                        })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        {t("pages.assessmentFlow.multiRepository.relationCount").replace(
          "{count}",
          String(relations.length),
        )}
      </p>
      {relations.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("pages.assessmentFlow.multiRepository.independentState")}
        </p>
      ) : null}

      {relations.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {relations.map((relation) => {
            const from = repositoryBySnapshot.get(relation.fromSnapshotId);
            const to = repositoryBySnapshot.get(relation.toSnapshotId);
            return (
              <li key={relation.id}>
                {from?.repositoryFullName ?? relation.fromSnapshotId} &rarr;{" "}
                {to?.repositoryFullName ?? relation.toSnapshotId} &middot;{" "}
                {relationTypeLabel(relation.type)}
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" disabled={confirming} onClick={onConfirm}>
          {t(
            confirming
              ? "pages.assessmentFlow.multiRepository.confirmingScope"
              : "pages.assessmentFlow.multiRepository.confirmScope",
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={confirming}
          onClick={onBack}
        >
          {t("pages.assessmentFlow.multiRepository.backToSetup")}
        </Button>
        {onEditMap ? (
          <Button
            type="button"
            variant="outline"
            disabled={confirming}
            onClick={onEditMap}
          >
            {t("pages.assessmentFlow.multiRepository.edit")}
          </Button>
        ) : null}
        {onAddRepository ? (
          <Button
            type="button"
            variant="outline"
            disabled={confirming}
            onClick={onAddRepository}
          >
            {t("pages.assessmentFlow.multiRepository.addRepository")}
          </Button>
        ) : null}
      </div>
    </AgentTurn>
  );
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

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}

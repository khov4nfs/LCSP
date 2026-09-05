import type { ArtifactGroup } from "../types/artifact.types";

export function filterArtifactGroups(groups: ArtifactGroup[], query: string): ArtifactGroup[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return groups;
  return groups
    .map((group) => ({
      ...group,
      artifacts: group.artifacts.filter((artifact) =>
        [artifact.title, artifact.context, group.title, group.context, group.updatedAt]
          .filter(Boolean)
          .some((value) => value!.toLocaleLowerCase().includes(normalized)),
      ),
    }))
    .filter((group) => group.title.toLocaleLowerCase().includes(normalized) || group.artifacts.length > 0);
}

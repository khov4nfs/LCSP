import { z } from "zod";

import { ASSESSMENT_REPOSITORY_RELATION_TYPES } from "@lcsp/contracts/assessment";

export const repositoryRelationSchema = z
  .object({
    fromSnapshotId: z.string().min(1),
    toSnapshotId: z.string().min(1),
    type: z.enum([
      ASSESSMENT_REPOSITORY_RELATION_TYPES.runtimeApiInteraction,
      ASSESSMENT_REPOSITORY_RELATION_TYPES.buildPackageDependency,
      ASSESSMENT_REPOSITORY_RELATION_TYPES.dataEventFlow,
      ASSESSMENT_REPOSITORY_RELATION_TYPES.sharedLibrary,
    ]),
  })
  .refine((value) => value.fromSnapshotId !== value.toSnapshotId, {
    path: ["toSnapshotId"],
    message: "repository-relation-self-reference",
  });

export type RepositoryRelationFormValues = z.infer<
  typeof repositoryRelationSchema
>;

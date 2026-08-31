import { z } from "zod";

export const repositoryConnectionSchema = z.object({
  repositoryUrl: z
    .string()
    .trim()
    .min(1, "pages.readiness.repository.urlRequired")
    .url("pages.readiness.repository.urlInvalid"),
});

export type RepositoryConnectionValues = z.infer<
  typeof repositoryConnectionSchema
>;

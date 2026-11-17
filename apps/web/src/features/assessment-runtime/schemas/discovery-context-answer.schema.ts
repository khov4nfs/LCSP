import { z } from "zod";

export const discoveryContextAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(2_000),
});

export type DiscoveryContextAnswer = z.infer<
  typeof discoveryContextAnswerSchema
>;

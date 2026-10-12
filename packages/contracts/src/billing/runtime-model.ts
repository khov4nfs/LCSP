import { z } from "zod";

/** Provider-neutral effective model selected by the runtime policy. */
export const effectiveRuntimeModelSchema = z.object({
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1),
  policyVersion: z.string().trim().min(1),
  effectiveAt: z.iso.datetime(),
});

export type EffectiveRuntimeModel = z.infer<typeof effectiveRuntimeModelSchema>;

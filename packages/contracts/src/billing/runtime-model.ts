/** Provider-neutral effective model selected by the runtime policy. */
export type EffectiveRuntimeModel = {
  provider: string;
  model: string;
  policyVersion: string;
  effectiveAt: string;
};

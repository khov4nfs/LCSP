import { z } from "zod";
import { LEGAL_REFERENCE_RESOLUTION_STATES } from "../legal-source/document-graph.ts";
import {
  LEGAL_SEMANTIC_CLAIM_TYPES,
  LEGAL_SEMANTIC_RELATION_KINDS,
} from "./semantic-graph.ts";
import {
  LEGAL_ASSESSABILITIES,
  LEGAL_SEMANTIC_AUTHORITIES,
  SEMANTIC_RELATION_CONTRACTS,
  legalEffectSchema,
} from "./semantic-support.ts";

const text = z.string().min(1).regex(/\S/);
const frameText = z.string().min(1).max(8000).nullable();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const relationKind = z
  .enum(LEGAL_SEMANTIC_RELATION_KINDS)
  .extract(
    Object.keys(
      SEMANTIC_RELATION_CONTRACTS,
    ) as (keyof typeof SEMANTIC_RELATION_CONTRACTS)[],
  );
const binding = z.strictObject({ from: text, to: text, kind: relationKind });

/** File syntax only. Coverage, identity, quote resolution and semantic review remain governed gates. */
export const claimFileSchema = z.strictObject({
  article: text,
  claims: z.array(
    z.strictObject({
      key: z
        .string()
        .min(1)
        .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
      type: z.enum(LEGAL_SEMANTIC_CLAIM_TYPES),
      statement: z.string().min(1).max(8000),
      // Mechanical fields default when omitted: actor/action null, frame {}, relevant true, relations [].
      actor: text.nullable().optional(),
      action: text.nullable().optional(),
      authority: z.enum(LEGAL_SEMANTIC_AUTHORITIES),
      assessability: z.enum(LEGAL_ASSESSABILITIES),
      // Partial source-supported dimensions; runtime fills omitted dimensions with null.
      frame: z
        .strictObject({
          object: frameText,
          beneficiary: frameText,
          trigger: frameText,
          scope: frameText,
          qualifier: frameText,
          exception: frameText,
          temporalApplicability: frameText,
          repositoryObservableAspect: frameText,
          externalFulfillmentAspect: frameText,
          // Cross-field effect validity is checked by the governed compiler, beyond file syntax.
          legalEffect: z.strictObject({
            ...legalEffectSchema.shape,
            conditions: frameText,
            unresolvedTargets: z
              .array(
                z.strictObject({
                  documentIdentifier: z.string().min(1).max(500),
                  locator: z.string().min(1).max(500),
                  reason: z.string().min(1).max(8000),
                }),
              )
              .max(128),
          }),
        })
        .partial()
        .nullable()
        .optional(),
      relevant: z.boolean().optional(),
      nonOperativeReason: text.nullable().optional(),
      support: z
        .array(z.strictObject({ locator: text, quote: text }))
        .min(1)
        .max(64),
      relations: z
        .array(
          z.strictObject({
            kind: relationKind,
            to: text,
            referenceId: hash.optional(),
          }),
        )
        .optional(),
    }),
  ),
  noClaims: z.record(z.string(), text).optional(),
  references: z
    .record(
      hash,
      z.union([
        z.strictObject({ material: z.literal(false), reason: text }),
        z.strictObject({
          material: z.literal(LEGAL_REFERENCE_RESOLUTION_STATES.UNRESOLVED),
          reason: text,
        }),
        z.strictObject({ material: z.literal(true), binding }),
      ]),
    )
    .optional(),
});

export type ClaimFile = z.infer<typeof claimFileSchema>;
export const claimFileJsonSchema = z.toJSONSchema(claimFileSchema, {
  target: "draft-7",
  io: "input",
});

import { z } from "zod";

export const DISCOVERY_INTERVIEW_PROPOSAL_STATUSES = {
  pendingReview: "PENDING_REVIEW",
  accepted: "ACCEPTED",
  rejected: "REJECTED",
} as const;

export const DISCOVERY_INTERVIEW_REVIEW_ACTIONS = {
  accept: "ACCEPT",
  reject: "REJECT",
} as const;

export const submitDiscoveryInterviewAnswerSchema = z.strictObject({
  idempotencyKey: z.uuid(),
  useCaseId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  question: z.string().trim().min(1).max(1000),
  answer: z.string().trim().min(1).max(2000),
});
export type SubmitDiscoveryInterviewAnswer = z.infer<
  typeof submitDiscoveryInterviewAnswerSchema
>;

export const reviewDiscoveryInterviewAnswerSchema = z.strictObject({
  action: z.enum(DISCOVERY_INTERVIEW_REVIEW_ACTIONS),
  expectedCaseRevision: z.number().int().nonnegative(),
});
export type ReviewDiscoveryInterviewAnswer = z.infer<
  typeof reviewDiscoveryInterviewAnswerSchema
>;

export const discoveryInterviewProposalSchema = z.strictObject({
  proposalId: z.uuid(),
  assessmentId: z.uuid(),
  discoveryRunId: z.uuid(),
  factNeedId: z.uuid(),
  useCaseId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  question: z.string().min(1).max(1000),
  answer: z.string().min(1).max(2000),
  status: z.enum(DISCOVERY_INTERVIEW_PROPOSAL_STATUSES),
  guardFailure: z.string().nullable(),
  caseRevision: z.number().int().nonnegative(),
  acceptedFactId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  reviewedAt: z.iso.datetime().nullable(),
});
export type DiscoveryInterviewProposal = z.infer<
  typeof discoveryInterviewProposalSchema
>;

export const discoveryInterviewPageSchema = z.strictObject({
  caseRevision: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(100),
  nextOffset: z.number().int().nonnegative().nullable(),
  items: z.array(discoveryInterviewProposalSchema).max(100),
});
export type DiscoveryInterviewPage = z.infer<
  typeof discoveryInterviewPageSchema
>;

export const discoveryInterviewPageQuerySchema = z.strictObject({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

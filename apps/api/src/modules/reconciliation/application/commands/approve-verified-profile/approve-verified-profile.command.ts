export class ApproveVerifiedProfileCommand {
  constructor(
    readonly assessmentId: string,
    readonly verifiedProfileId: string,
    readonly organizationId: string,
    readonly approvedById: string,
    readonly subjectRole: string,
    readonly correlationId: string,
    readonly authorization: {
      selectedAction: string | null;
      policyId: string | null;
      policyVersion: string | null;
    },
  ) {}
}

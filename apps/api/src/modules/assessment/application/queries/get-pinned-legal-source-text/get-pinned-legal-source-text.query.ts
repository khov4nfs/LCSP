import type { PinnedLegalSourceText } from "@lcsp/contracts/assessment-domain";
import { Query } from "@nestjs/cqrs";

export class GetPinnedLegalSourceTextQuery extends Query<PinnedLegalSourceText> {
  constructor(
    public readonly assessmentId: string,
    public readonly leaseToken: string,
    public readonly documentId: string,
    public readonly locator: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}

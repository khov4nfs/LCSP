import type { PinnedLegalSourceSearchResult } from "@lcsp/contracts/assessment-domain";
import { Query } from "@nestjs/cqrs";

export class SearchPinnedLegalSourceQuery extends Query<PinnedLegalSourceSearchResult> {
  constructor(
    public readonly assessmentId: string,
    public readonly leaseToken: string,
    public readonly text: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}

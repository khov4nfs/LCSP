import { Query } from "@nestjs/cqrs";

export class ListBillingHistoryQuery extends Query<unknown> {
  constructor(
    public readonly userId: string,
    public readonly page: number,
    public readonly pageSize: number,
    public readonly audit: { correlationId: string; sessionId?: string },
  ) {
    super();
  }
}

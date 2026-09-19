import { Query } from "@nestjs/cqrs";

export class GetBillingOrderQuery extends Query<unknown> {
  constructor(
    public readonly userId: string,
    public readonly orderId: string,
    public readonly audit: { correlationId: string; sessionId?: string },
  ) {
    super();
  }
}

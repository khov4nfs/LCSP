export class ListVerifiedProfilesQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly correlationId: string,
  ) {}
}

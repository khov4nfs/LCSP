export class GetAdminUserDetailQuery {
  constructor(
    public readonly id: string,
    public readonly correlationId: string,
  ) {}
}

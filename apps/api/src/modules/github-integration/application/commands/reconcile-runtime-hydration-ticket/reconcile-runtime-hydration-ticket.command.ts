export class ReconcileRuntimeHydrationTicketCommand {
  constructor(
    public readonly ticketId: string,
    public readonly snapshotId: string,
  ) {}
}

import { Command } from "@nestjs/cqrs";

export type QuiesceLegacyRuntimeResult = {
  cancelled: number;
  byEventType: Record<string, number>;
};

/** Stops V1 message delivery: cancels (and archives) undelivered retired V1 commands and events. */
export class QuiesceLegacyRuntimeCommand extends Command<QuiesceLegacyRuntimeResult> {
  constructor(
    public readonly runId: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}

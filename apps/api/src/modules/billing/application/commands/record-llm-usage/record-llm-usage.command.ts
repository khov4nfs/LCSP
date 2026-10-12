import { Command } from "@nestjs/cqrs";
import type { LlmUsageRecordInput } from "../billing-usage.types.js";

export class RecordLlmUsageCommand extends Command<unknown> {
  constructor(public readonly input: LlmUsageRecordInput) {
    super();
  }
}

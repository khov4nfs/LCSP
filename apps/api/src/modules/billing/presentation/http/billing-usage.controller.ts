import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { WorkerApiKeyGuard } from "../../../scan/presentation/http/worker-api-key.guard.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { BillingDomainError } from "../../domain/billing.errors.js";
import { ClaimBillingInvocationCommand } from "../../application/commands/claim-billing-invocation/claim-billing-invocation.command.js";
import { ReleaseBillingReservationCommand } from "../../application/commands/release-billing-reservation/release-billing-reservation.command.js";
import { ReserveBillingCreditsCommand } from "../../application/commands/reserve-billing-credits/reserve-billing-credits.command.js";
import { SettleBillingUsageCommand } from "../../application/commands/settle-billing-usage/settle-billing-usage.command.js";
import { ResolveBillingAssessmentOwnerQuery } from "../../application/queries/resolve-billing-assessment-owner/resolve-billing-assessment-owner.query.js";
import {
  projectReservation,
  serializeBillingData,
} from "./mappers/billing-http.response.mapper.js";
import {
  toClaimInput,
  toReleaseInput,
  toReservationInput,
  toSettlementInput,
} from "./mappers/billing-usage.request.mapper.js";
import { mapUsageError } from "./errors/billing-http.error-mapper.js";

@Controller("internal/billing")
export class BillingUsageController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post("reservations")
  @UseGuards(WorkerApiKeyGuard)
  async reserve(@Body() body: Record<string, unknown>) {
    try {
      const result = await this.commandBus.execute(
        new ReserveBillingCreditsCommand(toReservationInput(body)),
      );
      return resultEnvelope(serializeBillingData(projectReservation(result)));
    } catch (error) {
      throw mapUsageError(error);
    }
  }

  @Post("reservations/:reservationId/release")
  @UseGuards(WorkerApiKeyGuard)
  async release(
    @Param("reservationId") reservationId: string,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      const result = await this.commandBus.execute(
        new ReleaseBillingReservationCommand(
          toReleaseInput(reservationId, body),
        ),
      );
      return resultEnvelope(serializeBillingData(projectReservation(result)));
    } catch (error) {
      throw mapUsageError(error);
    }
  }

  @Post("reservations/:reservationId/claim")
  @UseGuards(WorkerApiKeyGuard)
  async claim(
    @Param("reservationId") reservationId: string,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      const result = await this.commandBus.execute(
        new ClaimBillingInvocationCommand(toClaimInput(reservationId, body)),
      );
      return resultEnvelope(serializeBillingData(result));
    } catch (error) {
      throw mapUsageError(error);
    }
  }

  @Post("usage")
  @UseGuards(WorkerApiKeyGuard)
  async settle(@Body() body: Record<string, unknown>) {
    try {
      const assessmentId =
        typeof body.assessmentId === "string" ? body.assessmentId.trim() : "";
      if (!assessmentId)
        throw new BillingDomainError("usage identity is required");
      const userId = await this.queryBus.execute(
        new ResolveBillingAssessmentOwnerQuery(assessmentId),
      );
      const result = await this.commandBus.execute(
        new SettleBillingUsageCommand(toSettlementInput(body, userId)),
      );
      return resultEnvelope(serializeBillingData(result));
    } catch (error) {
      throw mapUsageError(error);
    }
  }
}

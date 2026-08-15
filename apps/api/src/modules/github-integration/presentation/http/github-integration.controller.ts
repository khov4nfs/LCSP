import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";
import type { Response } from "express";

import { createCorrelationId } from "../../../auth-workspace/infrastructure/security/security.utils.js";
import { RequireAction } from "../../../../platform/pbac/decorators/require-action.decorator.js";
import type { PbacRequestContext } from "../../../../platform/pbac/interfaces/pbac-request.interface.js";
import { PbacGuard } from "../../../../platform/pbac/pbac.guard.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { ReAuthForSensitiveRoute } from "../../../../platform/security/decorators/re-auth-for-sensitive-route.decorator.js";
import { SENSITIVE_ROUTE_IDS } from "../../../../platform/security/sensitive-route-policy.js";
import { GitHubAppCallbackCommand } from "../../application/commands/github-app-callback/github-app-callback.command.js";
import { GitHubAppStartCommand } from "../../application/commands/github-app-start/github-app-start.command.js";
import { PinSnapshotCommand } from "../../application/commands/pin-snapshot/pin-snapshot.command.js";
import { TriggerScanCommand } from "../../application/commands/trigger-scan/trigger-scan.command.js";
import type { PinSnapshotDto } from "../../application/contracts/github-integration/pin-snapshot.contract.js";
import type { TriggerScanDto } from "../../application/contracts/github-integration/trigger-scan.contract.js";
import { PinSnapshotRequest } from "./dto/pin-snapshot.request.js";
import { TriggerScanRequest } from "./dto/trigger-scan.request.js";
import {
  ScanTriggerGuard,
  type ScanTriggerRequestContext,
} from "./scan-trigger.guard.js";

interface GitHubIntegrationRequest extends ScanTriggerRequestContext {
  pbacContext?: PbacRequestContext;
  correlationId?: string;
}

/**
 * Exposes GitHub App connection, repository snapshot pinning, and scan-trigger HTTP operations.
 */
@Controller()
export class GitHubIntegrationController {
  /**
   * Creates the controller with the CQRS command dispatcher used by all GitHub integration mutations.
   *
   * @param commandBus - Command bus used to start/complete App installation, pin snapshots, and trigger scans.
   */
  constructor(private readonly commandBus: CommandBus) {}

  /**
   * Starts or resumes the sensitive GitHub App installation flow for the authenticated organization/user.
   *
   * @param redirectUri - Allowlisted client redirect URI to restore after GitHub callback.
   * @param assessmentId - Optional assessment to bind to the resulting repository connection.
   * @param installationId - Optional existing installation identifier for reconnect/resume flows.
   * @param request - PBAC-authenticated request containing tenant, user, session, and correlation context.
   * @returns Standard result envelope containing the GitHub installation URL.
   */
  @Get("github/app/start")
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.githubConnect)
  @ReAuthForSensitiveRoute({
    routeId: SENSITIVE_ROUTE_IDS.githubAppStart,
    method: "GET",
    pathTemplate: "/github/app/start",
    aliases: [{ method: "GET", pathTemplate: "/api/github/app/start" }],
  })
  async startAppInstallation(
    @Query("redirect_uri") redirectUri: string | undefined,
    @Query("assessment_id") assessmentId: string | undefined,
    @Query("installation_id") installationId: string | undefined,
    @Req() request: GitHubIntegrationRequest,
  ) {
    const pbacContext = request.pbacContext as PbacRequestContext;

    return resultEnvelope(
      await this.commandBus.execute(
        new GitHubAppStartCommand(
          pbacContext.organizationId,
          pbacContext.userId,
          redirectUri,
          assessmentId,
          request.correlationId as string,
          pbacContext.sessionId,
          installationId,
        ),
      ),
    );
  }

  /**
   * Completes the public GitHub App callback using the opaque state created by the installation-start flow.
   *
   * @param installationId - GitHub App installation identifier returned by GitHub.
   * @param code - GitHub callback authorization code.
   * @param state - Opaque installation state binding the callback to the original request.
   * @param repositoryId - Optional repository selected during the installation flow.
   * @param correlationId - Optional upstream correlation identifier; generated when absent.
   * @returns Standard result envelope containing the established repository connection.
   */
  @Get("github/app/callback")
  async handleAppCallback(
    @Query("installation_id") installationId: string,
    @Query("code") code: string,
    @Query("state") state: string,
    @Query("repository_id") repositoryId: string | undefined,
    @Headers("x-correlation-id") correlationId: string | undefined,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new GitHubAppCallbackCommand(
          installationId,
          code,
          state,
          correlationId ?? createCorrelationId(),
          repositoryId,
        ),
      ),
    );
  }

  /**
   * Pins an exact immutable GitHub commit as an assessment repository snapshot.
   *
   * @param assessmentId - Assessment that will own the snapshot.
   * @param body - Repository connection plus optional branch/ref/commit selectors.
   * @param request - PBAC-authenticated request containing actor, tenant, scope, and correlation context.
   * @returns Standard result envelope containing persisted snapshot metadata.
   */
  @Post("assessments/:assessmentId/snapshots")
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.snapshotCreate)
  async pinSnapshot(
    @Param("assessmentId") assessmentId: string,
    @Body() body: PinSnapshotRequest,
    @Req() request: GitHubIntegrationRequest,
  ) {
    const context = request.pbacContext as PbacRequestContext;
    return resultEnvelope(
      await this.commandBus.execute<PinSnapshotCommand, PinSnapshotDto>(
        new PinSnapshotCommand(
          assessmentId,
          context.organizationId,
          context.userId,
          context.subjectRole,
          context.scope ?? undefined,
          body.connection_id,
          body.branch,
          body.ref,
          body.commit_sha,
          request.correlationId as string,
        ),
      ),
    );
  }

  /**
   * Triggers a repository scan either from a trusted worker key or a manually PBAC-authorized user request.
   *
   * @param assessmentId - Assessment whose pinned snapshot should be scanned.
   * @param body - Snapshot identifier, idempotency key, and optional requested trigger source.
   * @param request - Guard-enriched request containing trusted/manual source and optional PBAC context.
   * @param response - Express response used to distinguish newly created jobs (201) from idempotent duplicates (200).
   * @returns Standard result envelope containing scan-job trigger metadata.
   */
  @Post("assessments/:assessmentId/scan-jobs")
  @UseGuards(ScanTriggerGuard)
  @RequireAction(PBAC_ACTIONS.scanTrigger)
  async triggerScan(
    @Param("assessmentId") assessmentId: string,
    @Body() body: TriggerScanRequest,
    @Req() request: GitHubIntegrationRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const context = request.pbacContext;
    const result = await this.commandBus.execute<
      TriggerScanCommand,
      TriggerScanDto
    >(
      new TriggerScanCommand(
        assessmentId,
        body.snapshot_id,
        request.scanTriggerSource as TriggerScanCommand["triggerSource"],
        body.idempotency_key,
        context?.userId ?? null,
        context?.organizationId ?? null,
        context?.subjectRole ?? null,
        context?.scope ?? undefined,
        request.correlationId ?? createCorrelationId(),
      ),
    );
    response.status(result.is_new ? 201 : 200);
    return resultEnvelope(result);
  }
}

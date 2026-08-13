import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { problemException } from "../../../../../platform/problems/problem-factory.js";
import {
  formatOrchestrationRuntimeLog,
  ORCHESTRATION_RUNTIME_LOG_EVENTS,
  sanitizeOrchestrationLogValue,
} from "../../../../../platform/logging/orchestration-runtime-log.js";
import type { AppConfig } from "../../../../../config/config.types.js";

const WORKER_RUNTIME_ERROR_CODE = "PYTHON_WORKER_RUNTIME_UNAVAILABLE";

@Injectable()
export class PythonWorkerRuntimeClient {
  private readonly logger = new Logger(PythonWorkerRuntimeClient.name);

  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  async requestTargetedReanalysis(
    payload: Record<string, unknown>,
    correlationId: string,
  ): Promise<Record<string, unknown>> {
    return this.post(
      "/runtime/commands/request-targeted-reanalysis",
      payload,
      correlationId,
    );
  }

  async resumeWaitingRuns(
    payload: Record<string, unknown>,
    correlationId: string,
  ): Promise<Record<string, unknown>> {
    return this.post(
      "/runtime/commands/legal-corpus/resume-waiting-runs",
      payload,
      correlationId,
    );
  }

  private async post(
    path: string,
    payload: Record<string, unknown>,
    correlationId: string,
  ): Promise<Record<string, unknown>> {
    const baseUrl = this.configService.get("pythonWorker.baseUrl", {
      infer: true,
    });
    const apiKey = this.configService.get("worker.apiKey", { infer: true });
    const url = `${baseUrl}${path}`;

    const orchestrationDebug = this.configService.get("orchestration.debug", {
      infer: true,
    });
    if (orchestrationDebug) {
      this.logger.debug(
        formatOrchestrationRuntimeLog(
          ORCHESTRATION_RUNTIME_LOG_EVENTS.workerRequest,
          {
            correlationId,
            assessmentId:
              typeof payload.assessmentId === "string"
                ? payload.assessmentId
                : null,
            organizationId:
              typeof payload.organizationId === "string"
                ? payload.organizationId
                : null,
            path,
            payload: sanitizeOrchestrationLogValue(payload),
          },
        ),
      );
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Worker-Api-Key": apiKey,
          "X-Correlation-Id": correlationId,
        },
        body: JSON.stringify(payload),
      });
    } catch {
      this.logger.error(
        formatOrchestrationRuntimeLog(
          ORCHESTRATION_RUNTIME_LOG_EVENTS.workerUnreachable,
          {
            correlationId,
            assessmentId:
              typeof payload.assessmentId === "string"
                ? payload.assessmentId
                : null,
            organizationId:
              typeof payload.organizationId === "string"
                ? payload.organizationId
                : null,
            path,
          },
        ),
      );
      throw problemException(WORKER_RUNTIME_ERROR_CODE, correlationId, {
        status: HttpStatus.BAD_GATEWAY,
      });
    }

    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok || !isRecord(data)) {
      this.logger.error(
        formatOrchestrationRuntimeLog(
          ORCHESTRATION_RUNTIME_LOG_EVENTS.workerBadResponse,
          {
            correlationId,
            assessmentId:
              typeof payload.assessmentId === "string"
                ? payload.assessmentId
                : null,
            organizationId:
              typeof payload.organizationId === "string"
                ? payload.organizationId
                : null,
            path,
            status: response.status,
          },
        ),
      );
      throw problemException(WORKER_RUNTIME_ERROR_CODE, correlationId, {
        status: HttpStatus.BAD_GATEWAY,
      });
    }

    if (orchestrationDebug) {
      this.logger.debug(
        formatOrchestrationRuntimeLog(
          ORCHESTRATION_RUNTIME_LOG_EVENTS.workerResponse,
          {
            correlationId,
            assessmentId:
              typeof payload.assessmentId === "string"
                ? payload.assessmentId
                : null,
            organizationId:
              typeof payload.organizationId === "string"
                ? payload.organizationId
                : null,
            path,
            status: response.status,
            payload: sanitizeOrchestrationLogValue(data),
          },
        ),
      );
    }

    return data;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

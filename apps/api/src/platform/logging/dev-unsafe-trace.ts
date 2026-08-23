import * as fs from "node:fs";
import * as path from "node:path";
import { getLoggingContext, getRepoRoot } from "./logging-context.js";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

/**
 * Returns whether explicitly unsafe, fully unredacted development tracing is enabled.
 *
 * This mode is intentionally restricted to non-production runtimes because trace
 * records can contain Authorization headers, session cookies, worker credentials,
 * source code, prompts, model output, idempotency keys, and other sensitive data.
 *
 * @throws Error when unsafe tracing is requested while NODE_ENV=production.
 */
export function unsafeDevTraceEnabled(): boolean {
  const enabled = TRUE_VALUES.has(
    (process.env.LCSP_DEV_UNSAFE_TRACE ?? "").trim().toLowerCase(),
  );
  if (!enabled) {
    return false;
  }
  if ((process.env.NODE_ENV ?? "").trim().toLowerCase() === "production") {
    throw new Error(
      "LCSP_DEV_UNSAFE_TRACE must never be enabled with NODE_ENV=production",
    );
  }
  return true;
}

/**
 * Returns whether unfiltered, fully raw development tracing is enabled.
 *
 * Gated behind LCSP_DEV_UNSAFE_UNFILTERED. Must never be enabled in production.
 */
export function unsafeDevUnfilteredEnabled(): boolean {
  const enabled = TRUE_VALUES.has(
    (process.env.LCSP_DEV_UNSAFE_UNFILTERED ?? "").trim().toLowerCase(),
  );
  if (!enabled) {
    return false;
  }
  if ((process.env.NODE_ENV ?? "").trim().toLowerCase() === "production") {
    throw new Error(
      "LCSP_DEV_UNSAFE_UNFILTERED must never be enabled with NODE_ENV=production",
    );
  }
  return true;
}

/**
 * Emits one JSON-line diagnostic record to stderr in dev mode.
 * Summarized by default, or fully raw if LCSP_DEV_UNSAFE_UNFILTERED is active.
 *
 * @param event - Stable diagnostic event name.
 * @param fields - Exact diagnostic values to serialize.
 */
export function emitDevUnsafeTrace(
  event: string,
  fields: Record<string, unknown> = {},
): void {
  if (!unsafeDevTraceEnabled()) {
    return;
  }

  let record: Record<string, unknown>;

  if (unsafeDevUnfilteredEnabled()) {
    record = {
      timestamp: new Date().toISOString(),
      level: "UNSAFE_DEV_TRACE",
      event,
      ...fields,
    };
  } else {
    const summarizedEvent = event.endsWith("_RAW") ? event.slice(0, -4) : event;
    const summarizedFields = summarizeTraceFields(event, fields);
    record = {
      timestamp: new Date().toISOString(),
      level: "UNSAFE_DEV_TRACE",
      event: summarizedEvent,
      ...summarizedFields,
    };
  }

  try {
    const stringified = `${safeStringify(record)}\n`;
    process.stderr.write(stringified);

    const { userId, assessmentId } = getLoggingContext();
    let finalUserId = userId;
    let finalAssessmentId = assessmentId;
    if (fields) {
      const fieldUserId = findIdRecursive(
        fields,
        new Set(["user_id", "userId", "actor_id", "actorId"]),
      );
      if (fieldUserId) finalUserId = String(fieldUserId);
      const fieldAssessmentId = findIdRecursive(
        fields,
        new Set(["assessment_id", "assessmentId"]),
      );
      if (fieldAssessmentId) finalAssessmentId = String(fieldAssessmentId);
    }
    const repoRoot = getRepoRoot();
    const logDir = path.join(
      repoRoot,
      "tmp",
      `user_${finalUserId}`,
      `assessment_${finalAssessmentId}`,
    );
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(
      path.join(logDir, "orchestration.log"),
      stringified,
      "utf8",
    );
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "UNSAFE_DEV_TRACE",
        event: "DEV_UNSAFE_TRACE_SERIALIZATION_ERROR",
        originalEvent: event,
        error: error instanceof Error ? error.message : String(error),
      })}\n`,
    );
  }
}

function findIdRecursive(
  data: unknown,
  keys: Set<string>,
  seen = new WeakSet<object>(),
): string | number | undefined {
  if (!data || typeof data !== "object") return undefined;
  if (seen.has(data)) return undefined;
  seen.add(data);

  if (Array.isArray(data)) {
    for (const item of data) {
      const res = findIdRecursive(item, keys, seen);
      if (res !== undefined) return res;
    }
  } else {
    const record = data as Record<string, unknown>;
    for (const k of Object.keys(record)) {
      const v = record[k];
      if (keys.has(k) && (typeof v === "string" || typeof v === "number")) {
        return v;
      }
      const res = findIdRecursive(v, keys, seen);
      if (res !== undefined) return res;
    }
  }
  return undefined;
}

function findCountRecursive(
  data: unknown,
  targetKey: string,
  seen = new WeakSet<object>(),
): number | undefined {
  if (!data || typeof data !== "object") return undefined;
  if (seen.has(data)) return undefined;
  seen.add(data);

  if (Array.isArray(data)) {
    for (const item of data) {
      const res = findCountRecursive(item, targetKey, seen);
      if (res !== undefined) return res;
    }
  } else {
    const record = data as Record<string, unknown>;
    for (const k of Object.keys(record)) {
      const v = record[k];
      if (k === targetKey) {
        if (v && typeof v === "object") {
          return Array.isArray(v) ? v.length : Object.keys(v).length;
        }
      }
      const res = findCountRecursive(v, targetKey, seen);
      if (res !== undefined) return res;
    }
  }
  return undefined;
}

function summarizeTraceFields(
  event: string,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const summary: Record<string, unknown> = {};

  const scanJobId = findIdRecursive(
    fields,
    new Set(["scan_job_id", "scanJobId"]),
  );
  const snapshotId = findIdRecursive(
    fields,
    new Set(["snapshot_id", "snapshotId"]),
  );
  const snapshotRef = findIdRecursive(
    fields,
    new Set(["snapshot_ref", "snapshotRef"]),
  );
  const corpusVersionId = findIdRecursive(
    fields,
    new Set(["corpus_version_id", "corpusVersionId"]),
  );
  const assessmentId = findIdRecursive(
    fields,
    new Set(["assessment_id", "assessmentId"]),
  );
  const workflowRunId = findIdRecursive(
    fields,
    new Set(["workflow_run_id", "workflowRunId"]),
  );

  if (scanJobId !== undefined) summary["scan_job_id"] = scanJobId;
  if (snapshotId !== undefined) summary["snapshot_id"] = snapshotId;
  if (snapshotRef !== undefined) summary["snapshot_ref"] = snapshotRef;
  if (corpusVersionId !== undefined)
    summary["corpus_version_id"] = corpusVersionId;
  if (assessmentId !== undefined) summary["assessment_id"] = assessmentId;
  if (workflowRunId !== undefined) summary["workflow_run_id"] = workflowRunId;

  let nodeCount = findCountRecursive(fields, "nodes");
  let edgeCount = findCountRecursive(fields, "edges");

  if ("node_count" in fields) nodeCount = fields["node_count"] as number;
  else if ("nodeCount" in fields) nodeCount = fields["nodeCount"] as number;

  if ("edge_count" in fields) edgeCount = fields["edge_count"] as number;
  else if ("edgeCount" in fields) edgeCount = fields["edgeCount"] as number;

  if (nodeCount !== undefined) summary["node_count"] = nodeCount;
  if (edgeCount !== undefined) summary["edge_count"] = edgeCount;

  const payloadKeys = [
    "payload",
    "body",
    "result",
    "results",
    "tool_input",
    "response",
    "params",
    "headers",
    "rawHeaders",
    "cookies",
    "signedCookies",
    "responseHeaders",
    "responseBody",
  ];

  for (const k of Object.keys(fields)) {
    const v = fields[k];

    if (payloadKeys.includes(k)) {
      let size = 0;
      if (
        k === "body" &&
        fields.headers &&
        typeof fields.headers === "object"
      ) {
        const headers = fields.headers as Record<string, unknown>;
        const contentLength =
          headers["content-length"] ?? headers["Content-Length"];
        if (
          typeof contentLength === "string" ||
          typeof contentLength === "number"
        ) {
          size = parseInt(String(contentLength), 10) || 0;
        }
      }
      if (!size) {
        if (typeof v === "string") {
          size = v.length;
        } else if (Buffer.isBuffer(v)) {
          size = v.length;
        } else {
          try {
            size = JSON.stringify(v).length;
          } catch {
            size = String(v).length;
          }
        }
      }
      summary[`${k}_size`] = size;

      const httpEvents = [
        "DEV_API_HTTP_REQUEST_RAW",
        "DEV_API_HTTP_RESPONSE_JSON_RAW",
        "DEV_API_HTTP_RESPONSE_SEND_RAW",
        "DEV_API_HTTP_COMPLETED_RAW",
        "DEV_API_HTTP_CLOSED_EARLY_RAW",
      ];
      if (httpEvents.includes(event)) {
        const rawUrl = fields.originalUrl ?? fields.path ?? fields.url;
        const pathStr = typeof rawUrl === "string" ? rawUrl : "";
        const isTechnicalProfile = pathStr.includes(
          "technical-profile-callback",
        );
        const limit = isTechnicalProfile ? 1048576 : 52428800; // 1MB vs 50MB
        summary[`${k}_limit`] = limit;
        summary[`${k}_truncated`] = size > limit;
      }

      let count: number | undefined = undefined;
      if (v && typeof v === "object") {
        count = Array.isArray(v) ? v.length : Object.keys(v).length;
      }
      if (count !== undefined) {
        summary[`${k}_itemCount`] = count;
      }
      continue;
    }

    const safeKeys = [
      "method",
      "originalUrl",
      "url",
      "baseUrl",
      "path",
      "protocol",
      "hostname",
      "ip",
      "ips",
      "statusCode",
      "durationMs",
      "dispatcher",
      "tool_name",
      "runtime_target",
      "downstream_target",
      "worker",
      "queue_name",
      "routing_key",
      "attempts",
      "max_tool_calls",
      "operation",
      "provider",
      "model",
    ];
    if (
      safeKeys.includes(k) ||
      typeof v === "boolean" ||
      typeof v === "number" ||
      v === null
    ) {
      summary[k] = v;
    } else if (typeof v === "string" && v.length < 256) {
      summary[k] = v;
    }
  }

  return summary;
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (typeof entry === "bigint") {
      return entry.toString();
    }
    if (entry instanceof Error) {
      return {
        name: entry.name,
        message: entry.message,
        stack: entry.stack,
        ...((entry as Error & { cause?: unknown }).cause !== undefined
          ? { cause: (entry as Error & { cause?: unknown }).cause }
          : {}),
      };
    }
    if (Buffer.isBuffer(entry)) {
      return {
        encoding: "base64",
        value: entry.toString("base64"),
      };
    }
    if (entry && typeof entry === "object") {
      if (seen.has(entry)) {
        return "<cycle>";
      }
      seen.add(entry);
    }
    return entry;
  });
}

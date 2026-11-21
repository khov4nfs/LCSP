import { json, raw } from "express";
import type { RequestHandler } from "express";
import { ASSESSMENT_REPORT_V3_LIMITS } from "@lcsp/contracts/assessment-report";

const LARGE_COMPLIANCE_RULE_SET_ENDPOINTS = new Set([
  "/internal/compliance-rule-set/source-reviews",
  "/internal/compliance-rule-set/claim-inventories",
  "/internal/compliance-rule-set/validations",
  "/internal/compliance-rule-set/submissions",
]);

/**
 * Business purpose: Preserve signed raw webhook bytes and admit bounded document/report payloads.
 * Business rules: Only designated large-payload routes receive their explicit limits; other JSON remains limited to 1 MB.
 * Execution flow: 1. Select the raw or JSON parser for the endpoint. 2. Enforce its byte limit before controller validation.
 * Failure cases: Oversized bodies fail with HTTP 413; malformed JSON fails before business writes.
 * Side effects: Consumes the HTTP request body without persistence or external calls.
 */
export function httpBodyParser(): RequestHandler {
  return (req, res, next) => {
    if (req.path === "/billing/sepay/webhook") {
      (raw({ type: "application/json", limit: "256kb" }) as RequestHandler)(
        req,
        res,
        next,
      );
      return;
    }
    if (
      req.path.match(
        /^\/admin\/legal-source-versions\/[^/]+\/documents\/upload$/,
      )
    ) {
      // The upload body is the file itself; metadata travels in the query string.
      (raw({ type: () => true, limit: "26mb" }) as RequestHandler)(
        req,
        res,
        next,
      );
      return;
    }
    if (
      req.path.match(
        /^\/internal\/legal-sources\/documents\/[^/]+\/ingestion-result$/,
      )
    ) {
      (json({ limit: "50mb" }) as RequestHandler)(req, res, next);
      return;
    }
    if (LARGE_COMPLIANCE_RULE_SET_ENDPOINTS.has(req.path)) {
      // Direct draft payloads (source reviews, validations, submissions, inventories) grow with full corpus.
      (json({ limit: "50mb" }) as RequestHandler)(req, res, next);
      return;
    }
    if (
      /^\/internal\/assessment-runtime\/[^/]+\/final-report$/.test(req.path)
    ) {
      (
        json({
          limit: ASSESSMENT_REPORT_V3_LIMITS.INGRESS_JSON_BODY_LIMIT_BYTES,
        }) as RequestHandler
      )(req, res, next);
      return;
    }
    if (req.path.match(/^\/internal\/scan-jobs\/[^/]+\/callback$/)) {
      (json({ limit: "50mb" }) as RequestHandler)(req, res, next);
      return;
    }
    (json({ limit: "1mb" }) as RequestHandler)(req, res, next);
  };
}

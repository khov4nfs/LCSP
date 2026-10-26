import { json, raw } from "express";
import type { RequestHandler } from "express";

const LARGE_COMPLIANCE_RULE_SET_ENDPOINTS = new Set([
  "/internal/compliance-rule-set/source-reviews",
  "/internal/compliance-rule-set/claim-inventories",
  "/internal/compliance-rule-set/validations",
  "/internal/compliance-rule-set/submissions",
]);

/** Installs the raw SePay boundary before any JSON parser can consume its bytes. */
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
    if (req.path.match(/^\/internal\/scan-jobs\/[^/]+\/callback$/)) {
      (json({ limit: "50mb" }) as RequestHandler)(req, res, next);
      return;
    }
    (json({ limit: "1mb" }) as RequestHandler)(req, res, next);
  };
}

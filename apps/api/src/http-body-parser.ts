import { json, raw } from "express";
import type { RequestHandler } from "express";

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
    if (req.path.match(/^\/internal\/scan-jobs\/[^/]+\/callback$/)) {
      (json({ limit: "50mb" }) as RequestHandler)(req, res, next);
      return;
    }
    (json({ limit: "1mb" }) as RequestHandler)(req, res, next);
  };
}

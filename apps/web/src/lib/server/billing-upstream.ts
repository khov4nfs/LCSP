import type { ZodType } from "zod";

import {
  validatedUpstreamJson,
  type UpstreamRequestResult,
} from "./upstream-request";

export function validatedBillingUpstreamJson<TData>(
  upstream: UpstreamRequestResult,
  schema: ZodType<TData>,
) {
  return validatedUpstreamJson(upstream, (value) => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : null;
  });
}

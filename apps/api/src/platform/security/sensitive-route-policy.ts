type SensitiveRouteDefinition = {
  routeId: string;
  method: string;
  pathTemplate: string;
};

export const SENSITIVE_ROUTE_IDS = {
  githubAppStart: "GITHUB_APP_START",
  githubCliRepositoryDiscovery: "GITHUB_CLI_REPOSITORY_DISCOVERY",
  githubCliRepositoryConnect: "GITHUB_CLI_REPOSITORY_CONNECT",
  mfaRecoveryCodesGenerate: "MFA_RECOVERY_CODES_GENERATE",
} as const;

const sensitiveRouteRegistry = new Map<string, SensitiveRouteDefinition>();

export const SENSITIVE_ACTION_REAUTH_TTL_MS = 5 * 60_000;

export type SensitiveRouteMatch = {
  routeId: string;
};

type SensitiveActionVerifiedAt = Date | number | null | undefined;

/**
 * Adds a normalized route definition to the in-memory sensitive-route registry.
 *
 * @param definition - Route identifier, HTTP method, and path template to register.
 */
export function registerSensitiveRoute(
  definition: SensitiveRouteDefinition,
): void {
  const normalizedMethod = definition.method.trim().toUpperCase();
  const normalizedPathTemplate = normalizeRoutePath(definition.pathTemplate);
  if (
    definition.routeId.trim().length === 0 ||
    normalizedMethod.length === 0 ||
    normalizedPathTemplate.length === 0
  ) {
    return;
  }

  const registryKey = [
    definition.routeId,
    normalizedMethod,
    normalizedPathTemplate,
  ].join(":");
  sensitiveRouteRegistry.set(registryKey, {
    routeId: definition.routeId,
    method: normalizedMethod,
    pathTemplate: normalizedPathTemplate,
  });
}

/**
 * Checks whether an HTTP method/path pair matches a registered sensitive route.
 *
 * @param method - HTTP method to evaluate.
 * @param route - Request path or URL to evaluate.
 * @returns True when a registered sensitive-route policy matches the request.
 */
export function isSensitiveRoute(method: string, route: string): boolean {
  return matchSensitiveRoute(method, route) !== null;
}

/**
 * Finds the registered sensitive-route policy matching an HTTP method and path.
 *
 * @param method - HTTP method to normalize and compare.
 * @param route - Request path or URL to normalize and compare.
 * @returns Matching route identifier, or null when the request is not sensitive.
 */
export function matchSensitiveRoute(
  method: string,
  route: string,
): SensitiveRouteMatch | null {
  const normalizedMethod = method.trim().toUpperCase();
  const normalizedPath = normalizeRoutePath(route);

  const policy = Array.from(sensitiveRouteRegistry.values()).find(
    (candidate) =>
      candidate.method === normalizedMethod &&
      pathTemplateMatches(candidate.pathTemplate, normalizedPath),
  );

  return policy ? { routeId: policy.routeId } : null;
}

/**
 * Calculates when a sensitive-action verification stops being considered fresh.
 *
 * @param verifiedAt - Verification timestamp represented as a Date, epoch milliseconds, or empty value.
 * @returns Expiration timestamp, or null when no verification timestamp is available.
 */
export function sensitiveActionVerificationExpiresAt(
  verifiedAt: SensitiveActionVerifiedAt,
): Date | null {
  const verifiedAtMs = sensitiveActionVerifiedAtMs(verifiedAt);
  return verifiedAtMs
    ? new Date(verifiedAtMs + SENSITIVE_ACTION_REAUTH_TTL_MS)
    : null;
}

/**
 * Checks whether sensitive-action verification remains valid at the supplied current time.
 *
 * @param verifiedAt - Verification timestamp represented as a Date, epoch milliseconds, or empty value.
 * @param now - Current time in epoch milliseconds.
 * @returns True when verification exists and its re-authentication TTL has not expired.
 */
export function isSensitiveActionVerificationFresh(
  verifiedAt: SensitiveActionVerifiedAt,
  now: number,
): boolean {
  const expiresAt = sensitiveActionVerificationExpiresAt(verifiedAt);
  return expiresAt !== null && expiresAt.getTime() > now;
}

/**
 * Normalizes a supported sensitive-action verification timestamp to epoch milliseconds.
 *
 * @param verifiedAt - Date, epoch milliseconds, or empty verification value.
 * @returns Epoch milliseconds, or null when the value is absent or unsupported.
 */
function sensitiveActionVerifiedAtMs(
  verifiedAt: SensitiveActionVerifiedAt,
): number | null {
  if (verifiedAt instanceof Date) {
    return verifiedAt.getTime();
  }

  return typeof verifiedAt === "number" ? verifiedAt : null;
}

/**
 * Normalizes a route or URL to its pathname for policy matching.
 *
 * @param route - Relative path or URL to normalize.
 * @returns Normalized pathname, or an empty string for invalid/empty input.
 */
function normalizeRoutePath(route: string): string {
  const trimmedRoute = route.trim();
  if (trimmedRoute.length === 0) {
    return "";
  }

  try {
    return new URL(trimmedRoute, "http://lcsp.local").pathname;
  } catch {
    return "";
  }
}

/**
 * Tests a normalized request path against a route template.
 *
 * @param template - Registered path template supporting `:parameter` and `*` wildcard segments.
 * @param path - Normalized request pathname.
 * @returns True when the path matches the template.
 */
function pathTemplateMatches(template: string, path: string): boolean {
  return compilePathTemplate(template).test(path);
}

/**
 * Compiles a route template into an anchored regular expression.
 *
 * @param template - Path template whose dynamic and wildcard segments should be converted to regex fragments.
 * @returns Regular expression matching the complete request path.
 */
function compilePathTemplate(template: string): RegExp {
  const pattern = template
    .split("/")
    .map((segment) => {
      if (segment === "*") {
        return ".*";
      }

      if (segment.startsWith(":")) {
        return "[^/]+";
      }

      return escapeRegExp(segment);
    })
    .join("/");

  return new RegExp(`^${pattern}$`, "u");
}

/**
 * Escapes regular-expression metacharacters in a literal route segment.
 *
 * @param value - Literal route segment to escape.
 * @returns Regex-safe literal string.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

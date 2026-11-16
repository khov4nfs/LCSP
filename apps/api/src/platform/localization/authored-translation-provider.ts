/**
 * Business purpose: Route authored translation work to the existing private Agent Server or an explicit provider.
 * Business rules:
 * - An explicit external URL requires its own key; native routing uses the existing worker credential.
 * - Incomplete external configuration never falls back to another credential or destination.
 * Execution flow:
 * 1. Select the explicit provider or derive the native endpoint from deployment configuration.
 * 2. Return the matching authentication header only when both address and credential exist.
 * Failure cases:
 * - Missing, partial or invalid HTTP configuration returns null so durable work retains a provider-unavailable outcome.
 * Side effects:
 * - Reads environment configuration only; no network or persistence.
 */
export function authoredTranslationProvider(): {
  url: string;
  headers: Record<string, string>;
} | null {
  const externalUrl = process.env.LCSP_AUTHORED_TRANSLATION_URL;
  const externalKey = process.env.LCSP_AUTHORED_TRANSLATION_KEY;
  const usesExternalProvider = Boolean(externalUrl || externalKey);
  const base = usesExternalProvider
    ? externalUrl
    : process.env.LCSP_AGENT_SERVER_URL;
  const key = usesExternalProvider ? externalKey : process.env.WORKER_API_KEY;
  if (!base || !key) return null;

  try {
    const url = new URL(base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return usesExternalProvider
      ? { url: url.toString(), headers: { Authorization: `Bearer ${key}` } }
      : {
          url: new URL(
            "internal/authored-translation",
            `${url.toString().replace(/\/$/, "")}/`,
          ).toString(),
          headers: { "x-worker-api-key": key },
        };
  } catch {
    return null;
  }
}

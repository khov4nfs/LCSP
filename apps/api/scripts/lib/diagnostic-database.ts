/**
 * Business purpose: Validate a local diagnostic database address without disclosing credentials.
 * Business rules: Only explicit loopback PostgreSQL endpoints are accepted; URL parse errors must not echo their input.
 * Execution flow: Parse the supplied address, validate protocol/host/database and return its structured endpoint.
 * Failure cases: Missing, malformed, remote or non-PostgreSQL addresses raise sanitized errors without a cause containing secret input.
 * Side effects: None; does not open a connection or authorize any mutation.
 */
export function diagnosticDatabaseEndpoint(raw: string | undefined): URL {
  let endpoint: URL;
  try {
    if (!raw) throw Error();
    endpoint = new URL(raw);
  } catch {
    throw Error("Explicit valid local PostgreSQL diagnostic address required");
  }
  if (
    !["postgres:", "postgresql:"].includes(endpoint.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
    endpoint.pathname.length < 2
  )
    throw Error("Explicit loopback PostgreSQL diagnostic database required");
  return endpoint;
}

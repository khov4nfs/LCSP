import * as crypto from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(crypto.scrypt);

/**
 * Derives a key using Node.js crypto.scrypt asynchronously off the main thread.
 *
 * Rationale (Why): CPU-intensive scrypt hashing takes ~50-100ms. Running it synchronously on the
 * main V8 thread blocks all concurrent requests, health probes, and event loop processing.
 * Mechanism (How): Executes via libuv worker threadpool using promisified `crypto.scrypt`.
 * Invariants (What): Non-blocking asynchronous derivation; returns salt:hexKey string.
 */
export async function hashSecret(
  secret: string,
  salt = crypto.randomBytes(16).toString("hex"),
): Promise<string> {
  const derivedKey = (await scryptAsync(secret, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

/**
 * Verifies a secret against a hashed secret asynchronously off the main thread.
 *
 * Rationale (Why): Constant-time password verification must not block the main event loop.
 * Mechanism (How): Executes scrypt derivation via libuv threadpool and compares using timingSafeEqual.
 * Invariants (What): Constant-time comparison; invalid formats return false; never throws.
 */
export async function verifySecret(
  secret: string,
  hashedSecret: unknown,
): Promise<boolean> {
  if (typeof hashedSecret !== "string") {
    return false;
  }

  const [salt, expected, ...rest] = hashedSecret.split(":");
  if (
    !salt ||
    !expected ||
    rest.length > 0 ||
    expected.length !== 128 ||
    !/^[0-9a-f]+$/i.test(expected)
  ) {
    return false;
  }

  const derivedKey = (await scryptAsync(secret, salt, 64)) as Buffer;
  const actual = derivedKey.toString("hex");
  return crypto.timingSafeEqual(
    Buffer.from(actual, "hex"),
    Buffer.from(expected, "hex"),
  );
}

/**
 * Synchronous variant of hashSecret for offline scripts and non-request execution contexts.
 */
export function hashSecretSync(
  secret: string,
  salt = crypto.randomBytes(16).toString("hex"),
): string {
  const derivedKey = crypto.scryptSync(secret, salt, 64).toString("hex");
  return `${salt}:${derivedKey}`;
}

/**
 * Synchronous variant of verifySecret for offline scripts and non-request execution contexts.
 */
export function verifySecretSync(
  secret: string,
  hashedSecret: unknown,
): boolean {
  if (typeof hashedSecret !== "string") {
    return false;
  }

  const [salt, expected, ...rest] = hashedSecret.split(":");
  if (
    !salt ||
    !expected ||
    rest.length > 0 ||
    expected.length !== 128 ||
    !/^[0-9a-f]+$/i.test(expected)
  ) {
    return false;
  }

  const actual = crypto.scryptSync(secret, salt, 64).toString("hex");
  return crypto.timingSafeEqual(
    Buffer.from(actual, "hex"),
    Buffer.from(expected, "hex"),
  );
}

export function issueOpaqueToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

export function issueOAuthStateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function fingerprintToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createCorrelationId(): string {
  return crypto.randomUUID();
}

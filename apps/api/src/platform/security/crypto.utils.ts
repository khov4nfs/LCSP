import * as crypto from "node:crypto";

export function hashSecret(
  secret: string,
  salt = crypto.randomBytes(16).toString("hex"),
): string {
  const derivedKey = crypto.scryptSync(secret, salt, 64).toString("hex");
  return `${salt}:${derivedKey}`;
}

export function verifySecret(secret: string, hashedSecret: unknown): boolean {
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

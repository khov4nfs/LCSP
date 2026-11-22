import { describe, expect, it } from "@jest/globals";
import {
  hashSecret,
  hashSecretSync,
  verifySecret,
  verifySecretSync,
} from "./crypto.utils.js";

describe("CryptoUtils — Event Loop Blocker & Asynchronous Scrypt", () => {
  it("returns a Promise that resolves to a hash string and verifies asynchronously (RED reproducer)", async () => {
    const secret = "test-password-123";
    const hashResult = hashSecret(secret);

    // Rationale (Why): hashSecret MUST return a Promise so scrypt executes asynchronously
    // via libuv threadpool instead of blocking the main V8 event loop synchronously.
    expect(hashResult).toBeInstanceOf(Promise);

    const hash = await hashResult;
    expect(typeof hash).toBe("string");
    expect(hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);

    const verifyResult = verifySecret(secret, hash);
    // verifySecret MUST also return a Promise so verification is non-blocking
    expect(verifyResult).toBeInstanceOf(Promise);

    const valid = await verifyResult;
    expect(valid).toBe(true);
  });

  it("asynchronously rejects incorrect passwords and malformed hashes", async () => {
    const secret = "correct-password";
    const wrong = "wrong-password";
    const hash = await hashSecret(secret);

    expect(await verifySecret(wrong, hash)).toBe(false);
    expect(await verifySecret(secret, null)).toBe(false);
    expect(await verifySecret(secret, "bad-hash-format")).toBe(false);
    expect(await verifySecret(secret, "salt-only:")).toBe(false);
    expect(await verifySecret(secret, "salt:too-short-hash")).toBe(false);
    expect(await verifySecret(secret, "salt:hash:extra-colons")).toBe(false);
  });

  it("provides synchronous hashSecretSync and verifySecretSync for offline contexts", () => {
    const secret = "sync-secret-test";
    const hash = hashSecretSync(secret);

    expect(typeof hash).toBe("string");
    expect(hash).not.toBeInstanceOf(Promise);
    expect(verifySecretSync(secret, hash)).toBe(true);
    expect(verifySecretSync("incorrect", hash)).toBe(false);
    expect(verifySecretSync(secret, "invalid")).toBe(false);
  });

  it("cross-verifies between async and sync variants seamlessly", async () => {
    const secret = "interop-test-secret";
    const asyncHash = await hashSecret(secret);
    const syncHash = hashSecretSync(secret);

    expect(verifySecretSync(secret, asyncHash)).toBe(true);
    expect(await verifySecret(secret, syncHash)).toBe(true);
  });
});

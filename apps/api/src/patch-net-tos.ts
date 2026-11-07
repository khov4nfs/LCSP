import net from "node:net";

/**
 * Business purpose: Allow explicitly opted-in Darwin development processes to tolerate an unsupported socket TOS setting.
 * Business rules:
 * - Only Darwin with LCSP_NODE_DARWIN_TOS_COMPAT=1 may install the compatibility wrapper.
 * - The wrapper suppresses only EINVAL from setTypeOfService and preserves every other result or error.
 * - A shared symbol prevents repeated installation by the preload and API entrypoint.
 * Execution flow:
 * 1. Check platform, opt-in and the native method's availability.
 * 2. Skip an already wrapped method, otherwise install and mark one wrapper.
 * Failure cases:
 * - Unsupported platforms, disabled configuration or a missing native method leave sockets unchanged.
 * Side effects:
 * - Replaces the process-local socket prototype method only when explicitly enabled.
 */
function installNodeDarwinTosCompat(): void {
  if (
    process.platform !== "darwin" ||
    process.env.LCSP_NODE_DARWIN_TOS_COMPAT !== "1"
  )
    return;

  const socketProto = net.Socket.prototype as unknown as {
    setTypeOfService?: (tos: number) => unknown;
  };
  const original = socketProto.setTypeOfService;
  const marker = Symbol.for("lcsp.nodeDarwinTosCompat");
  if (
    typeof original !== "function" ||
    Object.getOwnPropertyDescriptor(original, marker)?.value === true
  )
    return;

  /**
   * Business purpose: Preserve socket use when an opted-in Darwin host rejects only the optional TOS setting.
   * Business rules: Native success and all errors except EINVAL retain their original behavior and receiver.
   * Execution flow: Call the original method once; return the socket only for the known unsupported-setting error.
   * Failure cases: Propagates all other thrown values without changing their identity.
   * Side effects: Performs the original socket operation; never retries or changes other socket settings.
   */
  function setCompatibleTypeOfService(this: unknown, tos: number): unknown {
    try {
      return original!.call(this, tos);
    } catch (error: unknown) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "EINVAL"
      )
        return this;
      throw error;
    }
  }

  Object.defineProperty(setCompatibleTypeOfService, marker, { value: true });
  socketProto.setTypeOfService = setCompatibleTypeOfService;
}

installNodeDarwinTosCompat();

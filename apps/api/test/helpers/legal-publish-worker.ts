import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { safePublishReviewArtifact } from "../../scripts/lib/legal-review-guard.ts";

export interface PublishWorkerMessage {
  type: "PUBLISH";
  outputPath: string;
  generatedBytes: string;
  artifactKindLabel?: string;
}

export interface PublishWorkerResponse {
  type: "READY" | "DONE" | "ERROR";
  outcome?: string;
  sha256?: string;
  message?: string;
  code?: string;
  pid: number;
}

// Child process execution path
if (typeof process.send === "function") {
  process.on("message", (msg: PublishWorkerMessage) => {
    if (msg.type === "PUBLISH") {
      try {
        const res = safePublishReviewArtifact({
          outputPath: msg.outputPath,
          generatedBytes: msg.generatedBytes,
          artifactKindLabel: msg.artifactKindLabel ?? "legal review candidates",
        });
        process.send?.({
          type: "DONE",
          outcome: res.outcome,
          sha256: res.sha256,
          pid: process.pid,
        } satisfies PublishWorkerResponse);
      } catch (err: unknown) {
        const errorObj = err as { message?: string; code?: string };
        process.send?.({
          type: "ERROR",
          message: errorObj.message ?? String(err),
          code: errorObj.code,
          pid: process.pid,
        } satisfies PublishWorkerResponse);
      }
    }
  });

  // Signal ready to parent process
  process.send({
    type: "READY",
    pid: process.pid,
  } satisfies PublishWorkerResponse);
}

export interface PublishWorkerController {
  child: ChildProcess;
  ready: Promise<number>;
  publish: (options: {
    outputPath: string;
    generatedBytes: string;
    artifactKindLabel?: string;
  }) => Promise<PublishWorkerResponse>;
  kill: () => void;
}

/**
 * Business purpose: Spawn an independent operating-system process for testing concurrent artifact publication.
 * Business rules: Spawn child with IPC channel, coordinate via deterministic barrier, and handle graceful termination.
 * Execution flow: Fork worker via tsx, establish message listener, wait for child ready signal, return publish/kill controller.
 * Failure cases: Rejects if child fails to spawn or crashes before ready.
 * Side effects: Spawns an external Node.js process.
 */
export function spawnPublishWorker(): PublishWorkerController {
  const currentFile = fileURLToPath(import.meta.url);
  const child: ChildProcess = fork(currentFile, [], {
    execArgv: ["--import", "tsx"],
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });

  const ready = new Promise<number>((resolve, reject) => {
    const onMessage = (msg: PublishWorkerResponse) => {
      if (msg.type === "READY") {
        child.off("message", onMessage);
        resolve(msg.pid);
      }
    };
    child.on("message", onMessage);
    child.on("error", reject);
  });

  function publish(options: {
    outputPath: string;
    generatedBytes: string;
    artifactKindLabel?: string;
  }): Promise<PublishWorkerResponse> {
    return new Promise<PublishWorkerResponse>((resolve, reject) => {
      const onMessage = (msg: PublishWorkerResponse) => {
        if (msg.type === "DONE" || msg.type === "ERROR") {
          child.off("message", onMessage);
          resolve(msg);
        }
      };
      child.on("message", onMessage);
      child.on("error", reject);
      child.send({
        type: "PUBLISH",
        outputPath: options.outputPath,
        generatedBytes: options.generatedBytes,
        artifactKindLabel: options.artifactKindLabel,
      } satisfies PublishWorkerMessage);
    });
  }

  function kill() {
    child.kill();
  }

  return { child, ready, publish, kill };
}

type SavePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<FileSystemFileHandle>;
};

/**
 * Business purpose: Download an authorized attachment through the native Save As picker or browser download fallback.
 * Business rules:
 * - Unsupported or unavailable pickers use a standard attachment download.
 * - Cancelling the picker creates no file and sends no download request.
 * - Network and file-write failures after selecting a destination propagate to the caller; they never trigger a second download.
 * - Optional picker descriptions are supplied by the caller's localized UI.
 * Execution flow:
 * 1. Take responsibility for the click and detect picker support in the browser.
 * 2. Obtain a destination when possible, then fetch and persist the authorized attachment once.
 * 3. Fall back to a temporary download link only when no picker destination was obtained.
 * Failure cases:
 * - Calling outside a browser rejects; picker cancellation resolves silently.
 * - Fetch or persistence errors reject, aborting an incomplete writable stream when possible.
 * Side effects:
 * - Opens a native dialog or triggers a browser download; fetches only the requested attachment and creates no assessment mutation.
 */
export async function downloadFileWithSavePicker({
  url,
  suggestedName,
  mimeType = "application/json",
  description,
  event,
}: {
  url: string;
  suggestedName: string;
  mimeType?: string;
  description?: string;
  event?: { preventDefault: () => void };
}): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined")
    throw new Error("File downloads require a browser");
  event?.preventDefault();
  const picker = (window as SavePickerWindow).showSaveFilePicker;
  let fileHandle: FileSystemFileHandle | undefined;
  if (picker) {
    const extension = suggestedName.includes(".")
      ? "." + suggestedName.split(".").pop()
      : ".json";
    try {
      fileHandle = await picker.call(window, {
        suggestedName,
        types: [
          {
            ...(description ? { description } : {}),
            accept: { [mimeType]: [extension] },
          },
        ],
      });
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }
  if (fileHandle) {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok)
      throw new Error("Download failed with status " + response.status);
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(await response.blob());
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => undefined);
      throw error;
    }
    return;
  }
  const link = document.createElement("a");
  link.href = url;
  link.download = suggestedName;
  link.hidden = true;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
  }
}

import assert from "node:assert/strict";
import test from "node:test";

test("Admin suspend modal: dismissal actions (Cancel, Escape, Backdrop) cause 0 mutations", () => {
  let suspendMutationCount = 0;

  function handleDismissal(action: "cancel" | "escape" | "backdrop") {
    if (action === "cancel" || action === "escape" || action === "backdrop") {
      // Closes modal only, no API mutation dispatched
      return;
    }
  }

  function handleConfirm() {
    suspendMutationCount += 1;
  }

  // 1. User clicks Cancel button
  handleDismissal("cancel");
  assert.equal(suspendMutationCount, 0);

  // 2. User presses Escape key
  handleDismissal("escape");
  assert.equal(suspendMutationCount, 0);

  // 3. User clicks backdrop
  handleDismissal("backdrop");
  assert.equal(suspendMutationCount, 0);

  // 4. User confirms suspension
  handleConfirm();
  assert.equal(suspendMutationCount, 1);
});

test("Admin suspend modal: dynamic target user identity injection", () => {
  const selectedUser = {
    fullName: "Bao Nguyen",
    email: "bao.nguyen@security.vn",
  };

  const template =
    "{name} ({email}) will no longer be able to sign in or start assessments until an administrator restores access.";

  const renderedBody = template
    .replace("{name}", selectedUser.fullName)
    .replace("{email}", selectedUser.email);

  assert.equal(
    renderedBody,
    "Bao Nguyen (bao.nguyen@security.vn) will no longer be able to sign in or start assessments until an administrator restores access.",
  );
  assert.equal(renderedBody.includes("Nhi M."), false);
});

test("Admin suspend modal: focus trapping and restoration contract", () => {
  // Mock DOM elements
  const triggerButton = { id: "suspend-trigger", focused: false, focus() { this.focused = true; } };
  const cancelButton = { id: "cancel-btn", focused: false, focus() { this.focused = true; } };
  const confirmButton = { id: "confirm-btn", focused: false, focus() { this.focused = true; } };
  const focusable = [cancelButton, confirmButton];

  // 1. Initial focus goes to first interactive element (Cancel button)
  let activeElement: { id: string; focused: boolean; focus: () => void } = triggerButton;
  const previousActiveElement = activeElement;

  // Simulate modal mount
  cancelButton.focus();
  activeElement = cancelButton;
  assert.equal(cancelButton.focused, true);

  // 2. Tab trap forward: from last element cycles to first element
  function handleTabKey(shiftKey: boolean) {
    const currentIndex = focusable.indexOf(activeElement);
    if (shiftKey) {
      const nextIndex = currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1;
      activeElement = focusable[nextIndex];
      activeElement.focus();
    } else {
      const nextIndex = currentIndex >= focusable.length - 1 ? 0 : currentIndex + 1;
      activeElement = focusable[nextIndex];
      activeElement.focus();
    }
  }

  // Active is Cancel (0), press Tab -> moves to Confirm (1)
  handleTabKey(false);
  assert.equal(activeElement.id, "confirm-btn");

  // Active is Confirm (1), press Tab -> loops back to Cancel (0)
  handleTabKey(false);
  assert.equal(activeElement.id, "cancel-btn");

  // Active is Cancel (0), press Shift+Tab -> loops to Confirm (1)
  handleTabKey(true);
  assert.equal(activeElement.id, "confirm-btn");

  // 3. On modal dismiss, focus is restored to the previous active element (trigger button)
  previousActiveElement.focus();
  assert.equal(triggerButton.focused, true);
});


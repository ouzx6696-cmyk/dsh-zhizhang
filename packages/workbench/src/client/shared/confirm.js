/**
 * The workbench asks for confirmation through one hook so the desktop shell can show its own
 * dialog. Until the host installs one, the browser's native confirm is used.
 */
let ask = (message) => Promise.resolve(window.confirm(message));

/** Installed once by the host shell; returns a function that restores the previous handler. */
export function setConfirm(handler) {
  const previous = ask;
  ask = handler;
  return () => {
    ask = previous;
  };
}

/** Resolves true when the author confirms. */
export function confirmAction(message) {
  return ask(message);
}

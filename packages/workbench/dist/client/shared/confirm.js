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

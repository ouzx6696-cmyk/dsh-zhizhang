/**
 * The workbench asks for confirmation through one hook so the desktop shell can show its own
 * dialog. Until the host installs one, the browser's native confirm is used.
 */
export type ConfirmHandler = (message: string) => Promise<boolean>;
/** Installed once by the host shell; returns a function that restores the previous handler. */
export declare function setConfirm(handler: ConfirmHandler): () => void;
/** Resolves true when the author confirms. */
export declare function confirmAction(message: string): Promise<boolean>;
//# sourceMappingURL=confirm.d.ts.map
import type { CommandInput, CommandResult, WorkbenchCommand } from "../contract/commands.js";
export interface WorkbenchBridge {
    call<K extends WorkbenchCommand>(command: K, input: CommandInput<K>): Promise<CommandResult<K>>;
}
export declare function createWorkbench(bridge: WorkbenchBridge): {
    call: <K extends WorkbenchCommand>(command: K, input: CommandInput<K>) => Promise<CommandResult<K>>;
};
//# sourceMappingURL=createWorkbench.d.ts.map
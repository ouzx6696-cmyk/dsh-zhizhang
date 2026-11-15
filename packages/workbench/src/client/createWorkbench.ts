import type { CommandInput, CommandResult, WorkbenchCommand } from "../contract/commands.js";

export interface WorkbenchBridge {
  call<K extends WorkbenchCommand>(command: K, input: CommandInput<K>): Promise<CommandResult<K>>;
}

export function createWorkbench(bridge: WorkbenchBridge) {
  return {
    call: bridge.call.bind(bridge),
  };
}

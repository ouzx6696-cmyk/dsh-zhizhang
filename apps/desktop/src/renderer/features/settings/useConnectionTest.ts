import { useState } from "react";
import { desktop } from "../../state/desktop";
import type { ConnectionResult } from "../../state/store";
import type { ModelConnection, ModelSettings } from "../../../models";
import { errorText } from "../../../../../../packages/core/src/errors.js";
export function useConnectionTest() {
  const [results, setResults] = useState<Partial<Record<keyof ModelSettings, ConnectionResult>>>(
    {},
  );
  async function run(role: keyof ModelSettings, model: ModelConnection) {
    setResults((previous) => ({ ...previous, [role]: { busy: true } }));
    try {
      const result = await desktop.testModel(role, model);
      setResults((previous) => ({ ...previous, [role]: result }));
    } catch (error) {
      setResults((previous) => ({ ...previous, [role]: { error: errorText(error) } }));
    }
  }
  return { results, run };
}

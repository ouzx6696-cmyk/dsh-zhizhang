import path from "node:path";
import type { Runtime } from "../runtime";
import { handle } from "./handle";
import { parseAppearance } from "./validate";
import { connection } from "../../models";
import { testConnection } from "../../session/pi-adapter";
import { explainError } from "../../diagnostics";

export function registerModelsIpc(state: Runtime) {
  handle("model", async (next) => {
    await state.sessions.dispose();
    state.notice = await state.settings.saveModels(next);
    state.model = state.settings.models;
    state.emit({ running: [] });
    state.emit({ refresh: true });
    await state.diagnostics.write("models_saved");
    return state.settings.public();
  });
  handle("test-model", async (role, next) => {
    if (role !== "writer" && role !== "editor" && role !== "planner")
      throw new Error("未知角色");
    const previous = state.model[role] || state.model.writer;
    try {
      const value = connection(next, previous);
      if (!value.apiKey && value.baseUrl === state.model.writer.baseUrl)
        value.apiKey = state.model.writer.apiKey;
      return await testConnection(value, path.join(state.home, "agent", "auth.json"));
    } catch (error) {
      throw new Error(explainError(error));
    }
  });
  handle("appearance", async (next) => {
    await state.settings.saveUI({ appearance: parseAppearance(next) });
    return state.settings.appearance;
  });
  handle("preferences", async (text) => {
    if (typeof text === "string") await state.settings.savePreferences(text);
    return state.settings.preferences();
  });
  handle("search", async (key) => {
    await state.settings.saveSearch(String(key));
    await state.sessions.dispose();
    state.emit({ running: [] });
    return state.settings.public();
  });
}

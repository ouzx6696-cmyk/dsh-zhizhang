import path from "node:path";
import type { Runtime } from "../runtime";
import { handle } from "./handle";
import { connection } from "../../models";
import { modelCatalog, discoverModels, testConnection } from "../../session/pi-adapter";
import { explainError } from "../../diagnostics";

export function registerModelsIpc(state: Runtime) {
  handle("model", async (next) => {
    const notice = await state.settings.saveModels(next);
    await state.sessions.dispose();
    state.notice = notice;
    state.model = state.settings.models;
    state.emit({ running: [] });
    state.emit({ refresh: true });
    await state.diagnostics.write("models_saved");
    return state.settings.public();
  });
  handle("test-model", async (role, next) => {
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
  handle("model-catalog", async (role, next, action) => {
    const previous = state.model[role] || state.model.writer;
    const value = connection(next, previous);
    return action === "endpoint"
      ? discoverModels(value)
      : modelCatalog(path.join(state.home, "agent", "auth.json"), value, action === "refresh");
  });
  handle("appearance", async (next) => {
    await state.settings.saveUI({ appearance: next });
    return state.settings.appearance;
  });
  handle("preferences", () => state.settings.preferences());
  handle("save-preferences", async (text) => {
    await state.settings.savePreferences(text);
    return state.settings.preferences();
  });
  handle("search", async (key) => {
    await state.settings.saveSearch(key);
    await state.sessions.dispose();
    state.emit({ running: [] });
    return state.settings.public();
  });
}

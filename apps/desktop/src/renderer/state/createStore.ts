export function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => state,
    set: (patch: Partial<T> | ((state: T) => Partial<T>)) => {
      state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
      for (const listener of listeners) listener();
    },
  };
}

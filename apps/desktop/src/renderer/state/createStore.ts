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
      const next = typeof patch === "function" ? patch(state) : patch;
      if (Object.keys(next).every(key => Object.is(state[key as keyof T], next[key as keyof T]))) return;
      state = { ...state, ...next };
      for (const listener of listeners) listener();
    },
  };
}

import { useSyncExternalStore } from "react";

export interface Store<T> {
  subscribe(listener: () => void): () => void;
  get(): T;
  set(patch: Partial<T> | ((state: T) => Partial<T>)): void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => state,
    set(patch) {
      const next = typeof patch === "function" ? patch(state) : patch;
      const changed = Object.entries(next).some(
        ([key, value]) => !Object.is(Reflect.get(state, key), value),
      );
      if (!changed) return;
      state = { ...state, ...next };
      for (const listener of listeners) listener();
    },
  };
}

/** 只订阅组件用到的字段：选择结果按 Object.is 比较，未变化的组件不重渲染。 */
export function useStoreSelector<T extends object, R>(
  store: Store<T>,
  selector: (state: T) => R,
): R {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.get()),
  );
}

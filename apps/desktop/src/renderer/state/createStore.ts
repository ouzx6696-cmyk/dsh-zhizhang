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
      if (Object.keys(next).every((key) => Object.is(state[key as keyof T], next[key as keyof T])))
        return;
      state = { ...state, ...next };
      for (const listener of listeners) listener();
    },
  };
}

/** 两个平铺对象的字段逐个 Object.is 相同（含字段集合相同）。 */
export function sameFields<T extends object>(a: T, b: T) {
  const keys = Object.keys(a) as (keyof T)[];
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && Object.is(a[key], b[key]))
  );
}

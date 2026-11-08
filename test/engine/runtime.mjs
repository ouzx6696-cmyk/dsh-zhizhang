/**
 * 最小 hook 运行时：按调用顺序保存 state / ref / memo / effect，setState 之后由 flush 重渲染。
 * 用来在 Node 里驱动写作台组件的真实异步状态流，不引入新的测试依赖。
 * 子组件展开时不占用槽位（只读渲染），被测组件本身的状态完整保留。
 */
export function createRuntime() {
  const slots = [];
  let cursor = 0;
  let pending = [];
  let dirty = false;
  let stateless = false;
  const same = (a, b) =>
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((v, i) => Object.is(v, b[i]));
  const slot = (init) => {
    if (stateless) return { value: init() };
    const index = cursor++;
    if (!(index in slots)) slots[index] = { value: init() };
    return slots[index];
  };
  const react = {
    createElement: (type, props, ...children) => ({
      type,
      props: props || {},
      children: children.flat(),
    }),
    Component: class {},
    Fragment: "fragment",
    memo: (component) => component,
    forwardRef: (render) => (props) => render(props, null),
    createContext: (value) => ({ Provider: (props) => props.children, value }),
    useContext: (context) => context.value,
    useId: () => "id",
    useState(initial) {
      const cell = slot(() => (typeof initial === "function" ? initial() : initial));
      const set = (next) => {
        const value = typeof next === "function" ? next(cell.value) : next;
        if (Object.is(value, cell.value)) return;
        cell.value = value;
        dirty = true;
      };
      return [cell.value, set];
    },
    useRef: (initial) => slot(() => ({ current: initial })).value,
    useMemo(factory, deps) {
      const cell = slot(() => ({ deps: undefined, result: undefined }));
      if (stateless) return factory();
      if (!same(cell.value.deps, deps)) cell.value = { deps, result: factory() };
      return cell.value.result;
    },
    useCallback: (fn, deps) => react.useMemo(() => fn, deps),
    useEffect(effect, deps) {
      if (stateless) return;
      const cell = slot(() => ({ deps: undefined, cleanup: undefined }));
      if (same(cell.value.deps, deps)) return;
      pending.push(() => {
        if (typeof cell.value.cleanup === "function") cell.value.cleanup();
        cell.value = { deps, cleanup: effect() };
      });
    },
  };
  const expand = (node) => {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== "object") return node;
    if (typeof node.type === "function") {
      stateless = true;
      let out;
      try {
        out = node.type({ ...node.props, children: node.children });
      } finally {
        stateless = false;
      }
      return expand(out);
    }
    return { ...node, children: expand(node.children) };
  };
  return {
    react,
    mount(Component, initialProps) {
      let props = initialProps;
      let raw;
      const render = () => {
        cursor = 0;
        dirty = false;
        raw = Component(props);
        const effects = pending;
        pending = [];
        effects.forEach((run) => run());
      };
      render();
      const view = {
        get raw() {
          return raw;
        },
        get tree() {
          return expand(raw);
        },
        rerender(next) {
          props = next;
          render();
        },
        async flush() {
          for (let round = 0; round < 50; round += 1) {
            await new Promise((resolve) => setImmediate(resolve));
            if (!dirty) return view;
            render();
          }
          throw new Error("render did not settle");
        },
      };
      return view;
    },
  };
}

/** 打包产物在独立的 vm 上下文里运行，取出的数组与对象换回本上下文再做深比较。 */
export const plain = (value) => structuredClone(value);

export function findAll(node, predicate, out = []) {
  if (Array.isArray(node)) node.forEach((child) => findAll(child, predicate, out));
  else if (node && typeof node === "object") {
    if (predicate(node)) out.push(node);
    findAll(node.children, predicate, out);
  }
  return out;
}
export const text = (node) =>
  node == null || typeof node === "boolean"
    ? ""
    : typeof node === "string" || typeof node === "number"
      ? String(node)
      : Array.isArray(node)
        ? node.map(text).join("")
        : text(node.children);
export const byClass = (tree, name) =>
  findAll(tree, (n) =>
    String(n.props?.className || "")
      .split(" ")
      .includes(name),
  );

export function fakeClock() {
  let now = 0;
  let next = 1;
  const timers = new Map();
  return {
    setTimeout(fn, ms = 0) {
      const id = next++;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= end)
          .sort((x, y) => x[1].at - y[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
  };
}

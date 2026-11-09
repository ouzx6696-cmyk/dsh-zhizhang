/**
 * 最小 hook 运行时：每个组件实例（按在树里的位置与 key 区分）各自按调用顺序保存
 * state / ref / memo / effect / 外部订阅，setState 或外部 store 变化之后由 flush 重渲染。
 * 用来在 Node 里驱动写作台与设计系统组件的真实状态流，不引入新的测试依赖。
 * effect 先子后父执行；一次渲染中没再出现的实例视为卸载，执行它的清理。
 * 给了 `hostNode` 时，宿主元素上的对象 ref 挂上它造出的替身节点（需要读写 DOM 的组件用）。
 */
export function createRuntime({ hostNode } = {}) {
  const instances = new Map();
  let current = null;
  let dirty = false;
  let seen = new Set();
  let order = [];
  const same = (a, b) =>
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((v, i) => Object.is(v, b[i]));
  const slot = (init) => {
    const index = current.cursor++;
    if (!(index in current.slots)) current.slots[index] = { value: init() };
    return current.slots[index];
  };
  const useEffect = (effect, deps) => {
    const cell = slot(() => ({ deps: undefined, cleanup: undefined, effect: true }));
    if (deps !== undefined && same(cell.value.deps, deps)) return;
    current.pending.push(() => {
      if (typeof cell.value.cleanup === "function") cell.value.cleanup();
      cell.value = { deps, cleanup: effect(), effect: true };
    });
  };
  const destroy = (instance) => {
    for (const cell of instance.slots)
      if (cell.value?.effect && typeof cell.value.cleanup === "function") cell.value.cleanup();
  };
  // 类组件只支持 render 与错误边界（getDerivedStateFromError + componentDidCatch）。
  class Component {
    constructor(props) {
      this.props = props;
      this.state = {};
    }
  }
  const react = {
    createElement: (type, props, ...children) => ({
      type,
      props: props || {},
      children: children.flat(),
    }),
    Component,
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
      if (!same(cell.value.deps, deps)) cell.value = { deps, result: factory() };
      return cell.value.result;
    },
    useCallback: (fn, deps) => react.useMemo(() => fn, deps),
    useEffect,
    useLayoutEffect: useEffect,
    useDeferredValue: (value) => value,
    useSyncExternalStore(subscribe, getSnapshot) {
      const cell = slot(() => ({ effect: true, cleanup: undefined }));
      if (!cell.value.cleanup)
        cell.value.cleanup = subscribe(() => {
          dirty = true;
        });
      return getSnapshot();
    },
  };
  const renderInstance = (type, props, path) => {
    let instance = instances.get(path);
    if (!instance || instance.type !== type) {
      if (instance) destroy(instance);
      instance = { type, slots: [], cursor: 0, pending: [] };
      instances.set(path, instance);
    }
    seen.add(path);
    const parent = current;
    current = instance;
    instance.cursor = 0;
    try {
      if (!(type.prototype instanceof Component)) return { instance, out: type(props) };
      instance.object ??= new type(props);
      instance.object.props = props;
      return { instance, out: instance.object.render() };
    } finally {
      current = parent;
    }
  };
  const expand = (node, path) => {
    if (Array.isArray(node))
      return node.map((child, index) => expand(child, `${path}.${child?.props?.key ?? index}`));
    if (!node || typeof node !== "object") return node;
    if (typeof node.type === "function") {
      const at = `${path}<${node.type.name}>`;
      const { instance, out } = renderInstance(
        node.type,
        { ...node.props, children: node.children },
        at,
      );
      let tree;
      try {
        tree = expand(out, at);
      } catch (error) {
        if (!node.type.getDerivedStateFromError) throw error;
        const object = instance.object;
        object.state = { ...object.state, ...node.type.getDerivedStateFromError(error) };
        object.componentDidCatch?.(error, { componentStack: "" });
        tree = expand(object.render(), at);
      }
      order.push(instance);
      return tree;
    }
    const { ref } = node.props;
    if (hostNode && ref && typeof ref === "object" && ref.current == null)
      ref.current = hostNode(node);
    return { ...node, children: expand(node.children, path) };
  };
  return {
    react,
    mount(Component, initialProps) {
      let props = initialProps;
      let raw;
      let tree;
      const render = () => {
        dirty = false;
        seen = new Set();
        order = [];
        const root = renderInstance(Component, props, "root");
        raw = root.out;
        tree = expand(raw, "root");
        order.push(root.instance);
        for (const [path, instance] of instances)
          if (!seen.has(path)) {
            destroy(instance);
            instances.delete(path);
          }
        for (const instance of order) {
          const effects = instance.pending;
          instance.pending = [];
          effects.forEach((run) => run());
        }
      };
      render();
      const view = {
        get raw() {
          return raw;
        },
        get tree() {
          return tree;
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
        unmount() {
          for (const instance of instances.values()) destroy(instance);
          instances.clear();
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

/** 手动推进的计时器；`now` 同时作为 Date.now，供按剩余时间续计的组件使用。 */
export function fakeClock() {
  let now = 0;
  let next = 1;
  const timers = new Map();
  class ClockDate extends Date {
    static now() {
      return now;
    }
  }
  return {
    Date: ClockDate,
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

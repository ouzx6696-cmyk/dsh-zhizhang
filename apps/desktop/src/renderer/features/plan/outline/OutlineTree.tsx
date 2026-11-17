import React, { useEffect, useRef, useState } from "react";
import type { OutlineNodeView, OutlineOp, OutlineView } from "@zhizhang/fanqie/outline";
import { P } from "../shared";
export function OutlineTree({
  outline,
  selected,
  setSelected,
  current,
  dirty,
  readonly,
  execute,
  move,
}: {
  outline?: OutlineView;
  selected: string[];
  setSelected: React.Dispatch<React.SetStateAction<string[]>>;
  current?: OutlineNodeView;
  dirty: boolean;
  readonly: boolean;
  execute: (ops: OutlineOp[]) => Promise<void>;
  move: (node: OutlineNodeView, delta: number) => void;
}) {
  const [expanded, setExpanded] = useState(new Set<string>()),
    [scroll, setScroll] = useState(0),
    treeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!outline?.nodes.length) return;
    const target = outline.nodes.find((node) => node.id === selected[0]) ?? outline.nodes[0];
    if (!selected.length) setSelected([target.id]);
    const ancestors: string[] = [];
    let parent = target.parent;
    while (parent) {
      ancestors.push(parent);
      parent = outline.nodes.find((node) => node.id === parent)?.parent;
    }
    if (ancestors.some((id) => !expanded.has(id)))
      setExpanded(new Set([...expanded, ...ancestors]));
  }, [outline, selected, setSelected, expanded]);
  const visible =
    outline?.nodes.filter((node) => {
      let parent = node.parent;
      while (parent) {
        if (!expanded.has(parent)) return false;
        parent = outline.nodes.find((node) => node.id === parent)?.parent;
      }
      return true;
    }) ?? [];
  const offset = Math.max(0, Math.floor(scroll / 40) - 30),
    windowRows = visible.slice(offset, offset + 90);
  const focusNode = (id: string) => {
    const index = visible.findIndex((node) => node.id === id),
      tree = treeRef.current;
    if (index < 0 || !tree) return;
    const top = index * 40;
    if (top < tree.scrollTop || top + 40 > tree.scrollTop + tree.clientHeight)
      tree.scrollTop = Math.max(0, top - 5 * 40);
    requestAnimationFrame(() => {
      const element = Array.from(tree.querySelectorAll<HTMLElement>("[data-node-id]")).find(
        (row) => row.dataset.nodeId === id,
      );
      element?.focus();
    });
  };
  return (
    <div
      ref={treeRef}
      role="tree"
      aria-label={P["plan.tab.outline"]}
      className="zz-plan-tree"
      onScroll={(event) => setScroll(event.currentTarget.scrollTop)}
    >
      <div style={{ height: offset * 40 }} />
      {windowRows.map((node) => (
        <div
          key={node.id}
          role="treeitem"
          aria-level={node.level === "volume" ? 1 : node.level === "act" ? 2 : 3}
          aria-selected={selected.includes(node.id)}
          aria-expanded={node.level !== "chapter" ? expanded.has(node.id) : undefined}
          tabIndex={(selected[0] ?? visible[0]?.id) === node.id ? 0 : -1}
          draggable={!readonly}
          data-testid="outline-node"
          data-node-id={node.id}
          style={{ paddingLeft: node.level === "chapter" ? 40 : node.level === "act" ? 20 : 0 }}
          onDragStart={(event) =>
            event.dataTransfer.setData(
              "text/plain",
              JSON.stringify(selected.includes(node.id) ? selected : [node.id]),
            )
          }
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (readonly) return;
            try {
              const ids: unknown = JSON.parse(event.dataTransfer.getData("text/plain"));
              if (Array.isArray(ids) && ids.every((id) => typeof id === "string")) {
                if (ids.includes(node.id)) return;
                const peer = outline?.nodes.find((row) => row.id === ids[0]);
                const inside =
                  (peer?.level === "chapter" && node.level === "act") ||
                  (peer?.level === "act" && node.level === "volume");
                void execute([
                  {
                    type: "node.move",
                    ids,
                    parent: inside ? node.id : node.parent,
                    index: inside
                      ? 0
                      : visible
                          .filter(
                            (row) =>
                              row.parent === node.parent &&
                              row.level === node.level &&
                              !ids.includes(row.id),
                          )
                          .findIndex((row) => row.id === node.id),
                  },
                ]);
              }
            } catch {
              /* 忽略外部拖放。 */
            }
          }}
          onClick={(event) => {
            if (dirty) return;
            event.currentTarget.focus();
            setSelected(
              event.ctrlKey || event.metaKey
                ? selected.includes(node.id)
                  ? selected.filter((id) => id !== node.id)
                  : [...selected, node.id]
                : event.shiftKey && current
                  ? visible
                      .slice(
                        Math.min(visible.indexOf(current), visible.indexOf(node)),
                        Math.max(visible.indexOf(current), visible.indexOf(node)) + 1,
                      )
                      .map((row) => row.id)
                  : [node.id],
            );
          }}
          onKeyDown={(event) => {
            if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
              event.preventDefault();
              if (!readonly) move(node, event.key === "ArrowUp" ? -1 : 1);
              return;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const next =
                visible[
                  visible.findIndex((row) => row.id === node.id) +
                    (event.key === "ArrowDown" ? 1 : -1)
                ];
              if (next) {
                setSelected([next.id]);
                focusNode(next.id);
              }
            } else if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              const next = event.key === "Home" ? visible[0] : visible.at(-1);
              if (next) {
                setSelected([next.id]);
                focusNode(next.id);
              }
            } else if (event.key === "ArrowRight") {
              const children = visible.filter((row) => row.parent === node.id);
              if (children.length && !expanded.has(node.id))
                setExpanded(new Set([...expanded, node.id]));
              else if (children[0]) {
                setSelected([children[0].id]);
                focusNode(children[0].id);
              }
            } else if (event.key === "ArrowLeft") {
              if (expanded.has(node.id)) {
                setExpanded(new Set([...expanded].filter((id) => id !== node.id)));
                setSelected([node.id]);
              } else if (node.parent) {
                setSelected([node.parent]);
                focusNode(node.parent);
              }
            } else if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setSelected([node.id]);
            }
          }}
        >
          <button
            type="button"
            aria-label={P["plan.toggle"]}
            onClick={(event) => {
              event.stopPropagation();
              const next = new Set(expanded);
              if (next.has(node.id)) next.delete(node.id);
              else next.add(node.id);
              setExpanded(next);
              if (next.has(node.id)) return;
              if (
                selected.some((id) => {
                  let parent = outline?.nodes.find((row) => row.id === id)?.parent;
                  while (parent) {
                    if (parent === node.id) return true;
                    parent = outline?.nodes.find((row) => row.id === parent)?.parent;
                  }
                  return false;
                })
              )
                setSelected([node.id]);
            }}
          >
            {node.level === "chapter" ? "·" : expanded.has(node.id) ? "−" : "+"}
          </button>
          <span>
            {node.position ? `${node.position}. ` : ""}
            {node.title}
          </span>
          <small>{P[`plan.status.${node.planStatus}`]}</small>
        </div>
      ))}
      <div style={{ height: Math.max(0, visible.length - offset - windowRows.length) * 40 }} />
    </div>
  );
}

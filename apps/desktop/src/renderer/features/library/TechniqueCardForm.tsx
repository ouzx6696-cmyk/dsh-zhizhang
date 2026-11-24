import React from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { DESKTOP_COPY } from "@zhizhang/ui/copy";
import { Button } from "@zhizhang/ui/primitives";
import type { TechniqueCardView } from "@zhizhang/workbench/contract";
import { parseLineList } from "./technique-markdown";

const E = DESKTOP_COPY.techniqueEditor;
const W = DESKTOP_COPY.warehouse;

type LayerOption = NonNullable<TechniqueCardView["layer"]>;
type DimensionOption = NonNullable<TechniqueCardView["dimension"]>;

const LAYERS: readonly LayerOption[] = ["scene", "chapter", "line", "unit", "arc", "book"];
const DIMENSIONS: readonly DimensionOption[] = [
  "rhythm",
  "hook",
  "structure",
  "character",
  "prose",
  "commercial",
];

function isLayerOption(value: string): value is LayerOption {
  return LAYERS.some((item) => item === value);
}

function isDimensionOption(value: string): value is DimensionOption {
  return DIMENSIONS.some((item) => item === value);
}

/** 技法卡结构化配置表单：核心定位、执行逻辑（可调序步骤）与迁移/防抄袭红线。 */
export function TechniqueCardForm({
  draft,
  readonly,
  onPatch,
}: {
  draft: TechniqueCardView;
  readonly: boolean;
  onPatch: (patch: Partial<TechniqueCardView>) => void;
}) {
  const updateStep = (index: number, value: string) => {
    const next = [...(draft.steps ?? [])];
    next[index] = value;
    onPatch({ steps: next });
  };

  const addStep = () => {
    onPatch({ steps: [...(draft.steps ?? []), ""] });
  };

  const moveStep = (index: number, delta: -1 | 1) => {
    const list = [...(draft.steps ?? [])];
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    const item = list[index];
    list[index] = list[target];
    list[target] = item;
    onPatch({ steps: list });
  };

  const removeStep = (index: number) => {
    onPatch({ steps: (draft.steps ?? []).filter((_, i) => i !== index) });
  };

  return (
    <div className="zz-tech-editor__form" data-testid="editor-form">
      <section className="zz-tech-editor__section">
        <h3>{E.sectionCore}</h3>
        <div className="zz-tech-editor__row-2">
          <label className="zz-brief-field">
            <span>{E.labelTitle}</span>
            <input
              type="text"
              className="zz-input"
              value={draft.title}
              disabled={readonly}
              data-testid="editor-title-input"
              onChange={(e) => onPatch({ title: e.target.value })}
            />
          </label>
          <label className="zz-brief-field">
            <span>{E.labelCategory}</span>
            <input
              type="text"
              className="zz-input"
              value={draft.category}
              disabled={readonly}
              onChange={(e) => onPatch({ category: e.target.value })}
            />
          </label>
        </div>
        <div className="zz-tech-editor__row-2">
          <label className="zz-brief-field">
            <span>{E.labelLayer}</span>
            <select
              className="zz-input"
              value={draft.layer ?? "scene"}
              disabled={readonly}
              data-testid="editor-layer-select"
              onChange={(e) => {
                if (isLayerOption(e.target.value)) onPatch({ layer: e.target.value });
              }}
            >
              {LAYERS.map((layer) => (
                <option key={layer} value={layer}>
                  {W.layerLabel(layer)}
                </option>
              ))}
            </select>
          </label>
          <label className="zz-brief-field">
            <span>{E.labelDimension}</span>
            <select
              className="zz-input"
              value={draft.dimension ?? "rhythm"}
              disabled={readonly}
              onChange={(e) => {
                if (isDimensionOption(e.target.value)) onPatch({ dimension: e.target.value });
              }}
            >
              {DIMENSIONS.map((dim) => (
                <option key={dim} value={dim}>
                  {W.dimensionLabel(dim)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="zz-tech-editor__section">
        <h3>{E.sectionLogic}</h3>
        <label className="zz-brief-field">
          <span>{E.labelPattern}</span>
          <textarea
            className="zz-textarea"
            rows={3}
            value={draft.pattern}
            disabled={readonly}
            data-testid="editor-pattern-input"
            onChange={(e) => onPatch({ pattern: e.target.value })}
          />
        </label>
        <div className="zz-tech-editor__row-2">
          <label className="zz-brief-field">
            <span>{E.labelEmotionArc}</span>
            <input
              type="text"
              className="zz-input"
              value={draft.emotionArc ?? ""}
              disabled={readonly}
              onChange={(e) => onPatch({ emotionArc: e.target.value })}
            />
          </label>
          <label className="zz-brief-field">
            <span>{E.labelReaderWant}</span>
            <input
              type="text"
              className="zz-input"
              value={draft.readerWant ?? ""}
              disabled={readonly}
              onChange={(e) => onPatch({ readerWant: e.target.value })}
            />
          </label>
        </div>
        <div className="zz-tech-editor__steps">
          <div className="zz-tech-editor__steps-head">
            <span>{E.labelSteps}</span>
            <Button size="sm" variant="ghost" disabled={readonly} onClick={addStep}>
              <Plus size={12} aria-hidden="true" />
              {E.addStep}
            </Button>
          </div>
          {(draft.steps ?? []).map((step, idx) => (
            <div key={`step-row-${idx}`} className="zz-tech-editor__step-row">
              <span className="zz-tech-editor__step-num">{idx + 1}</span>
              <input
                type="text"
                className="zz-input"
                value={step}
                disabled={readonly}
                placeholder={E.stepPlaceholder}
                onChange={(e) => updateStep(idx, e.target.value)}
              />
              <button
                type="button"
                className="zz-icon-btn zz-icon-btn--sm zz-btn--ghost"
                disabled={readonly || idx === 0}
                aria-label={E.labelSteps}
                onClick={() => moveStep(idx, -1)}
              >
                <ArrowUp size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="zz-icon-btn zz-icon-btn--sm zz-btn--ghost"
                disabled={readonly || idx === (draft.steps?.length ?? 1) - 1}
                aria-label={E.labelSteps}
                onClick={() => moveStep(idx, 1)}
              >
                <ArrowDown size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="zz-icon-btn zz-icon-btn--sm zz-btn--ghost"
                disabled={readonly}
                aria-label={E.deleteCard}
                onClick={() => removeStep(idx)}
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="zz-tech-editor__section">
        <h3>{E.sectionGuard}</h3>
        <div className="zz-tech-editor__row-2">
          <label className="zz-brief-field">
            <span>{E.labelTransfer}</span>
            <textarea
              className="zz-textarea"
              rows={2}
              value={draft.transfer ?? ""}
              disabled={readonly}
              onChange={(e) => onPatch({ transfer: e.target.value })}
            />
          </label>
          <label className="zz-brief-field">
            <span>{E.labelUsage}</span>
            <textarea
              className="zz-textarea"
              rows={2}
              value={draft.usage}
              disabled={readonly}
              onChange={(e) => onPatch({ usage: e.target.value })}
            />
          </label>
        </div>
        <div className="zz-tech-editor__row-2">
          <label className="zz-brief-field">
            <span>{E.labelMustNotCopy}</span>
            <textarea
              className="zz-textarea"
              rows={2}
              value={(draft.mustNotCopy ?? []).join("\n")}
              disabled={readonly}
              onChange={(e) => onPatch({ mustNotCopy: parseLineList(e.target.value) })}
            />
          </label>
          <label className="zz-brief-field">
            <span>{E.labelFailWhen}</span>
            <textarea
              className="zz-textarea"
              rows={2}
              value={draft.failWhen ?? ""}
              disabled={readonly}
              onChange={(e) => onPatch({ failWhen: e.target.value })}
            />
          </label>
        </div>
        <label className="zz-brief-field">
          <span>{E.labelExample}</span>
          <textarea
            className="zz-textarea"
            rows={2}
            value={draft.example}
            disabled={readonly}
            onChange={(e) => onPatch({ example: e.target.value })}
          />
        </label>
      </section>
    </div>
  );
}

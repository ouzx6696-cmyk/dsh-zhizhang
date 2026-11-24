import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Plus, Save, Trash2 } from "lucide-react";
import { DESKTOP_COPY } from "@zhizhang/ui/copy";
import { notify } from "@zhizhang/ui/notify";
import { Button } from "@zhizhang/ui/primitives";
import type { TechniqueCardView } from "@zhizhang/workbench/contract";
import { askConfirm } from "../../state/confirm";
import { desktop } from "../../state/desktop";
import { useDesktop } from "../../state/store";
import { notifyError } from "../../format";
import { MarkdownPreview } from "./MarkdownPreview";
import { TechniqueCardForm } from "./TechniqueCardForm";
import {
  cardInjectionTier,
  createEmptyTechniqueCard,
  techniqueCardToMarkdown,
} from "./technique-markdown";

const C = DESKTOP_COPY;
const E = C.techniqueEditor;
const W = C.warehouse;

type ViewMode = "edit" | "split" | "preview";

interface SourceRow {
  id: string;
  title: string;
  cardCount: number;
}

function starterDraft(): TechniqueCardView {
  return createEmptyTechniqueCard(0, {
    title: E.newCardTitle,
    category: E.newCardCategory,
  });
}

/** 交互式拆书技法编辑器：左侧直观配置结构层级/步骤/防抄袭红线，右侧实时 Markdown 渲染逻辑结构。 */
export function TechniqueEditorPanel({
  initialSourceId = "",
  initialCardId = "",
}: {
  initialSourceId?: string;
  initialCardId?: string;
}) {
  const libraryRoot = useDesktop((s) => s.workspace?.roots.library ?? "");
  const readonly = useDesktop((s) => Boolean(s.workspace?.readonly));
  const revision = useDesktop((s) => s.revisions.library);

  const [sources, setSources] = useState<SourceRow[]>([]);
  const [sourceId, setSourceId] = useState(initialSourceId);
  const [cards, setCards] = useState<TechniqueCardView[]>([]);
  const [selectedCardId, setSelectedCardId] = useState(initialCardId);
  const selectedCardIdRef = React.useRef(selectedCardId);
  selectedCardIdRef.current = selectedCardId;
  const [draft, setDraft] = useState<TechniqueCardView>(() => starterDraft());
  const [dirty, setDirty] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (initialSourceId) setSourceId(initialSourceId);
  }, [initialSourceId]);

  useEffect(() => {
    if (initialCardId) {
      selectedCardIdRef.current = initialCardId;
      setSelectedCardId(initialCardId);
    }
  }, [initialCardId]);

  const loadSources = useCallback(async () => {
    if (!libraryRoot) return;
    try {
      const res = await desktop.workbench("library.list", { libraryRoot });
      setSources(res.sources);
      setSourceId((prev) => {
        if (prev && res.sources.some((s) => s.id === prev)) return prev;
        return res.sources[0]?.id ?? "";
      });
    } catch (err) {
      notifyError(err);
    }
  }, [libraryRoot]);

  useEffect(() => {
    void loadSources();
  }, [loadSources, revision]);

  const loadCards = useCallback(async () => {
    if (!libraryRoot || !sourceId) {
      setCards([]);
      return;
    }
    try {
      const res = await desktop.workbench("library.cards", { libraryRoot, sourceId });
      setCards(res.cards);
      if (res.cards.length > 0) {
        const picked = res.cards.find((c) => c.id === selectedCardIdRef.current) ?? res.cards[0];
        selectedCardIdRef.current = picked.id;
        setSelectedCardId(picked.id);
        setDraft(picked);
        setDirty(false);
      } else {
        const fresh = starterDraft();
        selectedCardIdRef.current = fresh.id;
        setSelectedCardId(fresh.id);
        setDraft(fresh);
        setDirty(false);
      }
    } catch (err) {
      notifyError(err);
    }
  }, [libraryRoot, sourceId]);

  useEffect(() => {
    void loadCards();
  }, [loadCards, revision]);

  const selectCard = (id: string) => {
    const found = cards.find((c) => c.id === id);
    if (!found) return;
    setSelectedCardId(found.id);
    setDraft(found);
    setDirty(false);
  };

  const patchDraft = (patch: Partial<TechniqueCardView>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const createNewCard = () => {
    const fresh = createEmptyTechniqueCard(cards.length, {
      title: E.newCardTitle,
      category: E.newCardCategory,
    });
    setSelectedCardId(fresh.id);
    setDraft(fresh);
    setDirty(true);
  };

  const markdown = useMemo(
    () =>
      techniqueCardToMarkdown(draft, {
        layerLabel: W.layerLabel,
        dimensionLabel: W.dimensionLabel,
        quoteStatusLabel: W.quoteStatusLabel,
        tierL2: E.tierL2,
        tierL6: E.tierL6,
        metaTier: E.markdownMetaTier,
        metaLayer: E.markdownMetaLayer,
        metaDimension: E.markdownMetaDimension,
        metaQuote: E.markdownMetaQuote,
        secPattern: E.markdownSecPattern,
        secSteps: E.markdownSecSteps,
        secTransfer: E.markdownSecTransfer,
        secGuard: E.markdownSecGuard,
        secExample: E.markdownSecExample,
        fieldEmotionArc: W.fieldEmotionArc,
        fieldReaderWant: E.labelReaderWant,
        fieldDramaticUnit: E.labelDramaticUnit,
        fieldTransfer: W.fieldTransfer,
        fieldUsage: W.fieldUsage,
        fieldFailWhen: W.fieldFailWhen,
        fieldMustNotCopy: W.fieldMustNotCopy,
        fieldBannedDiction: E.labelBannedDiction,
      }),
    [draft],
  );

  const saveCard = async () => {
    if (!libraryRoot || !draft.title.trim() || !draft.pattern.trim()) return;
    setBusy("save");
    try {
      let targetSource = sourceId;
      if (!targetSource) {
        targetSource = "custom-techniques";
        await desktop.workbench("library.import", {
          libraryRoot,
          id: targetSource,
          title: E.newCardTitle,
          content: draft.example.trim() || draft.pattern.trim(),
        });
        setSourceId(targetSource);
      }
      const cleanedSteps = (draft.steps ?? []).map((s) => s.trim()).filter(Boolean);
      const cleanedGuard = (draft.mustNotCopy ?? []).map((s) => s.trim()).filter(Boolean);
      const cleanedReplaceables = (draft.replaceables ?? []).map((s) => s.trim()).filter(Boolean);
      const cleanedBanned = (draft.bannedDiction ?? []).map((s) => s.trim()).filter(Boolean);
      const normalized: TechniqueCardView = {
        ...draft,
        title: draft.title.trim(),
        category: draft.category.trim() || E.newCardCategory,
        pattern: draft.pattern.trim(),
        example: draft.example.trim(),
        usage: draft.usage.trim(),
        steps: cleanedSteps.length > 0 ? cleanedSteps : undefined,
        mustNotCopy: cleanedGuard.length > 0 ? cleanedGuard : undefined,
        replaceables: cleanedReplaceables.length > 0 ? cleanedReplaceables : undefined,
        bannedDiction: cleanedBanned.length > 0 ? cleanedBanned : undefined,
      };
      const exists = cards.some((c) => c.id === normalized.id);
      const nextList = exists
        ? cards.map((c) => (c.id === normalized.id ? normalized : c))
        : [...cards, normalized];
      const saved = await desktop.workbench("library.cards.save", {
        libraryRoot,
        sourceId: targetSource,
        cards: nextList,
      });
      setCards(saved.cards);
      const updated = saved.cards.find((c) => c.id === normalized.id) ?? normalized;
      setDraft(updated);
      setSelectedCardId(updated.id);
      setDirty(false);
      notify({ tone: "success", text: E.savedCard });
      await loadSources();
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy("");
    }
  };

  const deleteCard = async () => {
    if (!libraryRoot || !sourceId || !cards.some((c) => c.id === draft.id)) return;
    if (!(await askConfirm(E.deleteConfirm))) return;
    setBusy("delete");
    try {
      const remaining = cards.filter((c) => c.id !== draft.id);
      const saved = await desktop.workbench("library.cards.save", {
        libraryRoot,
        sourceId,
        cards: remaining,
      });
      setCards(saved.cards);
      const next = saved.cards[0] ?? starterDraft();
      setDraft(next);
      setSelectedCardId(next.id);
      setDirty(false);
      await loadSources();
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy("");
    }
  };

  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      notify({ tone: "success", text: E.copiedMarkdown });
    } catch (err) {
      notifyError(err);
    }
  };

  const tier = cardInjectionTier(draft.layer);
  const canSave =
    !readonly && busy === "" && draft.title.trim().length > 0 && draft.pattern.trim().length > 0;

  return (
    <div className="zz-tech-editor" data-testid="technique-editor">
      <div className="zz-tech-editor__toolbar">
        <div className="zz-tech-editor__pickers">
          {sources.length > 0 ? (
            <label className="zz-tech-editor__picker">
              <span>{E.selectSource}</span>
              <select
                className="zz-input zz-tech-editor__select"
                value={sourceId}
                data-testid="editor-source-select"
                onChange={(e) => {
                  setSourceId(e.target.value);
                  setSelectedCardId("");
                }}
              >
                {sources.map((src) => (
                  <option key={src.id} value={src.id}>
                    {src.title} ({src.cardCount})
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {cards.length > 0 ? (
            <label className="zz-tech-editor__picker">
              <span>{E.selectCard}</span>
              <select
                className="zz-input zz-tech-editor__select"
                value={selectedCardId}
                data-testid="editor-card-select"
                onChange={(e) => selectCard(e.target.value)}
              >
                {cards.map((card) => (
                  <option key={card.id} value={card.id}>
                    {card.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <Button
            size="sm"
            variant="ghost"
            disabled={readonly}
            data-testid="editor-new-card"
            onClick={createNewCard}
          >
            <Plus size={13} aria-hidden="true" />
            {W.newCard}
          </Button>
        </div>

        <div className="zz-tech-editor__actions">
          <div className="zz-filter-bar" role="group" aria-label={E.previewTitle}>
            {(
              [
                ["edit", W.modeEdit],
                ["split", W.modeSplit],
                ["preview", W.modePreview],
              ] as const
            ).map(([modeId, label]) => (
              <button
                key={modeId}
                type="button"
                className="zz-filter-btn"
                aria-pressed={viewMode === modeId}
                data-testid={`editor-mode-${modeId}`}
                onClick={() => setViewMode(modeId)}
              >
                {label}
              </button>
            ))}
          </div>

          <Button size="sm" variant="ghost" onClick={() => void copyMarkdown()}>
            <Copy size={13} aria-hidden="true" />
            {E.copyMarkdown}
          </Button>
          {cards.some((c) => c.id === draft.id) ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={readonly || busy !== ""}
              onClick={() => void deleteCard()}
            >
              <Trash2 size={13} aria-hidden="true" />
              {E.deleteCard}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="primary"
            loading={busy === "save"}
            disabled={!canSave}
            data-testid="editor-save-card"
            onClick={() => void saveCard()}
          >
            <Save size={13} aria-hidden="true" />
            {E.saveCard}
          </Button>
        </div>
      </div>

      <div className="zz-tech-editor__tier" data-tier={tier}>
        <strong>{tier === "l2-craft" ? E.tierL2 : E.tierL6}</strong>
        {dirty ? <span className="zz-tech-editor__dirty">{E.unsavedTag}</span> : null}
      </div>

      <div className="zz-tech-editor__panes" data-mode={viewMode}>
        {viewMode !== "preview" ? (
          <TechniqueCardForm draft={draft} readonly={readonly} onPatch={patchDraft} />
        ) : null}

        {viewMode !== "edit" ? (
          <aside className="zz-tech-editor__preview" aria-label={E.previewTitle}>
            <header className="zz-tech-editor__preview-head">
              <strong>{E.previewTitle}</strong>
              <span className="zz-muted">{draft.id}</span>
            </header>
            <div className="zz-tech-editor__preview-body">
              <MarkdownPreview content={markdown} />
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

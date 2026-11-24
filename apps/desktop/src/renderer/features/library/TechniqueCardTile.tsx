import React from "react";
import { PencilLine } from "lucide-react";
import { DESKTOP_COPY } from "@zhizhang/ui/copy";
import { Button } from "@zhizhang/ui/primitives";
import type { TechniqueCardView } from "@zhizhang/workbench/contract";

const W = DESKTOP_COPY.warehouse;

/** 单张拆书技法卡展示瓦片：层级、情绪弧、步骤、引文核验、迁移与防抄袭红线。 */
export function TechniqueCardTile({
  card,
  sourceId,
  readonly,
  busy,
  hasChapter,
  onEdit,
  onBind,
}: {
  card: TechniqueCardView;
  sourceId: string;
  readonly: boolean;
  busy: boolean;
  hasChapter: boolean;
  onEdit?: (sourceId: string, cardId: string) => void;
  onBind: (scope: "work" | "chapter", cardIds: string[]) => void;
}) {
  const layerText = card.layer ? W.layerLabel(card.layer) : "";
  const dimText = card.dimension ? W.dimensionLabel(card.dimension) : "";
  const quoteStatusText = card.quoteStatus ? W.quoteStatusLabel(card.quoteStatus) : "";
  const kickerParts = [card.category, layerText, dimText].filter(Boolean);

  return (
    <article className="zz-entity-card zz-tech-card">
      <header className="zz-tech-card__head">
        <span className="zz-tech-card__kicker">{kickerParts.join(" · ")}</span>
        {quoteStatusText ? (
          <span className="zz-tech-card__quote-status" data-status={card.quoteStatus}>
            {quoteStatusText}
          </span>
        ) : null}
      </header>
      <h4 className="zz-tech-card__title">{card.title}</h4>
      <p className="zz-tech-card__pattern">{card.pattern}</p>
      {card.emotionArc ? (
        <p className="zz-tech-card__row">
          <span className="zz-tech-card__label">{W.fieldEmotionArc}</span>
          <span>{card.emotionArc}</span>
        </p>
      ) : null}
      {card.steps && card.steps.length > 0 ? (
        <div className="zz-tech-card__block">
          <span className="zz-tech-card__label">{W.fieldSteps}</span>
          <ol className="zz-tech-card__steps">
            {card.steps.map((step, idx) => (
              <li key={`${card.id}-step-${idx}`}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {card.example ? (
        <blockquote className="zz-tech-card__quote">{card.example}</blockquote>
      ) : null}
      {card.transfer ? (
        <p className="zz-tech-card__row">
          <span className="zz-tech-card__label">{W.fieldTransfer}</span>
          <span>{card.transfer}</span>
        </p>
      ) : null}
      {card.mustNotCopy && card.mustNotCopy.length > 0 ? (
        <p className="zz-tech-card__row zz-tech-card__guard">
          <span className="zz-tech-card__label">{W.fieldMustNotCopy}</span>
          <span>{card.mustNotCopy.join("；")}</span>
        </p>
      ) : null}
      {card.failWhen ? (
        <p className="zz-tech-card__row">
          <span className="zz-tech-card__label">{W.fieldFailWhen}</span>
          <span>{card.failWhen}</span>
        </p>
      ) : null}
      {card.usage ? (
        <p className="zz-tech-card__row">
          <span className="zz-tech-card__label">{W.fieldUsage}</span>
          <span>{card.usage}</span>
        </p>
      ) : null}
      <footer className="zz-tech-card__foot">
        {onEdit ? (
          <Button size="sm" variant="ghost" onClick={() => onEdit(sourceId, card.id)}>
            <PencilLine size={12} aria-hidden="true" />
            {W.editCard}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          disabled={readonly || busy}
          onClick={() => onBind("work", [card.id])}
        >
          {W.bindToWork}
        </Button>
        {hasChapter ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={readonly || busy}
            onClick={() => onBind("chapter", [card.id])}
          >
            {W.bindToChapter}
          </Button>
        ) : null}
      </footer>
    </article>
  );
}

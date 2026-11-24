import React, { useState } from "react";
import { Play, X } from "lucide-react";
import { DESKTOP_COPY } from "@zhizhang/ui/copy";
import { notify } from "@zhizhang/ui/notify";
import { Button, IconButton } from "@zhizhang/ui/primitives";
import type { Target } from "../../../shared/views";
import { openPipeline } from "../../state/controller";
import { desktop } from "../../state/desktop";
import { notifyError } from "../../format";

const C = DESKTOP_COPY;

function linesOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** 结构化写作任务单：把作者确认的核心目标、分场节拍、保留句与规避清单直接下发至章节流水线。 */
export function BriefDrawer({
  target,
  chapterId,
  initialKeep,
  disabled,
  onClose,
}: {
  target: Target;
  chapterId: string;
  initialKeep?: string;
  disabled: boolean;
  onClose: () => void;
}) {
  const [goal, setGoal] = useState("");
  const [beats, setBeats] = useState("");
  const [keep, setKeep] = useState(initialKeep ?? "");
  const [avoid, setAvoid] = useState("");
  const [busy, setBusy] = useState(false);

  const launch = async () => {
    if (!chapterId) return;
    setBusy(true);
    try {
      const agreedBeats = linesOf(beats);
      const mustKeepQuotes = linesOf(keep);
      const avoidPatterns = linesOf(avoid);
      const brief = {
        ...(goal.trim() ? { goal: goal.trim() } : {}),
        ...(agreedBeats.length ? { agreedBeats } : {}),
        ...(mustKeepQuotes.length ? { mustKeepQuotes } : {}),
        ...(avoidPatterns.length ? { avoidPatterns } : {}),
      };
      await desktop.startRun(target, {
        kind: "fanqie.chapter",
        request: {
          chapterId,
          ...(Object.keys(brief).length ? { brief } : {}),
        },
      });
      notify({ tone: "success", text: C.cowriter.briefLaunched });
      openPipeline(chapterId);
      onClose();
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="zz-brief-drawer" data-testid="agent-brief-drawer">
      <header className="zz-brief-drawer__head">
        <strong>{C.cowriter.briefTitle}</strong>
        <IconButton size="sm" label={C.dock.close} icon={<X size={13} />} onClick={onClose} />
      </header>
      <label className="zz-brief-field">
        <span>{C.cowriter.briefGoal}</span>
        <input
          type="text"
          className="zz-input"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
        />
      </label>
      <label className="zz-brief-field">
        <span>{C.cowriter.briefBeats}</span>
        <textarea
          className="zz-textarea"
          rows={2}
          value={beats}
          onChange={(e) => setBeats(e.target.value)}
        />
      </label>
      <label className="zz-brief-field">
        <span>{C.cowriter.briefKeep}</span>
        <textarea
          className="zz-textarea"
          rows={2}
          value={keep}
          onChange={(e) => setKeep(e.target.value)}
        />
      </label>
      <label className="zz-brief-field">
        <span>{C.cowriter.briefAvoid}</span>
        <textarea
          className="zz-textarea"
          rows={2}
          value={avoid}
          onChange={(e) => setAvoid(e.target.value)}
        />
      </label>
      <Button
        size="sm"
        variant="primary"
        loading={busy}
        disabled={disabled || !chapterId}
        onClick={() => void launch()}
      >
        <Play size={12} aria-hidden="true" />
        {C.cowriter.briefLaunch}
      </Button>
    </section>
  );
}

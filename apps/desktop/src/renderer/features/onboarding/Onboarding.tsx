import React, { useState } from "react";
import { BookOpen, Check, Newspaper } from "lucide-react";
import { COPY, DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Brand, Button, Dialog } from "@zhizhang/ui/primitives";
import { chooseWorkspace, modelReady, startCreate } from "../../state/controller";
import { desktopStore, useDesktop } from "../../state/store";
import { run } from "../../format";
import { ConnectionForm } from "../settings/ConnectionForm";

type Step = "workspace" | "model" | "start";
const STEPS: Step[] = ["workspace", "model", "start"];

function StepRail({ step }: { step: Step }) {
  const index = STEPS.indexOf(step);
  return (
    <ol className="zz-onboarding__steps" aria-label={C.onboarding.stepOf(index + 1, STEPS.length)}>
      {STEPS.map((s, i) => {
        const state = i < index ? "done" : i === index ? "current" : "todo";
        return (
          <li key={s} data-state={state} aria-current={state === "current" ? "step" : undefined}>
            <span className="zz-onboarding__dot">
              {state === "done" ? <Check size={12} aria-hidden="true" /> : i + 1}
            </span>
            <span>{C.onboarding.steps[s]}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** 首启三步（全窗口）：写作文件夹 → 连接模型 → 第一部作品；每步都可“稍后再说”。 */
export function Onboarding() {
  const workspace = useDesktop((s) => s.workspace);
  const settings = useDesktop((s) => s.settings);
  const [step, setStep] = useState<Step>(() =>
    !workspace?.configured ? "workspace" : !modelReady(settings) ? "model" : "start",
  );
  const finish = () => desktopStore.set({ onboarding: false });
  return (
    <Dialog
      title={C.onboarding.title}
      testId="onboarding"
      className="zz-onboarding"
      onClose={finish}
    >
      <div className="zz-onboarding__inner">
        <header className="zz-onboarding__brand">
          <Brand label={COPY["app.name"]} className="zz-brand--lg" />
          <h1>{C.onboarding.brand}</h1>
          <p>{C.onboarding.tagline}</p>
        </header>
        <StepRail step={step} />
        <div className="zz-onboarding__card">
          {step === "workspace" ? (
            <section className="zz-onboarding__step" data-testid="onboarding-step-workspace">
              <h2>{C.onboarding.workspaceTitle}</h2>
              <p className="zz-onboarding__hint">{C.onboarding.workspaceHint}</p>
              <div className="zz-onboarding__path">
                <p
                  data-testid="onboarding-workspace-path"
                  data-configured={Boolean(workspace?.configured)}
                >
                  {workspace?.configured ? workspace.root : C.workspace.notSet}
                </p>
                <Button
                  size="sm"
                  data-testid="onboarding-choose-workspace"
                  variant={workspace?.configured ? "secondary" : "strong"}
                  onClick={() => run(chooseWorkspace)}
                >
                  {workspace?.configured ? C.workspace.change : C.workspace.choose}
                </Button>
              </div>
              <footer className="zz-onboarding__foot">
                <Button variant="ghost" onClick={finish}>
                  {C.onboarding.later}
                </Button>
                <Button
                  variant="strong"
                  data-testid="onboarding-next"
                  disabled={!workspace?.configured}
                  onClick={() => setStep(modelReady(settings) ? "start" : "model")}
                >
                  {C.onboarding.next}
                </Button>
              </footer>
            </section>
          ) : null}
          {step === "model" && settings ? (
            <section className="zz-onboarding__step" data-testid="onboarding-step-model">
              <h2>{C.onboarding.modelTitle}</h2>
              <p className="zz-onboarding__hint">{C.onboarding.modelHint}</p>
              <ConnectionForm
                settings={settings}
                submitLabel={C.onboarding.saveModel}
                onSaved={() => setStep("start")}
              />
              <footer className="zz-onboarding__foot zz-onboarding__foot--start">
                <Button
                  variant="ghost"
                  data-testid="onboarding-skip-model"
                  onClick={() => setStep("start")}
                >
                  {C.onboarding.later}
                </Button>
              </footer>
            </section>
          ) : null}
          {step === "start" ? (
            <section className="zz-onboarding__step" data-testid="onboarding-step-start">
              <h2>{C.onboarding.startTitle}</h2>
              <div className="zz-mode-cards">
                <button
                  type="button"
                  className="zz-mode-card"
                  data-testid="onboarding-new-work"
                  disabled={!workspace?.configured}
                  onClick={() => {
                    finish();
                    startCreate("fanqie");
                  }}
                >
                  <BookOpen size={20} aria-hidden="true" />
                  <strong>{C.create.newWork}</strong>
                  <span>{C.onboarding.newWorkHint}</span>
                </button>
                <button
                  type="button"
                  className="zz-mode-card"
                  data-testid="onboarding-new-article"
                  disabled={!workspace?.configured}
                  onClick={() => {
                    finish();
                    startCreate("toutiao");
                  }}
                >
                  <Newspaper size={20} aria-hidden="true" />
                  <strong>{C.create.newArticle}</strong>
                  <span>{C.onboarding.newArticleHint}</span>
                </button>
              </div>
              <footer className="zz-onboarding__foot">
                <Button variant="ghost" data-testid="onboarding-finish" onClick={finish}>
                  {C.onboarding.later}
                </Button>
              </footer>
            </section>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}

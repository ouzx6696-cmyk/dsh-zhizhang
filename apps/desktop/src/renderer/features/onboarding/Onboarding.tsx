import React, { useState } from "react";
import { COPY, DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Button, Dialog, Steps } from "@zhizhang/ui/primitives";
import { chooseWorkspace, modelReady, startCreate } from "../../state/controller";
import { desktopStore, useDesktop } from "../../state/store";
import { run } from "../../format";
import { ConnectionForm } from "../settings/ConnectionForm";

type Step = "workspace" | "model" | "start";
const STEPS: Step[] = ["workspace", "model", "start"];

/** 首启三步：写作文件夹 → 连接模型 → 第一部作品；每步都可“稍后再说”。 */
export function Onboarding() {
  const workspace = useDesktop((s) => s.workspace);
  const settings = useDesktop((s) => s.settings);
  const [step, setStep] = useState<Step>(() =>
    !workspace?.configured ? "workspace" : !modelReady(settings) ? "model" : "start",
  );
  const finish = () => desktopStore.set({ onboarding: false });
  const index = STEPS.indexOf(step);
  return (
    <Dialog
      title={C.onboarding.title}
      closeLabel={C.onboarding.later}
      size="lg"
      testId="onboarding"
      className="zz-onboarding"
      onClose={finish}
    >
      <p className="zz-muted">{C.onboarding.lead}</p>
      <Steps
        steps={STEPS.map((s) => C.onboarding.steps[s])}
        current={index}
        label={C.onboarding.title}
      />
      {step === "workspace" ? (
        <section className="zz-stack" data-testid="onboarding-step-workspace">
          <h3>{C.onboarding.workspaceTitle}</h3>
          <p>{C.onboarding.workspaceHint}</p>
          <p
            data-testid="onboarding-workspace-path"
            data-configured={Boolean(workspace?.configured)}
          >
            {workspace?.configured ? workspace.root : C.workspace.notSet}
          </p>
          <div className="zz-row">
            <Button
              data-testid="onboarding-choose-workspace"
              variant={workspace?.configured ? "secondary" : "primary"}
              onClick={() => run(chooseWorkspace)}
            >
              {workspace?.configured ? C.workspace.change : C.workspace.choose}
            </Button>
            <Button
              variant="primary"
              data-testid="onboarding-next"
              disabled={!workspace?.configured}
              onClick={() => setStep(modelReady(settings) ? "start" : "model")}
            >
              {C.onboarding.next}
            </Button>
          </div>
        </section>
      ) : null}
      {step === "model" && settings ? (
        <section className="zz-stack" data-testid="onboarding-step-model">
          <h3>{C.onboarding.modelTitle}</h3>
          <p>{C.onboarding.modelHint}</p>
          <ConnectionForm
            settings={settings}
            submitLabel={C.onboarding.saveModel}
            onSaved={() => setStep("start")}
          />
          <Button
            variant="ghost"
            data-testid="onboarding-skip-model"
            onClick={() => setStep("start")}
          >
            {C.onboarding.later}
          </Button>
        </section>
      ) : null}
      {step === "start" ? (
        <section className="zz-stack" data-testid="onboarding-step-start">
          <h3>{C.onboarding.startTitle}</h3>
          <div className="zz-row">
            <Button
              variant="primary"
              data-testid="onboarding-new-work"
              disabled={!workspace?.configured}
              onClick={() => {
                finish();
                startCreate("fanqie");
              }}
            >
              {C.create.newWork}
            </Button>
            <Button
              data-testid="onboarding-new-article"
              disabled={!workspace?.configured}
              onClick={() => {
                finish();
                startCreate("toutiao");
              }}
            >
              {C.create.newArticle}
            </Button>
            <Button variant="ghost" data-testid="onboarding-finish" onClick={finish}>
              {COPY.close}
            </Button>
          </div>
        </section>
      ) : null}
    </Dialog>
  );
}

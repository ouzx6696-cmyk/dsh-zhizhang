import { COPY as viewCopy } from "../../../../../../packages/ui/src/copy.js";
import { useConnectionTest } from "../settings/useConnectionTest";
import { Dialog, Brand } from "../../../../../../packages/ui/src/primitives";
import React, { useState } from "react";
import { ArrowRight, BookOpen, Check, Feather } from "lucide-react";
import { ModelFields } from "../settings/ModelFields";
import type { DesktopController } from "../../app/useDesktopController";
import { desktop } from "../../state/desktop";

export function Onboarding({ app }: { app: DesktopController }) {
  const { state, fail, set } = app;
  const [followWriter, setFollowWriter] = useState(true);
  const { results, run: testConnection } = useConnectionTest();
  const wizardModels = state.wizardModels;
  const writer = wizardModels?.writer;
  if (!wizardModels || !writer) return null;
  return (
    <Dialog
      title={viewCopy.onboardingText1}
      className="onboarding"
      onClose={() => set({ onboarding: false })}
    >
      <div className="onboarding-brand">
        <Brand />
        <h1>{viewCopy.ttAgent}</h1>
        <p>{viewCopy.onboardingText2}</p>
      </div>
      <ol className="onboarding-steps">
        {[viewCopy.onboardingText3, viewCopy.onboardingText4, viewCopy.onboardingText1].map(
          (label, index) => (
            <li key={label} data-active={state.wizardStep === index}>
              {index < state.wizardStep ? <Check size={13} /> : index + 1} {label}
            </li>
          ),
        )}
      </ol>
      {state.wizardStep === 0 && (
        <>
          <ModelFields
            role="writer"
            model={writer}
            onChange={(value) => set({ wizardModels: { ...wizardModels, writer: value } })}
            onTest={() => void testConnection("writer", writer)}
            result={results.writer}
          />
          <label className="checkbox">
            <input
              type="checkbox"
              checked={followWriter}
              onChange={(e) => setFollowWriter(e.target.checked)}
            />
            {viewCopy.onboardingText5}
          </label>
          {!followWriter && (
            <ModelFields
              role="editor"
              model={wizardModels.editor}
              onChange={(editor) => set({ wizardModels: { ...wizardModels, editor } })}
              result={results.editor}
              onTest={() => void testConnection("editor", wizardModels.editor)}
            />
          )}
          <button
            className="primary"
            onClick={async () => {
              try {
                if (!writer.apiKey && !writer.configured && !writer.keyless)
                  throw new Error(viewCopy.onboardingText6);
                await desktop.model({
                  ...wizardModels,
                  editor: followWriter ? { ...writer } : wizardModels.editor,
                });
                await app.syncState();
                set({ wizardStep: 1 });
              } catch (error) {
                fail(error);
              }
            }}
          >
            {viewCopy.onboardingText7}
            <ArrowRight size={14} />
          </button>
        </>
      )}
      {state.wizardStep === 1 && (
        <div className="wizard-root">
          <h2>{viewCopy.onboardingText8}</h2>
          <p>{viewCopy.onboardingText9}</p>
          <button
            className="primary"
            onClick={async () => {
              try {
                await app.chooseWorkspace();
                const value = await app.syncState();
                if (value.workspace) set({ wizardStep: 2 });
              } catch (error) {
                fail(error);
              }
            }}
          >
            {viewCopy.onboardingText10}
            <ArrowRight size={14} />
          </button>
        </div>
      )}
      {state.wizardStep === 2 && (
        <div className="start-options">
          <button onClick={() => app.newWork("fanqie").catch(fail)}>
            <BookOpen />
            {viewCopy.onboardingText11}
          </button>
          <button onClick={() => app.newWork("toutiao").catch(fail)}>
            <Feather />
            {viewCopy.onboardingText12}
          </button>
          <button
            onClick={() => {
              set({ picker: true, onboarding: false });
            }}
          >
            {viewCopy.onboardingText13}
          </button>
        </div>
      )}
    </Dialog>
  );
}

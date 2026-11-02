import { Dialog, Brand } from "../../../../../../packages/ui/src/primitives";
import React, { useState } from "react";
import { ArrowRight, BookOpen, Check, Feather } from "lucide-react";
import { ModelFields } from "../settings/ModelFields";
import type { DesktopController } from "../../app/useDesktopController";
import { desktop } from "../../state/desktop";
import type { ConnectionResult } from "../../state/store";

export function Onboarding({ app }: { app: DesktopController }) {
  const { state, fail, set } = app;
  const [followWriter, setFollowWriter] = useState(true);
  const [editorResult, setEditorResult] = useState<ConnectionResult>(null);
  const wizardModels = state.wizardModels;
  const writer = wizardModels?.writer;
  if (!wizardModels || !writer) return null;
  return (
    <Dialog title="开始创作" className="onboarding" onClose={() => set({ onboarding: false })}>
      <div className="onboarding-brand">
        <Brand />
        <h1>写作 Agent</h1>
        <p>把想法写成作品，让决定留在你手中。</p>
      </div>
      <ol className="onboarding-steps">
        {["连接模型", "选择写作文件夹", "开始创作"].map((label, index) => (
          <li key={label} data-active={state.wizardStep === index}>
            {index < state.wizardStep ? <Check size={13} /> : index + 1} {label}
          </li>
        ))}
      </ol>
      {state.wizardStep === 0 && (
        <>
          <ModelFields
            role="writer"
            model={writer}
            onChange={(value) =>
              set((current) => ({
                wizardModels: { ...current.wizardModels!, writer: value },
              }))
            }
            onTest={async () => {
              set({ connectionResult: { busy: true } });
              try {
                set({
                  connectionResult: await desktop.testModel("writer", writer),
                });
              } catch (error) {
                set({
                  connectionResult: {
                    error: error instanceof Error ? error.message : String(error),
                  },
                });
              }
            }}
            result={state.connectionResult}
          />
          <label className="checkbox">
            <input
              type="checkbox"
              checked={followWriter}
              onChange={(e) => setFollowWriter(e.target.checked)}
            />
            编辑沿用写手连接（保持独立对话）
          </label>
          {!followWriter && (
            <ModelFields
              role="editor"
              model={wizardModels.editor}
              onChange={(editor) => set({ wizardModels: { ...wizardModels, editor } })}
              result={editorResult}
              onTest={async () => {
                setEditorResult({ busy: true });
                try {
                  setEditorResult(await desktop.testModel("editor", wizardModels.editor!));
                } catch (error) {
                  setEditorResult({
                    error: error instanceof Error ? error.message : String(error),
                  });
                }
              }}
            />
          )}
          <button
            className="primary"
            onClick={async () => {
              try {
                if (!writer.apiKey && !writer.configured && !writer.keyless)
                  throw new Error("请填写写手模型的 API Key");
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
            保存连接并继续 <ArrowRight size={14} />
          </button>
        </>
      )}
      {state.wizardStep === 1 && (
        <div className="wizard-root">
          <h2>作品都在你自己的目录里</h2>
          <p>
            写作根下统一管理 novels、toutiao 和共用偏好。已有稿件仍可从设置中导入，不会搬动原文件。
          </p>
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
            选择写作文件夹 <ArrowRight size={14} />
          </button>
        </div>
      )}
      {state.wizardStep === 2 && (
        <div className="start-options">
          <button onClick={() => app.newWork("fanqie").catch(fail)}>
            <BookOpen />
            开第一本书
          </button>
          <button onClick={() => app.newWork("toutiao").catch(fail)}>
            <Feather />
            写一篇头条
          </button>
          <button
            onClick={() => {
              set({ picker: true, onboarding: false });
            }}
          >
            打开已有作品
          </button>
        </div>
      )}
    </Dialog>
  );
}

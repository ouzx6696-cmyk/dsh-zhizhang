import { errorText } from "../../../../../../packages/core/src/errors.js";
import { useConnectionTest } from "./useConnectionTest";
import { AppearanceFields } from "./AppearanceFields";
import { Dialog, Brand, Toggle } from "../../../../../../packages/ui/src/primitives";
import React, { useEffect, useState } from "react";
import { X, FolderOpen, Download, Shield } from "lucide-react";
import { ModelFields } from "./ModelFields";
import type { SystemState } from "../../state/store";
import { desktop } from "../../state/desktop";
import { askConfirm } from "../../state/confirm";
const api = desktop;
type SettingsProps = {
  state: SystemState;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  canRestart: () => boolean;
  onWorkspace: () => void | Promise<void>;
  onImport: (mode: "fanqie" | "toutiao") => void | Promise<void>;
};
export function Settings({
  state,
  onClose,
  onSaved,
  onWorkspace,
  onImport,
  canRestart,
}: SettingsProps) {
  const [tab, setTab] = useState("models"),
    [models, setModels] = useState(state.models),
    [appearance, setAppearance] = useState(state.appearance),
    [preferences, setPreferences] = useState<string | null>(null),
    [searchKey, setSearchKey] = useState(""),
    [health, setHealth] = useState<Awaited<ReturnType<typeof api.storageHealth>> | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [updates, setUpdates] = useState(state.updates);
  const { results: test, run: testConnection } = useConnectionTest();
  const [searchChanged, setSearchChanged] = useState(false);
  const [editorLinked, setEditorLinked] = useState(
    JSON.stringify(state.models.editor) === JSON.stringify(state.models.writer),
  );
  const [roleTab, setRoleTab] = useState<"writer" | "editor" | "planner">("writer");
  useEffect(() => {
    setPreferences(null);
    api
      .preferences()
      .then(setPreferences)
      .catch((error) => setMessage(errorText(error)));
  }, [state.workspace]);
  useEffect(() => {
    const unsubscribe = api.subscribe((value) => {
      if (value.updates) setUpdates(value.updates);
    });
    return unsubscribe;
  }, []);
  const action = async (operation: () => unknown | Promise<unknown>) => {
    setBusy(true);
    setMessage("");
    try {
      const result = await operation();
      if (result && typeof result === "object" && "file" in result)
        setMessage("已保存到 " + result.file);
      return result;
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const testRole = (role: "writer" | "editor" | "planner") => {
    const model = models[role];
    if (model) void testConnection(role, model);
  };
  const save = () =>
    action(async () => {
      if (JSON.stringify(models) !== JSON.stringify(state.models)) await api.model(models);
      await api.appearance(appearance);
      if (state.workspace && preferences !== null) await api.preferences(preferences);
      if (searchChanged) await api.search(searchKey);
      await onSaved();
      onClose();
    });
  return (
    <Dialog title="设置" className="studio-settings" onClose={onClose}>
      <header>
        <h2>设置</h2>
        <button className="icon-button" aria-label="关闭设置" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="settings-body">
        <nav className="settings-nav" aria-label="设置分区">
          {[
            ["models", "模型"],
            ["workspace", "写作文件夹"],
            ["appearance", "外观"],
            ["shortcuts", "快捷键"],
            ["resources", "备份与诊断"],
            ["about", "关于"],
          ].map(([id, label]) => (
            <button
              aria-current={tab === id ? "page" : undefined}
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {tab === "models" && (
            <>
              <p className="form-note">
                保存连接会停止当前任务。编辑与写手保持独立对话，可使用相同连接。
              </p>
              {!state.secureStorage && (
                <p className="form-warning">
                  <Shield size={16} />
                  系统安全存储不可用，Key 只保留到本次应用关闭。
                </p>
              )}
              <div className="role-tabs" role="tablist" aria-label="模型角色">
                {(["writer", "editor", "planner"] as const).map((role) => (
                  <button
                    key={role}
                    role="tab"
                    aria-selected={roleTab === role}
                    className={roleTab === role ? "active" : ""}
                    onClick={() => setRoleTab(role)}
                  >
                    {role === "writer" ? "写手" : role === "editor" ? "独立编辑" : "规划"}
                  </button>
                ))}
              </div>
              {roleTab === "editor" && (
                <Toggle
                  label="编辑沿用写手连接（独立对话）"
                  checked={editorLinked}
                  onChange={(checked: boolean) => {
                    setEditorLinked(checked);
                    if (checked)
                      setModels((previous) => ({
                        ...previous,
                        editor: { ...previous.writer },
                      }));
                  }}
                />
              )}
              {roleTab !== "planner" ? (
                <ModelFields
                  role={roleTab}
                  model={models[roleTab]}
                  onChange={(value) => {
                    if (roleTab === "editor") setEditorLinked(false);
                    setModels((previous) => ({
                      ...previous,
                      [roleTab]: value,
                      ...(roleTab === "writer" && editorLinked ? { editor: { ...value } } : {}),
                    }));
                  }}
                  onTest={() => testRole(roleTab)}
                  result={test[roleTab]}
                />
              ) : models.planner ? (
                <>
                  <ModelFields
                    role="planner"
                    model={models.planner}
                    onChange={(value) => setModels((previous) => ({ ...previous, planner: value }))}
                    onTest={() => testRole("planner")}
                    result={test.planner}
                  />
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={() => setModels((previous) => ({ ...previous, planner: null }))}
                    />
                    改为跟随写手模型
                  </label>
                </>
              ) : (
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() =>
                      setModels((previous) => ({
                        ...previous,
                        planner: { ...previous.writer, apiKey: "" },
                      }))
                    }
                  />
                  规划与拆书使用独立模型
                </label>
              )}
            </>
          )}
          {tab === "workspace" && (
            <>
              <h3>写作文件夹</h3>
              <p className="path-label">{state.workspace || "尚未选择"}</p>
              <p className="form-note">
                小说位于 novels，头条位于 toutiao；作者偏好由两种模式共用。导入旧目录不会移动原稿。
              </p>
              <div className="button-row">
                <button onClick={() => action(onWorkspace)}>
                  <FolderOpen size={16} />
                  选择写作文件夹
                </button>
                <button onClick={() => action(() => onImport("fanqie"))}>导入长篇目录</button>
                <button onClick={() => action(() => onImport("toutiao"))}>导入头条目录</button>
              </div>
              <h3>作者偏好</h3>
              <p className="form-note">
                记录文风、人称习惯、常用垂类和希望避免的表达。每次任务会带入这些偏好。
              </p>
              <textarea
                className="preferences-editor"
                value={preferences ?? ""}
                disabled={preferences === null}
                onChange={(event) => setPreferences(event.target.value)}
                placeholder="例如：第三人称限知；对白简短；不要替角色解释情绪。"
              />
              <h3>当前作品状态与恢复</h3>
              <button
                disabled={busy}
                onClick={() => action(async () => setHealth(await api.storageHealth()))}
              >
                检查占用和未完成写入
              </button>
              {health && (
                <div role="status">
                  <p>
                    {health.label}：{health.reason}
                  </p>
                  {health.files.map((item) => (
                    <p key={item.file}>
                      {item.file}：{item.state}
                    </p>
                  ))}
                  {health.canRecover && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        action(async () => {
                          const result = await api.recover({
                            id: health.id,
                            fingerprint: health.fingerprint,
                          });
                          setHealth(await api.storageHealth());
                          return result;
                        })
                      }
                    >
                      备份后恢复原操作
                    </button>
                  )}
                </div>
              )}
            </>
          )}
          {tab === "appearance" && (
            <AppearanceFields appearance={appearance} onChange={setAppearance} />
          )}
          {tab === "shortcuts" && (
            <div>
              <h3>写作快捷键</h3>
              <p>
                <kbd>Ctrl K</kbd> 搜索与命令
              </p>
              <p>
                <kbd>Ctrl S</kbd> 保存当前编辑
              </p>
              <p>
                <kbd>Ctrl 1 / 2 / 3</kbd> 切换右栏
              </p>
              <p>
                <kbd>Esc</kbd> 关闭浮层或停止任务
              </p>
              <p>减少动效会沿用系统设置。</p>
            </div>
          )}
          {tab === "about" && (
            <div>
              <Brand />
              <h3>写作 Agent · {state.version}</h3>
              <p>一盏灯，一页稿纸。基于内置写作内核，作品保存在自己的文件夹。</p>
              <h3>应用更新</h3>
              <p>
                {updates.state === "available"
                  ? `发现 ${updates.version}`
                  : updates.state === "downloaded"
                    ? "更新已下载，确认后重启安装"
                    : updates.state === "downloading"
                      ? `正在下载 ${updates.percent}%`
                      : updates.message || "启动时检查更新，下载和安装均由你决定。"}
              </p>
              <div className="button-row">
                <button onClick={() => action(() => api.updates())}>检查更新</button>
                {updates.state === "available" && (
                  <button onClick={() => action(() => api.updates("download"))}>
                    <Download size={16} />
                    下载更新
                  </button>
                )}
                {updates.state === "downloaded" && (
                  <button
                    onClick={async () => {
                      if (canRestart() && (await askConfirm("停止任务并重启安装更新？")))
                        void action(() => api.updates("install"));
                    }}
                  >
                    重启安装
                  </button>
                )}
              </div>
            </div>
          )}
          {tab === "resources" && (
            <>
              <button disabled={busy} onClick={() => action(() => api.backup())}>
                备份写作文件夹
              </button>
              <h3>资料检索（可选）</h3>
              <p className="form-note">
                未配置搜索时，Agent
                只能读取你提供的公开链接。搜索摘要不算已核实出处，资讯事实须继续读取原网页。
              </p>
              <label>
                Tavily API Key
                <input
                  type="password"
                  value={searchKey}
                  onChange={(event) => {
                    setSearchKey(event.target.value);
                    setSearchChanged(true);
                  }}
                  placeholder={state.searchConfigured ? "已配置，留空保持" : "可不填"}
                />
              </label>
              <button
                disabled={busy}
                onClick={() => {
                  setSearchKey("");
                  setSearchChanged(true);
                }}
              >
                清除搜索 Key
              </button>
              <h3>诊断</h3>
              <p className="form-note">诊断包仅含版本、去敏配置与运行事件，不含 Key 或稿件正文。</p>
              <button onClick={() => action(() => api.diagnostics())}>导出诊断包</button>
            </>
          )}
        </div>
      </div>
      {message && (
        <p className="form-note" role="status">
          {message}
        </p>
      )}
      <footer>
        <button onClick={onClose}>取消</button>
        <button className="primary" disabled={busy} onClick={save}>
          保存设置
        </button>
      </footer>
    </Dialog>
  );
}

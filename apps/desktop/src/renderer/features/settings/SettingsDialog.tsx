import React, { useEffect, useState } from "react";
import { X, FolderOpen, Download, Shield } from "lucide-react";
import { ModelFields } from "./ModelFields";
import type { SystemState } from "../../state/store";
import { desktop } from "../../state/desktop";
const api = desktop;
type SettingsProps = {
  state: SystemState;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onWorkspace: () => void | Promise<void>;
  onImport: (mode: "fanqie" | "toutiao") => void | Promise<void>;
};
export function Settings({ state, onClose, onSaved, onWorkspace, onImport }: SettingsProps) {
  const [tab, setTab] = useState("models"),
    [models, setModels] = useState<any>(state.models),
    [appearance, setAppearance] = useState<any>(state.appearance),
    [preferences, setPreferences] = useState(""),
    [searchKey, setSearchKey] = useState(""),
    [test, setTest] = useState<Record<string, any>>({
      writer: undefined,
      editor: undefined,
      planner: undefined,
    }),
    [health, setHealth] = useState<any>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [updates, setUpdates] = useState<any>(state.updates || {});
  useEffect(() => {
    api
      .preferences()
      .then(setPreferences)
      .catch(() => {});
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
      const result = (await operation()) as any;
      if (result?.file) setMessage("已保存到 " + result.file);
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const testRole = (role: "writer" | "editor" | "planner") =>
    action(async () => {
      setTest((previous: any) => ({ ...previous, [role]: { busy: true } }));
      try {
        const result = await api.testModel(role, models[role]);
        setTest((previous: any) => ({ ...previous, [role]: result }));
      } catch (error) {
        setTest((previous: any) => ({
          ...previous,
          [role]: { error: error instanceof Error ? error.message : String(error) },
        }));
      }
    });
  const save = () =>
    action(async () => {
      if (JSON.stringify(models) !== JSON.stringify(state.models))
        await api.model(models);
      await api.appearance(appearance);
      if (state.workspace) await api.preferences(preferences);
      if (searchKey) await api.search(searchKey);
      await onSaved();
      onClose();
    });
  return (
    <div className="studio-backdrop">
      <section
        className="studio-settings"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
      >
        <header>
          <h2>设置</h2>
          <button
            className="icon-button"
            aria-label="关闭设置"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <nav className="settings-tabs">
          {[
            ["models", "模型与角色"],
            ["workspace", "写作根与偏好"],
            ["appearance", "外观"],
            ["resources", "资料与更新"],
          ].map(([id, label]) => (
            <button
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
                保存模型连接会停止当前任务；作品和历史保留。编辑默认使用不同模型与独立上下文。
              </p>
              {!state.secureStorage && (
                <p className="form-warning">
                  <Shield size={16} />
                  系统安全存储不可用，Key 只保留到本次应用关闭。
                </p>
              )}
              {(["writer", "editor"] as const).map((role) => (
                <ModelFields
                  key={role}
                  role={role}
                  model={models[role]}
                  onChange={(value) =>
                    setModels((previous: any) => ({ ...previous, [role]: value }))
                  }
                  onTest={() => testRole(role)}
                  result={test[role]}
                />
              ))}
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={!models.planner}
                  onChange={(event) =>
                    setModels((previous: any) => ({
                      ...previous,
                      planner: event.target.checked
                        ? null
                        : { ...previous.writer, apiKey: "" },
                    }))
                  }
                />
                规划与拆书跟随写手模型
              </label>
              {models.planner && (
                <ModelFields
                  role="planner"
                  model={models.planner}
                  onChange={(value) =>
                    setModels((previous: any) => ({ ...previous, planner: value }))
                  }
                  onTest={() => testRole("planner")}
                  result={test.planner}
                />
              )}
            </>
          )}
          {tab === "workspace" && (
            <>
              <h3>统一写作根</h3>
              <p className="path-label">{state.workspace || "尚未选择"}</p>
              <p className="form-note">
                小说位于 novels，头条位于
                toutiao；作者偏好由两种模式共用。导入旧目录不会移动原稿。
              </p>
              <div className="button-row">
                <button onClick={() => action(onWorkspace)}>
                  <FolderOpen size={16} />
                  选择写作根
                </button>
                <button onClick={() => action(() => onImport("fanqie"))}>
                  导入长篇目录
                </button>
                <button onClick={() => action(() => onImport("toutiao"))}>
                  导入头条目录
                </button>
              </div>
              <h3>作者偏好</h3>
              <p className="form-note">
                记录文风、人称习惯、常用垂类和希望避免的表达。每次任务会带入这些偏好。
              </p>
              <textarea
                className="preferences-editor"
                value={preferences}
                onChange={(event) => setPreferences(event.target.value)}
                placeholder="例如：第三人称限知；对白简短；不要替角色解释情绪。"
              />
              <button
                disabled={busy}
                onClick={() => action(() => api.backup())}
              >
                备份写作根
              </button>
              <h3>当前作品状态与恢复</h3>
              <button disabled={busy} onClick={() => action(async () => setHealth(await api.storageHealth()))}>
                检查占用和未完成写入
              </button>
              {health && <div role="status">
                <p>{health.label}：{health.reason}</p>
                {health.files.map((item: any) => <p key={item.file}>{item.file}：{item.state}</p>)}
                {health.canRecover && <button disabled={busy} onClick={() => action(async () => {
                  const result = await api.recover({ id: health.id, fingerprint: health.fingerprint });
                  setHealth(await api.storageHealth());
                  return result;
                })}>备份后恢复原操作</button>}
              </div>}
            </>
          )}
          {tab === "appearance" && (
            <>
              <label>
                主题
                <select
                  value={appearance.theme}
                  onChange={(event) =>
                    setAppearance({ ...appearance, theme: event.target.value })
                  }
                >
                  <option value="system">跟随系统</option>
                  <option value="light">亮色</option>
                  <option value="dark">暗色</option>
                </select>
              </label>
              <label>
                正文字体
                <select
                  value={appearance.font}
                  onChange={(event) =>
                    setAppearance({ ...appearance, font: event.target.value })
                  }
                >
                  <option value="serif">思源宋体</option>
                  <option value="sans">思源黑体</option>
                </select>
              </label>
              <label>
                正文字号
                <input
                  type="number"
                  min="14"
                  max="28"
                  value={appearance.fontSize}
                  onChange={(event) =>
                    setAppearance({
                      ...appearance,
                      fontSize: Number(event.target.value),
                    })
                  }
                />
              </label>
              <p className="form-note">
                字体随应用提供；稿纸行宽与行距针对长篇阅读设置。
              </p>
            </>
          )}
          {tab === "resources" && (
            <>
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
                  onChange={(event) => setSearchKey(event.target.value)}
                  placeholder={
                    state.searchConfigured ? "已配置，留空保持" : "可不填"
                  }
                />
              </label>
              <h3>应用更新</h3>
              <p>
                {updates.state === "available"
                  ? `发现 ${updates.version}`
                  : updates.state === "downloaded"
                    ? "更新已下载，确认后重启安装"
                    : updates.state === "downloading"
                      ? `正在下载 ${updates.percent}%`
                      : updates.message ||
                        "启动时检查更新，下载和安装均由你决定。"}
              </p>
              <div className="button-row">
                <button onClick={() => action(() => api.updates())}>
                  检查更新
                </button>
                {updates.state === "available" && (
                  <button onClick={() => action(() => api.updates("download"))}>
                    <Download size={16} />
                    下载更新
                  </button>
                )}
                {updates.state === "downloaded" && (
                  <button
                    onClick={() => {
                      if (
                        window.confirm(
                          "确认已保存正在编辑的内容？更新会停止当前任务并重启。",
                        )
                      )
                        void action(() => api.updates("install"));
                    }}
                  >
                    重启安装
                  </button>
                )}
              </div>
              <h3>诊断</h3>
              <p className="form-note">
                诊断包仅含版本、去敏配置与运行事件，不含 Key 或稿件正文。
              </p>
              <button onClick={() => action(() => api.diagnostics())}>
                导出诊断包
              </button>
            </>
          )}
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
      </section>
    </div>
  );
}

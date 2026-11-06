/** 新建用户方案：名称、底本、备注，以及可选的 .md 文件或整个文件夹导入。 */
import React from "react";
import { Button, Icon, Spinner } from "./ui.jsx";
import { t } from "../../../../ui/src/copy.js";

const { useState } = React;

export function NewProfileForm({ profiles, base, onCancel, onCreate, busy }) {
  const [name, setName] = useState("");
  const [from, setFrom] = useState(base || "default");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState([]);
  const pick = async (list) => {
    const md = Array.from(list || [])
      .filter((f) => /\.md$/i.test(f.name))
      .slice(0, 300);
    const read = await Promise.all(
      md.map(async (f) => {
        const rel = (f.webkitRelativePath || f.name).replace(/\\/g, "/");
        const parts = rel.split("/");
        const id = (f.webkitRelativePath ? parts.slice(1).join("/") : rel).replace(/\.md$/i, "");
        return { id, text: await f.text() };
      }),
    );
    setFiles(read.filter((f) => f.id && f.text.trim()));
  };
  return (
    <form
      className="wb-pf-new"
      onSubmit={(e) => {
        e.preventDefault();
        onCreate({
          name: name.trim() || undefined,
          base: from,
          note: note.trim() || undefined,
          files,
        });
      }}
    >
      <h3 className="wb-pf-subhead">{t("pfNewTitle")}</h3>
      <label className="wb-form-row">
        <span className="wb-form-label">{t("pfNewName")}</span>
        <input
          className="wb-input"
          value={name}
          maxLength={24}
          placeholder={t("pfNewNameHint")}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="wb-form-row">
        <span className="wb-form-label">{t("pfNewBase")}</span>
        <select className="wb-select" value={from} onChange={(e) => setFrom(e.target.value)}>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="wb-form-row">
        <span className="wb-form-label">{t("pfNewNote")}</span>
        <input
          className="wb-input"
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <div className="wb-form-row">
        <span className="wb-form-label">{t("pfNewFiles")}</span>
        <span className="wb-input-row">
          <label className="wb-file-button">
            <Icon name="upload" size={14} />
            {t("pfNewPick")}
            <input
              type="file"
              accept=".md,text/markdown"
              multiple
              onChange={(e) => pick(e.target.files)}
            />
          </label>
          <label className="wb-file-button">
            <Icon name="upload" size={14} />
            {t("pfNewFolder")}
            <input
              type="file"
              multiple
              webkitdirectory=""
              directory=""
              onChange={(e) => pick(e.target.files)}
            />
          </label>
          {files.length ? (
            <span className="wb-muted">{t("pfNewPicked", { n: files.length })}</span>
          ) : null}
        </span>
        <span className="wb-form-hint">{t("pfNewFilesHint")}</span>
      </div>
      <div className="wb-pf-actions">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button
          variant="primary"
          size="sm"
          type="submit"
          disabled={busy}
          icon={busy ? <Spinner /> : <Icon name="plus" size={14} />}
        >
          {t("pfCreate")}
        </Button>
      </div>
    </form>
  );
}

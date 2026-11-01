import { app, dialog } from "electron";
import { start } from "./lifecycle";

if (!app.isPackaged && process.env.WRITER_USER_DATA)
  app.setPath("userData", process.env.WRITER_USER_DATA);

app
  .whenReady()
  .then(start)
  .catch((error) => {
    dialog.showErrorBox("写作 Agent 启动失败", String(error.message));
    app.quit();
  });

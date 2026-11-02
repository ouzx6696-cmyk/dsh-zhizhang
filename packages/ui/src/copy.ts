export const API_LABELS: Record<string, string> = {
  "openai-completions": "OpenAI 兼容（对话）",
  "openai-responses": "OpenAI 响应接口",
  "anthropic-messages": "Anthropic 消息接口",
  "google-generative-ai": "Google 生成接口",
};
export const COPY = {
  overview: "全书仪表盘",
  workspace: "写作文件夹",
  modelList: "可选模型",
  refreshModels: "刷新模型列表",
  editBody: "编辑正文",
};
export function chapterName(chapters: { id: string; title?: string }[], id: string) {
  const index = chapters.findIndex((chapter) => chapter.id === id);
  return index < 0
    ? "相关章节"
    : `第 ${index + 1} 章${chapters[index].title ? `《${chapters[index].title}》` : ""}`;
}

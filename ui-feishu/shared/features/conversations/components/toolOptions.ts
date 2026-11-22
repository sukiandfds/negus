import catalog from "../../../../../windows/server/tool-guides/catalog.json";

export const toolOptions = [
  { id: "file", command: "/file", group: "文件", label: "读取附件", detail: "按问题读取并处理已上传文件" },
  ...catalog,
  { id: "skill", command: "/skill", group: "Skills", label: "使用其他技能", detail: "指定已安装的技能，或按任务选择" },
  { id: "app", command: "/app", group: "Apps", label: "使用 App", detail: "选择当前可用连接器" },
];

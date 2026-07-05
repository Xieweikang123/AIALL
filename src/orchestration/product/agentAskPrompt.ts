export function buildFileAccessPathHint(): string {
  return [
    "read_file / list_dir：项目内用相对路径（如 src/main.ts）；",
    "读项目外或用户数据目录时，按 AGENTS.md、工具说明或用户消息中的逻辑路径前缀/绝对路径；",
    "大文件用 offset/limit，勿用 run_command 读文件。",
  ].join("");
}

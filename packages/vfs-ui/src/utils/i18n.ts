const dictionaries: Record<string, Record<string, string>> = {
  "zh-CN": {
    "vfs.favorites.add": "收藏",
    "vfs.favorites.remove": "取消收藏",
    "vfs.toolbar.directory": "目录",
    "vfs.preview.more": "显示更多（{count}）",
    "vfs.preview.collapse": "收起列表",
    "vfs.toolbar.file": "文件",
    "vfs.toolbar.import": "导入",
    "vfs.toolbar.export": "导出",
    "vfs.toolbar.create": "新建{name}",
    "vfs.toolbar.selectExport": "请先选择要导出的项目、会话或文件",
    "vfs.toolbar.project": "项目",
    "vfs.toolbar.projects": "项目列表",
    "vfs.toolbar.session": "会话",
    "vfs.toolbar.child": "子会话",
    "vfs.columns.back": "返回",
    "vfs.columns.content": "内容",
    "vfs.columns.more": "更多操作",
    "project.createFolder": "新建目录",
    "project.createFile": "新建文件",
    "vfs.creation.readOnly": "目标目录为只读，无法创建或导入文件。",
    "vfs.action.confirmQuickDelete": "再次点击删除",
    "action.delete": "删除"
  },
  "en": {
    "vfs.favorites.add": "Add to favorites",
    "vfs.favorites.remove": "Remove from favorites",
    "vfs.toolbar.directory": "Folder",
    "vfs.preview.more": "Show more ({count})",
    "vfs.preview.collapse": "Show fewer",
    "vfs.toolbar.file": "File",
    "vfs.toolbar.import": "Import",
    "vfs.toolbar.export": "Export",
    "vfs.toolbar.create": "New {name}",
    "vfs.toolbar.selectExport": "Select a project, session or file to export",
    "vfs.toolbar.project": "Project",
    "vfs.toolbar.projects": "Projects",
    "vfs.toolbar.session": "Session",
    "vfs.toolbar.child": "Child",
    "vfs.columns.back": "Back",
    "vfs.columns.content": "Contents",
    "vfs.columns.more": "More actions",
    "project.createFolder": "New folder",
    "project.createFile": "New file",
    "vfs.creation.readOnly": "The destination is read-only. Files cannot be created or imported.",
    "vfs.action.confirmQuickDelete": "Click again to delete",
    "action.delete": "Delete"
  }
};
export type Translate = (key: string, params?: Record<string, string | number>) => string;
export function translate(key: string, params?: Record<string, string | number>, locale = 'zh-CN'): string {
    const message = dictionaries[locale]?.[key] ?? dictionaries['zh-CN'][key] ?? key;
    return message.replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match));
}
export const t: Translate = translate;

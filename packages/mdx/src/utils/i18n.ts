const zhCN: Record<string, string> = {
    'editor.copyContent': '复制文件内容',
    'editor.copySuccess': '已复制到剪贴板',
    'editor.copyFailed': '复制失败，请检查剪贴板权限',
    'editor.ai.title': '引用到新 AI 会话',
    'editor.ai.selection': '引用选中内容',
    'editor.ai.file': '引用整个文件',
    'editor.wrap.label': '自动换行',
    'editor.wrap.sourceHint': '自动换行：仅调整显示，不改变文件内容',
    'editor.wrap.previewHint': '代码块自动换行：正文始终按窗口宽度换行',
    'editor.preview.loading': '正在加载预览…',
    'editor.preview.unavailable': '预览暂不可用，请切回源码继续编辑。',
    'editor.largeDocument.sourceFirst': '文件较大，已先打开源码。需要预览时可手动切换阅读模式。',
};
const en: Record<string, string> = {
    'editor.copyContent': 'Copy file contents',
    'editor.copySuccess': 'Copied to clipboard',
    'editor.copyFailed': 'Copy failed. Check clipboard permissions.',
    'editor.ai.title': 'Quote in a new AI chat',
    'editor.ai.selection': 'Selected content',
    'editor.ai.file': 'Entire file',
    'editor.wrap.label': 'Word wrap',
    'editor.wrap.sourceHint': 'Word wrap: changes display only, not file content',
    'editor.wrap.previewHint': 'Wrap code blocks: prose always wraps to the available width',
    'editor.preview.loading': 'Loading preview…',
    'editor.preview.unavailable': 'Preview is unavailable. Switch back to source to continue editing.',
    'editor.largeDocument.sourceFirst': 'This large document opens as source. Switch to reading mode when you need a preview.',
};
export function t(key: string, locale: 'zh-CN' | 'en' = 'zh-CN'): string { return (locale === 'en' ? en : zhCN)[key] ?? key; }

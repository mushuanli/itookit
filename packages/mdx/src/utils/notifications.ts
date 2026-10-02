type Level = 'info' | 'success' | 'error';
/** Browser default; hosts may replace notifications through EditorHost. */
function show(message: string, level: Level): void {
    if (typeof document === 'undefined') return;
    const notice = document.createElement('div');
    notice.className = `mdx-notification mdx-notification--${level}`;
    notice.setAttribute('role', level === 'error' ? 'alert' : 'status');
    notice.textContent = message;
    document.body.append(notice);
    setTimeout(() => notice.remove(), 3000);
}
export const Toast = {
    info: (message: string) => show(message, 'info'),
    success: (message: string) => show(message, 'success'),
    error: (message: string) => show(message, 'error'),
};

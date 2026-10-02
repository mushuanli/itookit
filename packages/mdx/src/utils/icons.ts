const icon = (path: string) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="${path}"/></svg>`;
export const ACTION_ICONS = {
    wordWrap: icon('M3 6h18M3 12h14a3 3 0 0 1 0 6h-4m3-3-3 3 3 3M3 18h5'),
    ai: icon('m12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3Z'),
    copy: icon('M9 9h12v12H9zM15 9V3H3v12h6'),
};

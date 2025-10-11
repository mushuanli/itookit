/**
 * @file #llm/input/styles.js
 * @description CSS styles for the LLMInputUI component.
 */

export function getCSS(cls) {
    return `
        .${cls.container} { font-family: var(--llm-font-family); position: relative; background-color: var(--llm-bg-color); border: 1px solid var(--llm-border-color); border-radius: var(--llm-border-radius); padding: 8px; transition: all 0.2s ease; }
        .${cls.toast} { position: absolute; top: -40px; left: 50%; transform: translateX(-50%); background-color: rgba(0, 0, 0, 0.7); color: white; padding: 8px 16px; border-radius: 16px; font-size: 14px; z-index: 20; display: none; opacity: 0; transition: opacity 0.3s ease-in-out; white-space: nowrap; }
        .${cls.errorDisplay} { background-color: var(--llm-error-bg-color); color: var(--llm-error-color); padding: 8px; border-radius: 6px; margin-bottom: 8px; font-size: 14px; }
        .${cls.statusBar} { display: flex; gap: 8px; padding: 0 8px 8px; font-size: 12px; }
        .${cls.statusBar} span { background-color: var(--llm-tag-bg-color); padding: 2px 8px; border-radius: 12px; }
        .${cls.attachmentTray} { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 8px 8px; }
        .${cls.attachmentItem} { display: flex; align-items: center; background-color: var(--llm-tag-bg-color); border-radius: 6px; padding: 4px 8px; font-size: 13px; animation: fadeIn 0.3s ease; }
        @keyframes fadeIn { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
        .${cls.attachmentItem} img { width: 24px; height: 24px; object-fit: cover; border-radius: 4px; margin-right: 8px; }
        .${cls.attachmentItem} span:first-of-type { font-size: 20px; margin-right: 8px; }
        .${cls.attachmentName} { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px; }
        .${cls.removeAttachmentBtn} { background: none; border: none; font-size: 18px; cursor: pointer; color: #888; padding: 0 0 0 8px; line-height: 1; }
        .${cls.mainArea} { display: flex; align-items: flex-end; gap: 8px; }
        .${cls.mainArea}.drag-over { box-shadow: 0 0 0 2px var(--llm-primary-color) inset; border-radius: 8px; }
        .llm-input-ui-button { flex-shrink: 0; width: 40px; height: 40px; border-radius: 50%; border: none; background-color: var(--llm-button-bg-color); cursor: pointer; font-size: 20px; display: flex; align-items: center; justify-content: center; transition: background-color 0.2s ease; }
        .${cls.sendBtn} { background-color: var(--llm-primary-color); color: var(--llm-primary-text-color); }
        .llm-input-ui-button:disabled { background-color: var(--llm-button-disabled-bg-color); cursor: not-allowed; }
        .${cls.textarea} { flex-grow: 1; border: none; resize: none; font-family: var(--llm-font-family); font-size: var(--llm-font-size); color: var(--llm-text-color); padding: 8px 12px; max-height: 200px; outline: none; background-color: var(--llm-input-bg-color); border-radius: 20px; }
        .${cls.popup} { position: absolute; bottom: 100%; left: 0; right: 0; margin-bottom: 8px; background: white; border: 1px solid #ccc; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); max-height: 250px; overflow-y: auto; z-index: 10; }
        .${cls.popupItem} { padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #eee; }
        .${cls.popupItem}:last-child { border-bottom: none; }
        .${cls.popupItem}:hover, .${cls.popupItem}.${cls.popupItemSelected} { background-color: var(--llm-popup-selected-bg-color); }
        .${cls.popupItem} strong { display: block; }
        .${cls.popupItem} p { font-size: 13px; color: #666; margin: 2px 0 0; }
        @media (max-width: 600px) {
            .llm-input-ui-button { width: 44px; height: 44px; }
            .${cls.textarea} { padding: 10px 14px; }
        }
    `;
}

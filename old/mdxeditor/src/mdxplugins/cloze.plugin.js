/**
 * @file #mdxeditor/mdxplugins/cloze.plugin.js
 * @desc Cloze Plugin
 * Handles the `--cloze--` syntax for creating interactive fill-in-the-blank elements.
 * - Registers the Marked.js extension for parsing.
 * - Provides an API Service for external scripts to control cloze states.
 * - Registers a CodeMirror command and a toolbar button for easy creation.
 * - Applies cloze states (hidden/visible) and attaches event listeners after rendering.
 */

// --- [订正] 在文件顶部定义类型别名 ---
/** @typedef {import('../core/plugin.js').PluginContext} PluginContext */
/** @typedef {import('../editor/index.js').MDxEditor} MDxEditor */

import { escapeHTML, simpleHash } from '@itookit/common';
import * as commands from '../editor/commands.js';

// A unique key for the service to avoid naming collisions.
export const ClozeAPIKey = Symbol('ClozeAPI');

const createSeparator = () => ({
    id: `sep-${Date.now()}-${Math.random()}`,
    type: 'separator' // 自定义类型
});

/**
 * The Marked.js extension for parsing the cloze syntax.
 */
const clozeSyntaxExtension = {
    name: 'cloze',
    level: 'inline',
    start: (src) => src.indexOf('--'),
    tokenizer(src) {
        const rule = /^--(?:\s*\[([^\]]*)\])?\s*(.*?)--(?:\^\^audio:(.*?)\^\^)?/;
        const match = rule.exec(src);

        if (match) {
            const [raw, locator, content, audio] = match;
            return {
                type: 'cloze',
                raw,
                locator: locator?.trim() || '',
                content: content.trim(),
                audio: audio?.trim() || ''
            };
        }
    },
    renderer(token) {
        const audioIcon = token.audio ?
            `<span class="media-icon" title="Play audio" data-audio-text="${escapeHTML(token.audio)}"><i class="fas fa-volume-up"></i></span>` : '';

        // +++ START MODIFICATION: 动态生成浓缩占位符 +++

        // 1. 将换行符 '¶' 替换为空格，并移除首尾空白
        let condensedText = token.content.replace(/¶/g, ' ').trim();
        
        // 2. 如果文本过长，进行截断并添加省略号
        const maxLength = 30; // 定义最大显示长度，可按需调整
        if (condensedText.length > maxLength) {
            condensedText = condensedText.substring(0, maxLength) + '...';
        }
        
        // 3. 如果处理后内容为空 (例如, 原文只有换行符), 提供一个默认占位符
        if (!condensedText) {
            condensedText = '[...]';
        }

        // 4. 更新 HTML 结构，使用新的动态占位符
        // 我们将旧的 <span class="placeholder"> 替换为 <span class="cloze-placeholder">
        return `<span class="cloze" data-cloze-content="${escapeHTML(token.content)}" data-cloze-locator="${escapeHTML(token.locator || '')}">
                    ${audioIcon}
                    <span class="cloze-content">${token.content.replace(/¶/g, '<br>')}</span>
                    <span class="cloze-placeholder">[...]</span>
                </span>`;
    }
};

/**
 * A public API for programmatically controlling clozes within a specific DOM element.
 */
class ClozeAPI {
    /** @param {HTMLElement} rootElement */
    constructor(rootElement) {
        this.rootElement = rootElement;
    }

    /**
     * Toggles the visibility of all cloze elements.
     * @param {boolean} isVisible - True to show all, false to hide all.
     */
    toggleAll(isVisible) {
        this.rootElement.querySelectorAll('.cloze').forEach(el => el.classList.toggle('hidden', !isVisible));
    }

    /**
     * Toggles the visibility of a specific cloze element by its ID.
     * @param {string} clozeId - The unique ID of the cloze.
     * @param {boolean} isVisible - The desired visibility state.
     */
    toggle(clozeId, isVisible) {
        const el = this.rootElement.querySelector(`[data-cloze-id="${clozeId}"]`);
        if (el) {
            el.classList.toggle('hidden', !isVisible);
        }
    }
}

// [新增] 声音播放辅助函数
/**
 * 使用 Web Speech API 播放指定的文本。
 * @param {string} text - 需要朗读的文本。
 */
function playAudio(text) {
    if (!text || !window.speechSynthesis) {
        console.warn('Speech synthesis not supported or no text provided.');
        return;
    }
    // 取消任何正在进行的朗读，防止重叠
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    // 你可以在这里设置语言、语速等参数
    // utterance.lang = 'en-US';
    window.speechSynthesis.speak(utterance);
}


export class ClozePlugin {
    name = 'feature:cloze';
    // [FIX] Declare listenerMap as a static property
    static listenerMap = new WeakMap();
    
    /**
     * @param {PluginContext} context // <-- [订正] 使用别名
     */
    install(context) {
        // 1. Register the syntax parser
        context.registerSyntaxExtension(clozeSyntaxExtension);

        // 2. Provide the API Service. We provide a factory function so consumers
        //    can create an API instance scoped to a specific DOM element.
        context.provide(ClozeAPIKey, (element) => new ClozeAPI(element));

        // 3. Register the editor command and toolbar button
        context.registerCommand('applyCloze', (/** @type {MDxEditor} */ editor) => commands.applyCloze(editor.editorView));
        context.registerToolbarButton({
            id: 'cloze',
            title: '创建 Cloze (--text--)',
            // [MODIFIED] 使用 Font Awesome 图标
            icon: '<i class="fas fa-square"></i>',
            command: 'applyCloze'
        });

        // --- [NEW] 带音频的 Cloze ---
        context.registerCommand('applyAudioCloze', (/** @type {MDxEditor} */ editor) => commands.applyAudioCloze(editor.editorView));
        context.registerToolbarButton({
            id: 'audioCloze',
            title: '插入带音频的 Cloze',
            icon: '<i class="fas fa-music"></i>',
            command: 'applyAudioCloze'
        });

        // 插入换行符 (用于多行 Cloze)
        context.registerCommand('insertLinebreak', (/** @type {MDxEditor} */ editor) => commands.insertLinebreak(editor.editorView));
        context.registerToolbarButton({
            id: 'linebreak',
            title: '插入换行符 (¶)',
            icon: '<i class="fas fa-paragraph"></i>',
            command: 'insertLinebreak'
        });
        
        // [NEW] 添加一个分隔符
        context.registerToolbarButton(createSeparator());

        // 4. Hook into the DOM update lifecycle to apply state and interactivity
        context.on('domUpdated', ({ element, options }) => {
            // [MODIFIED] This method now only applies IDs and default visibility.
            // The MemoryPlugin will override visuals based on SRS state.
            this.applyClozeBaseState(element, options); 
            this.attachEventListeners(element, options, context.emit);
        });
    }
    
    /**
     * [RENAMED & SIMPLIFIED] Applies the base state to all cloze elements.
     * It assigns a unique ID and sets a default visibility state.
     * The MemoryPlugin is expected to override this with specific memory states.
     * @param {HTMLElement} element
     * @param {object} options
     */
    applyClozeBaseState(element, options) {
        const { contextId = 'default', areAllClozesVisible = false } = options;
        element.querySelectorAll('.cloze').forEach(clozeElRaw => {
            const clozeEl = /** @type {HTMLElement} */ (clozeElRaw); // [FIX] Cast to HTMLElement
            const content = clozeEl.dataset.clozeContent || '';
            const locator = clozeEl.dataset.clozeLocator || '';
            const clozeId = `${contextId}_${simpleHash(locator || content)}`;
            clozeEl.dataset.clozeId = clozeId;
            clozeEl.classList.toggle('hidden', !areAllClozesVisible);
            if (!clozeEl.dataset.memoryTier) clozeEl.dataset.memoryTier = 'new';
        });
    }
    
    /**
     * Attaches delegated event listeners for cloze interactions.
     * @param {HTMLElement} element
     * @param {object} options
     * @param {PluginContext['emit']} emit // <-- [订正] 更精确的类型
     */
    attachEventListeners(element, options, emit) {
        // [FIX] Access the static property correctly
        if (ClozePlugin.listenerMap.has(element)) return;

        const listener = (event) => {
            const target = /** @type {HTMLElement} */ (event.target); // [FIX] Cast target
            const audioIcon = target.closest('.media-icon');
            const clozeElementRaw = target.closest('.cloze');

            // 场景 1: 点击了喇叭图标
            if (audioIcon) {
                event.stopPropagation();
                const audioText = (/** @type {HTMLElement} */ (audioIcon)).dataset.audioText;
                if (audioText) playAudio(audioText);
                return;
            }

            if (clozeElementRaw) {
                const clozeElement = /** @type {HTMLElement} */ (clozeElementRaw); // [FIX] Cast to HTMLElement
                const wasHidden = clozeElement.classList.contains('hidden');
                
                // 切换可见性
                clozeElement.classList.toggle('hidden');
                
                // 如果是从隐藏 -> 显示
                if (wasHidden) {
                    const associatedAudioIcon = /** @type {HTMLElement|null} */ (clozeElement.querySelector('.media-icon'));
                    const audioText = associatedAudioIcon?.dataset.audioText;
                    if (audioText) playAudio(audioText);
                    const detail = {
                        clozeId: clozeElement.dataset.clozeId,
                        element: clozeElement,
                        content: clozeElement.dataset.clozeContent
                    };
                    
                    // A. Emit a global event via the plugin context's event bus
                    emit('clozeRevealed', detail);
                    
                    // B. For backward compatibility, also fire the per-render callback if provided
                    options.on?.clozeRevealed?.(detail);
                }
            }
        };

        element.addEventListener('click', listener);
        ClozePlugin.listenerMap.set(element, listener);
    }
}
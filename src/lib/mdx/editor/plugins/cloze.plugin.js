/**
 * #mdx/editor/plugins/cloze.plugin.js
 * @file Cloze Plugin
 * Handles the `--cloze--` syntax for creating interactive fill-in-the-blank elements.
 * - Registers the Marked.js extension for parsing.
 * - Provides an API Service for external scripts to control cloze states.
 * - Registers a CodeMirror command and a toolbar button for easy creation.
 * - Applies cloze states (hidden/visible) and attaches event listeners after rendering.
 */

import { escapeHTML, simpleHash } from '../../../common/utils/utils.js';
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

        return `<span class="cloze" data-cloze-content="${escapeHTML(token.content)}" data-cloze-locator="${escapeHTML(token.locator || '')}">
                    ${audioIcon}
                    <span class="cloze-content">${token.content.replace(/¶/g, '<br>')}</span>
                    <span class="placeholder">[...]</span>
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
    
    /**
     * @param {import('../core/plugin.js').PluginContext} context
     */
    install(context) {
        // 1. Register the syntax parser
        context.registerSyntaxExtension(clozeSyntaxExtension);

        // 2. Provide the API Service. We provide a factory function so consumers
        //    can create an API instance scoped to a specific DOM element.
        context.provide(ClozeAPIKey, (element) => new ClozeAPI(element));

        // 3. Register the editor command and toolbar button
        context.registerCommand('applyCloze', (editor) => commands.applyCloze(editor.editorView));
        context.registerToolbarButton({
            id: 'cloze',
            title: '创建 Cloze (--text--)',
            // [MODIFIED] 使用 Font Awesome 图标
            icon: '<i class="fas fa-square"></i>',
            command: 'applyCloze'
        });

        // --- [NEW] 带音频的 Cloze ---
        context.registerCommand('applyAudioCloze', (editor) => commands.applyAudioCloze(editor.editorView));
        context.registerToolbarButton({
            id: 'audioCloze',
            title: '插入带音频的 Cloze',
            icon: '<i class="fas fa-music"></i>',
            command: 'applyAudioCloze'
        });

        // 插入换行符 (用于多行 Cloze)
        context.registerCommand('insertLinebreak', (editor) => commands.insertLinebreak(editor.editorView));
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
        element.querySelectorAll('.cloze').forEach(clozeEl => {
            const content = clozeEl.dataset.clozeContent;
            const locator = clozeEl.dataset.clozeLocator;
            const clozeId = `${contextId}_${simpleHash(locator || content)}`;
            clozeEl.dataset.clozeId = clozeId;

            // Set a default state. Mature cards will be revealed by MemoryPlugin later.
            const isHidden = !areAllClozesVisible;
            clozeEl.classList.toggle('hidden', isHidden);
            
            // Set a default tier, which MemoryPlugin will update.
            if (!clozeEl.dataset.memoryTier) {
                clozeEl.dataset.memoryTier = 'new';
            }
        });
    }
    
    /**
     * Attaches delegated event listeners for cloze interactions.
     * @param {HTMLElement} element
     * @param {object} options
     * @param {(eventName: string, payload: any) => void} emit
     */
    attachEventListeners(element, options, emit) {
        // Using a single delegated event listener for performance.
        // We use a WeakMap to avoid attaching the same listener multiple times.
        if (!ClozePlugin.listenerMap) ClozePlugin.listenerMap = new WeakMap();
        if (ClozePlugin.listenerMap.has(element)) return;

        const listener = (event) => {
            const audioIcon = event.target.closest('.media-icon');
            const clozeElement = event.target.closest('.cloze');

            // 场景 1: 点击了喇叭图标
            if (audioIcon) {
                event.stopPropagation(); // 关键！阻止事件冒泡到 .cloze 元素，防止其隐藏/显示
                const audioText = audioIcon.dataset.audioText;
                if (audioText) {
                    playAudio(audioText); // 播放声音
                }
                return; // 处理完毕，直接返回
            }

            // 场景 2: 点击了 cloze 的其他区域
            if (clozeElement) {
                const wasHidden = clozeElement.classList.contains('hidden');
                
                // 切换可见性
                clozeElement.classList.toggle('hidden');
                
                // 如果是从隐藏 -> 显示
                if (wasHidden) {
                    // [新增] 检查是否有音频，如果有则自动播放
                    const associatedAudioIcon = clozeElement.querySelector('.media-icon');
                    const audioText = associatedAudioIcon?.dataset.audioText;
                    if (audioText) {
                        playAudio(audioText);
                    }

                    // 保持原有的事件派发逻辑
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
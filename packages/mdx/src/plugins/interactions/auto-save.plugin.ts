/**
 * @file mdx/plugins/interactions/auto-save.plugin.ts
 * @desc 处理自动保存逻辑（防抖、失焦、可见性变化），处理粘贴、后台运行等场景
 */
import type { MDxPlugin, PluginContext } from '../../core/plugin';
import type { MDxEditor } from '../../editor/editor';

export interface AutoSavePluginOptions {
    /** 自动保存延迟 (ms)，默认 1000ms。设置为 0 禁用自动保存 */
    delay?: number;
    /** 失去焦点时是否保存 */
    saveOnBlur?: boolean;
}

export class AutoSavePlugin implements MDxPlugin {
    name = 'interaction:auto-save';
    private options: Required<AutoSavePluginOptions>;
    private timer: any = null;
    private cleanupFns: Array<() => void> = [];

    constructor(options: AutoSavePluginOptions = {}) {
        this.options = {
            delay: options.delay ?? 2000, // 默认 2秒防抖
            saveOnBlur: options.saveOnBlur ?? true
        };
    }

    install(context: PluginContext): void {
        // 监听来自 PluginManager 转发的编辑器初始化事件，获取 editor 实例
        const removeInit = context.on('editorPostInit', ({ editor }: { editor: MDxEditor }) => {
            this.setupListeners(editor, context);
        });
        if (removeInit) this.cleanupFns.push(removeInit);
    }

    private setupListeners(editor: MDxEditor, context: PluginContext) {
        // 1. 监听内容变化 (输入、粘贴、上传都会触发 interactiveChange)
        // 剪贴板粘贴（图片/HTML）最终会调用 insertText 或替换内容，从而触发 CodeMirror 的 update，
        // 进而触发 editor.ts 中的 interactiveChange。
        const removeChange = editor.on('interactiveChange', () => {
            this.triggerDebouncedSave(editor);
        });
        this.cleanupFns.push(removeChange);

        // 2. 失去焦点时保存
        if (this.options.saveOnBlur) {
             const removeBlur = editor.on('blur', () => {
                 this.triggerImmediateSave(editor);
             });
             this.cleanupFns.push(removeBlur);
        }

        // 3. 页面可见性变化 (用户切换 Tab)
        const visibilityHandler = () => {
            if (document.visibilityState === 'hidden') {
                this.triggerImmediateSave(editor);
            }
        };
        document.addEventListener('visibilitychange', visibilityHandler);
        this.cleanupFns.push(() => document.removeEventListener('visibilitychange', visibilityHandler));

        // 4. 窗口关闭前 (BeforeUnload)
        const beforeUnloadHandler = () => {
            if (editor.isDirty()) {
                // 尝试触发保存。注意：BeforeUnload 中异步请求不可靠，通常只能靠 navigator.sendBeacon
                // 但调用 save() 至少给了应用层一个尝试同步保存的机会
                this.triggerImmediateSave(editor); 
            }
        };
        window.addEventListener('beforeunload', beforeUnloadHandler);
        this.cleanupFns.push(() => window.removeEventListener('beforeunload', beforeUnloadHandler));
        
        // 5. 注册命令，允许其他插件触发保存
        context.registerCommand?.('save', () => this.triggerImmediateSave(editor));
    }

    /**
     * 防抖保存 (用于打字、粘贴)
     */
    private triggerDebouncedSave(editor: MDxEditor) {
        if (this.options.delay <= 0) return;
        
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            editor.save();
        }, this.options.delay);
    }

    /**
     * 立即保存 (用于失焦、切换)
     */
    private triggerImmediateSave(editor: MDxEditor) {
        if (this.timer) clearTimeout(this.timer);
        editor.save();
    }

    destroy(): void {
        if (this.timer) clearTimeout(this.timer);
        this.cleanupFns.forEach(fn => fn());
        this.cleanupFns = [];
    }
}

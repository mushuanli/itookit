/**
 * @file mdx/plugins/interactions/auto-save.plugin.ts
 * @desc 自动保存插件 - 融合防抖、失焦、可见性变化等多种保存策略
 */
import type { MDxPlugin, PluginContext } from '../../core/plugin';
import type { MDxEditor } from '../../editor/editor';

export interface AutoSavePluginOptions {
  /** 
   * 防抖延迟 (ms)，用户停止输入后多久保存
   * 设置为 0 禁用防抖保存
   * @default 2000 
   */
  debounceDelay?: number;
  
  /** 
   * 失去焦点时是否立即保存 
   * @default true 
   */
  saveOnBlur?: boolean;
  
  /** 
   * 页面隐藏时是否立即保存（用户切换 Tab）
   * @default true 
   */
  saveOnVisibilityHidden?: boolean;
  
  /** 
   * 窗口关闭前是否尝试保存
   * @default true 
   */
  saveOnBeforeUnload?: boolean;
  
  /** 
   * 是否启用自动保存
   * @default true 
   */
  enabled?: boolean;
}

export class AutoSavePlugin implements MDxPlugin {
  name = 'interaction:auto-save';
  
  private options: Required<AutoSavePluginOptions>;
  private cleanupFns: Array<() => void> = [];
  private timer: number | null = null;
  
  // 销毁保护标志
  private isDestroyed = false;

  constructor(options: AutoSavePluginOptions = {}) {
    this.options = {
      debounceDelay: options.debounceDelay ?? 2000,
      saveOnBlur: options.saveOnBlur ?? true,
      saveOnVisibilityHidden: options.saveOnVisibilityHidden ?? true,
      saveOnBeforeUnload: options.saveOnBeforeUnload ?? true,
      enabled: options.enabled ?? true,
    };
  }

  install(context: PluginContext): void {
    if (!this.options.enabled) return;

    // 监听编辑器初始化
    const removeInit = context.on('editorPostInit', ({ editor }: { editor: MDxEditor }) => {
      this.setupListeners(editor, context);
    });
    if (removeInit) this.cleanupFns.push(removeInit);

    // 监听销毁前事件，立即停止所有活动
    const removeBeforeDestroy = context.listen('beforeDestroy', () => {
      this.stop();
    });
    if (removeBeforeDestroy) this.cleanupFns.push(removeBeforeDestroy);
  }

  private setupListeners(editor: MDxEditor, context: PluginContext): void {
    // 1. 内容变化 - 防抖保存
    if (this.options.debounceDelay > 0) {
      const removeChange = editor.on('interactiveChange', () => {
        if (this.isDestroyed) return;
        this.triggerDebouncedSave(editor);
      });
      this.cleanupFns.push(removeChange);
    }

    // 2. 失去焦点 - 立即保存
    if (this.options.saveOnBlur) {
      const removeBlur = editor.on('blur', () => {
        if (this.isDestroyed) return;
        this.triggerImmediateSave(editor);
      });
      this.cleanupFns.push(removeBlur);
    }

    // 3. 页面可见性变化 - 立即保存
    if (this.options.saveOnVisibilityHidden) {
      const visibilityHandler = () => {
        if (this.isDestroyed) return;
        if (document.visibilityState === 'hidden') {
          this.triggerImmediateSave(editor);
        }
      };
      document.addEventListener('visibilitychange', visibilityHandler);
      this.cleanupFns.push(() => {
        document.removeEventListener('visibilitychange', visibilityHandler);
      });
    }

    // 4. 窗口关闭前 - 尝试保存
    if (this.options.saveOnBeforeUnload) {
      const beforeUnloadHandler = () => {
        if (this.isDestroyed) return;
        if (editor.isDirty()) {
          this.triggerImmediateSave(editor);
        }
      };
      window.addEventListener('beforeunload', beforeUnloadHandler);
      this.cleanupFns.push(() => {
        window.removeEventListener('beforeunload', beforeUnloadHandler);
      });
    }

    // 5. 注册保存命令
    context.registerCommand?.('save', () => {
      if (this.isDestroyed) return;
      this.triggerImmediateSave(editor);
    });

    // 6. 监听保存成功，重置定时器
    const removeSaved = editor.on('saved' as any, () => {
      if (this.isDestroyed) return;
      this.clearTimer();
    });
    if (removeSaved) this.cleanupFns.push(removeSaved);
  }

  /**
   * 防抖保存
   */
  private triggerDebouncedSave(editor: MDxEditor): void {
    if (this.isDestroyed) return;
    
    this.clearTimer();
    this.timer = window.setTimeout(() => {
      // 只检查插件自身的销毁状态
      // beforeDestroy 事件确保了在编辑器销毁前 isDestroyed 已被设置
      if (!this.isDestroyed) {
        editor.save();
      }
    }, this.options.debounceDelay);
  }

  /**
   * 立即保存
   */
  private triggerImmediateSave(editor: MDxEditor): void {
    if (this.isDestroyed) return;
    
    this.clearTimer();
    
    // 只检查 isDirty，不需要检查 isDestroying
    // 因为 beforeDestroy 事件会在编辑器销毁前触发 stop()
    if (editor.isDirty()) {
      editor.save();
    }
  }

  /**
   * 清除定时器
   */
  private clearTimer(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * 停止自动保存
   */
  public stop(): void {
    this.isDestroyed = true;
    this.clearTimer();
  }

  destroy(): void {
    this.stop();
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
  }
}

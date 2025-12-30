/**
 * @file mdx/plugins/ui/asset-manager.plugin.ts
 * @desc 集成 AssetManagerUI 并处理配置
 */
import type { MDxPlugin, PluginContext } from '../../core/plugin';
import { AssetManagerUI } from './asset-manager.ui';
import { AssetConfigOptions } from '../../core/asset-helper';
import { Toast } from '@itookit/common';

export interface AssetManagerPluginOptions extends AssetConfigOptions {}

export class AssetManagerPlugin implements MDxPlugin {
    name = 'ui:asset-manager';
    private options: AssetManagerPluginOptions;
    private currentUI: AssetManagerUI | null = null;

    constructor(options: AssetManagerPluginOptions = {}) {
        this.options = options;
    }

    install(context: PluginContext): void {
        context.registerTitleBarButton?.({
            id: 'asset-manager',
            title: '附件管理',
            icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/>
            </svg>`,
            location: 'right',
            onClick: async ({ editor }) => {
                await this.openAssetManager(context, editor);
            }
        });

        // 注册命令，允许其他方式触发
        context.registerCommand?.('openAssetManager', async () => {
            const pluginManager = context.pluginManager;
            const editor = (pluginManager as any).editorInstance;
            if (editor) {
                await this.openAssetManager(context, editor);
            }
        });
    }

    private async openAssetManager(context: PluginContext, editor: any): Promise<void> {
        const engine = context.getSessionEngine?.();
        const ownerNodeId = context.getOwnerNodeId?.();
        
        if (!engine) {
            Toast.error('未连接到引擎');
            return;
        }
        if (!ownerNodeId) {
            Toast.info('未找到归属文档');
            return;
        }

        // ✅ 使用 Engine 获取目录 ID
        const assetDirId = await engine.getAssetDirectoryId(ownerNodeId);

        if (!assetDirId) {
            // 如果 ID 为空，说明目录尚未创建（即没有附件）
            Toast.info('暂无附件');
            // 可选：也可以打开 UI 显示空状态，但这里选择提示
            return;
        }

        if (this.currentUI) this.currentUI.close();
        this.currentUI = new AssetManagerUI(engine, editor, this.options);
        await this.currentUI.show(assetDirId);
    }

    destroy(): void {
        this.currentUI?.close();
        this.currentUI = null;
    }
}
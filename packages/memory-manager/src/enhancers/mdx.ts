// @file: memory-manager/enhancers/mdx.ts
import { FileMentionSource, DirectoryMentionSource } from '@itookit/vfs-ui';
import { EditorConfigEnhancer } from '../types';

/**
 * MDxEditor 适配器
 * 将 hostContext 映射为 core:titlebar 插件能理解的配置
 */
export const createMDxEnhancer = (mentionScope: string[] = ['*']): EditorConfigEnhancer => {
    return (options, { engine, host }) => {
        return {
            ...options,
            sessionEngine: engine,
            defaultPluginOptions: {
                ...(options.defaultPluginOptions || {}),
                // 仅在此处感知具体插件字符串 'autocomplete:mention'
                'autocomplete:mention': {
                    // @ts-ignore
                    ...(options.defaultPluginOptions?.['autocomplete:mention'] || {}),
                    providers: [
                        new FileMentionSource({ engine, scope: mentionScope }),
                        new DirectoryMentionSource({ engine, scope: mentionScope })
                    ]
                },

                // [关键] 适配逻辑：将通用 Host 能力转换为特定插件参数
                'core:titlebar': {
                    // @ts-ignore
                    ...(options.defaultPluginOptions?.['core:titlebar'] || {}),
                    // 假设 Titlebar 插件接收以下签名的回调
                    onSidebarToggle: host.toggleSidebar,
                    // Titlebar 内部保存按钮点击时会调用 saveCallback
                    saveCallback: (editorInstance: any) => {
                        if (options.nodeId) {
                            return host.saveContent(options.nodeId, editorInstance.getText());
                        }
                    }
                }
            }
        };
    };
};

/**
 * @file vfs-ui/adapters/AgentAdapter.ts
 */
import { VFSCore, VNode } from '@itookit/vfs-core';
import { GenericContentAdapter } from './GenericContentAdapter';
import type { EditorContent, ContentMetadata } from '../interfaces/IVFSUIManager';

/**
 * Agent 适配器
 * 处理 Agent 类型的内容
 */
export class AgentAdapter extends GenericContentAdapter {
  constructor(editorFactory: any, vfs: VFSCore) {
    super('agent', editorFactory, vfs);
  }

  /**
   * 检查是否能处理
   */
  canHandle(node: VNode): boolean {
    return node.contentType === 'agent';
  }

  /**
   * 加载内容
   */
  async loadContent(node: VNode): Promise<EditorContent> {
    const baseContent = await super.loadContent(node);
    
    try {
      const agentData = JSON.parse(baseContent.raw);
      
      return {
        ...baseContent,
        formatted: agentData,
        metadata: {
          summary: agentData.systemPrompt?.substring(0, 100) || 'Agent configuration',
          stats: {
            messageCount: agentData.messages?.length || 0
          }
        }
      };
    } catch (error) {
      console.error('Failed to parse agent data:', error);
      return baseContent;
    }
  }

  /**
   * 获取元数据
   */
  async getMetadata(node: VNode): Promise<ContentMetadata> {
    const { content } = await (this as any).vfs.read(node.id);
    
    try {
      const agentData = JSON.parse(content);
      
      return {
        summary: agentData.systemPrompt?.substring(0, 100) || 'Agent configuration',
        stats: {
          messageCount: agentData.messages?.length || 0
        }
      };
    } catch (error) {
      return { stats: {} };
    }
  }

  /**
   * 格式化内容
   */
  protected _formatContent(content: string, contentType: string): any {
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
}

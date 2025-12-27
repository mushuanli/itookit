/**
 * @file vfs/middleware/PlainTextMiddleware.ts
 * 纯文本 Middleware
 * 负责计算文本文件的统计信息，并拒绝非法的二进制写入
 */
import { ContentMiddleware } from './base/ContentMiddleware.js';
import { VNode, Transaction } from '../store/types.js';
import { guessMimeType } from '@itookit/common'; 

export class PlainTextMiddleware extends ContentMiddleware {
  readonly name = 'plain-text';
  readonly priority = 0;

  /**
   * 判断是否处理该节点
   * [修复] 使用 guessMimeType 统一逻辑，并解决 vnode 未使用的问题
   */
  canHandle(vnode: VNode): boolean {
    // [修复 TS6133 & TS2552]: 使用 vnode.name
    const mimeType = guessMimeType(vnode.name);
    
    // 简单的文本类型判断逻辑
    return (
      mimeType.startsWith('text/') || 
      mimeType === 'application/json' || 
      mimeType === 'application/xml' ||
      mimeType === 'application/javascript'
    );
  }

  async onValidate(_vnode: VNode, content: string | ArrayBuffer): Promise<void> {
    if (content instanceof ArrayBuffer) {
      // 只有当 canHandle 返回 true 时，这里抛出错误才是合理的
      throw new Error('Plain text middleware received binary content. This should have been filtered by canHandle.');
    }
  }

  async onAfterWrite(
    _vnode: VNode, 
    content: string | ArrayBuffer, 
    _transaction: Transaction
  ): Promise<Record<string, any>> {
    // [修复 TS2552]: node -> vnode
    const metadata: Record<string, any> = {};

    // 示例：如果是文本，统计字数
    if (typeof content === 'string') {
        metadata.wordCount = content.length;
        // [修复 TS2552]: node -> vnode
        metadata.lineCount = content.split('\n').length;
    }

    return metadata;
  }
}

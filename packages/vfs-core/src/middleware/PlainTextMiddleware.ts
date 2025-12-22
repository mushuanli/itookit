/**
 * @file vfs/middleware/PlainTextMiddleware.ts
 * 纯文本 Middleware
 * 负责计算文本文件的统计信息，并拒绝非法的二进制写入
 */
import { ContentMiddleware } from './base/ContentMiddleware.js';
import { VNode, Transaction, VNodeType } from '../store/types.js';

export class PlainTextMiddleware extends ContentMiddleware {
  readonly name = 'plain-text';
  readonly priority = 0;

  canHandle(vnode: VNode): boolean {
    // 1. 如果是目录，不处理
    if (vnode.type === VNodeType.DIRECTORY) return false;

    // 2. ✨ [关键] 如果被标记为资产 (Image/PDF/Zip 等)，明确不处理
    // 这与 UploadPlugin 和 VFSModuleEngine.createAsset 配合
    if (vnode.metadata?.isAsset) return false;

    // 3. 如果明确标记了非文本的 contentType，不处理 (兼容旧逻辑)
    if (vnode.metadata?.contentType && !vnode.metadata.contentType.startsWith('text/')) {
        return false;
    }

    // 4. 其他情况默认视为文本处理 (比如 .md, .txt, .json, .js)
    return true;
  }

  async onValidate(_vnode: VNode, content: string | ArrayBuffer): Promise<void> {
    if (typeof content !== 'string') {
      // 只有当 canHandle 返回 true 时，这里抛出错误才是合理的
      throw new Error('Plain text middleware received binary content. This should have been filtered by canHandle.');
    }
  }

  async onAfterWrite(
    _vnode: VNode,
    content: string | ArrayBuffer,
    _transaction: Transaction
  ): Promise<Record<string, any>> {
    // 此时可以安全断言为 string
    if (typeof content !== 'string') return {};

    const text = content as string;
    return {
      characterCount: text.length,
      wordCount: text.split(/\s+/).filter(Boolean).length,
      lineCount: text.split('\n').length,
      updatedAt: Date.now() // 自动更新时间戳
    };
  }
}

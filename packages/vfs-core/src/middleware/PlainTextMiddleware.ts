/**
 * @file vfs/middleware/PlainTextMiddleware.ts
 * 纯文本 Middleware 示例
 */
import { ContentMiddleware } from './base/ContentMiddleware.js';
import { VNode, Transaction } from '../store/types.js';

export class PlainTextMiddleware extends ContentMiddleware {
  readonly name = 'plain-text';
  readonly priority = 0;

  canHandle(vnode: VNode): boolean {
    // A more robust check might be needed, e.g., checking extension or metadata
    return vnode.metadata?.contentType === 'text/plain';
  }

  async onValidate(_vnode: VNode, content: string | ArrayBuffer): Promise<void> {
    if (typeof content !== 'string') {
      throw new Error('Plain text content must be a string');
    }
  }

  async onAfterWrite(
    _vnode: VNode,
    content: string | ArrayBuffer,
    _transaction: Transaction
  ): Promise<Record<string, any>> {
    const text = content as string;
    return {
      characterCount: text.length,
      wordCount: text.split(/\s+/).filter(Boolean).length,
      lineCount: text.split('\n').length
    };
  }
}

/**
 * @file vfs/provider/PlainTextProvider.ts
 * 纯文本 Provider 示例
 */
import { ContentProvider } from './base/ContentProvider.js';
import { VNode, Transaction } from '../store/types.js'; // [FIX] Added missing import

export class PlainTextProvider extends ContentProvider {
  readonly name = 'plain-text';
  readonly priority = 0;

  canHandle(vnode: VNode): boolean {
    // A more robust check might be needed, e.g., checking extension or metadata
    return vnode.metadata?.contentType === 'text/plain';
  }

  async onValidate(vnode: VNode, content: string | ArrayBuffer): Promise<void> {
    if (typeof content !== 'string') {
      throw new Error('Plain text content must be a string');
    }
  }

  async onAfterWrite(
    vnode: VNode,
    content: string | ArrayBuffer,
    transaction: Transaction
  ): Promise<Record<string, any>> {
    const text = content as string;
    return {
      characterCount: text.length,
      wordCount: text.split(/\s+/).filter(Boolean).length,
      lineCount: text.split('\n').length
    };
  }
}

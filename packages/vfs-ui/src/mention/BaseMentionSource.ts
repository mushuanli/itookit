/**
 * @file vfs-ui/mention/BaseMentionSource.ts
 * @desc Base class for mention sources.
 */
import {
  IMentionSource,
  type Suggestion,
  type HoverPreviewData,
  type IFSEngine,
  type EngineNode,
} from '@itookit/common';
import { shouldFilterNode } from '../utils/helpers';

export interface MentionSourceDependencies {
  engine: IFSEngine;
  scope?: boolean | string[];
}

export abstract class BaseMentionSource extends IMentionSource {
  protected readonly engine: IFSEngine;
  protected readonly searchScope: string[] | undefined;

  constructor({ engine, scope = true }: MentionSourceDependencies) {
    super();
    if (!engine)
      throw new Error(
        `${this.constructor.name} requires an IFSEngine instance.`
      );
    this.engine = engine;
    this.searchScope = Array.isArray(scope) ? scope : scope ? ['*'] : undefined;
  }

  protected filterResults = (results: EngineNode[]): EngineNode[] =>
    results.filter(node => !shouldFilterNode(node));

  protected parseUri(uri: string): string | null {
    if (!uri) return null;
    try {
      return new URL(uri).pathname?.substring(1) || null;
    } catch {
      return null;
    }
  }

  abstract getSuggestions(query: string): Promise<Suggestion[]>;
  abstract getHoverPreview(uri: string): Promise<HoverPreviewData | null>;
}

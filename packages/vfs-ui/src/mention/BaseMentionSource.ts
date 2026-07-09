/**
 * @file vfs-ui/mention/BaseMentionSource.ts
 * @desc Base class for mention sources.
 */
import {
  IMentionSource,
  type Suggestion,
  type HoverPreviewData,
} from './autocomplete-source';
import {
  type IModuleFS,
  type FSNode,
} from '@itookit/common';
import { shouldFilterNode } from '../utils/helpers';

export interface MentionSourceDependencies {
  engine: IModuleFS;
  scope?: boolean | string[];
}

export abstract class BaseMentionSource extends IMentionSource {
  protected readonly engine: IModuleFS;
  protected readonly searchScope: string[] | undefined;

  constructor({ engine, scope = true }: MentionSourceDependencies) {
    super();
    if (!engine)
      throw new Error(
        `${this.constructor.name} requires an IModuleFS instance.`
      );
    this.engine = engine;
    this.searchScope = Array.isArray(scope) ? scope : scope ? ['*'] : undefined;
  }

  protected filterResults = (results: FSNode[]): FSNode[] =>
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

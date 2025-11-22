/**
 * @file vfs-ui/mention/TagAutocompleteSource.ts
 * @desc 提供标签自动完成建议 (基于 ISessionEngine)
 */

import { IAutocompleteSource, type Suggestion, type ISessionEngine } from '@itookit/common';

export interface TagSourceDependencies {
  engine: ISessionEngine;
}

/**
 * @class
 * @implements {IAutocompleteSource}
 * 从 ISessionEngine 获取全局标签数据。
 */
export class TagAutocompleteSource extends IAutocompleteSource {
  private engine: ISessionEngine;

  constructor({ engine }: TagSourceDependencies) {
    super();
    if (!engine) {
      throw new Error("TagAutocompleteSource requires an ISessionEngine instance.");
    }
    this.engine = engine;
  }

  /**
   * Retrieves and filters global tag suggestions from vfs-core based on a query.
   * @param query - The search string entered by the user.
   * @returns A promise that resolves to an array of suggestions.
   */
  public async getSuggestions(query: string): Promise<Suggestion[]> {
    try {
      if (!this.engine.getAllTags) {
          return [];
      }

      // 使用接口方法获取标签
      const allTagData = await this.engine.getAllTags();
      const lowerCaseQuery = query.toLowerCase();

      const filteredTags = query 
        ? allTagData.filter(tag => tag.name.toLowerCase().includes(lowerCaseQuery))
        : allTagData;

      return filteredTags.map(tag => ({
        id: tag.name,
        label: tag.name,
        type: 'tag',
        color: tag.color
      }));
    } catch (error) {
      console.error('[TagAutocompleteSource] Failed to get tag suggestions:', error);
      return [];
    }
  }
}
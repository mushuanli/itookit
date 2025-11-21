/**
 * @file vfs-core/mention/TagAutocompleteSource.ts
 * @desc 提供标签自动完成建议
 */

import { IAutocompleteSource, type Suggestion } from '@itookit/common';
// [修正] 确保从 VFS Core 入口导入类型
import { VFSCore } from '../VFSCore';
import { TagData } from '../store/types.js';

export interface TagSourceDependencies {
  vfsCore: VFSCore;
}

/**
 * @class
 * @implements {IAutocompleteSource}
 * A concrete tag data source that retrieves global tag data directly from vfs-core.
 */
export class TagAutocompleteSource extends IAutocompleteSource {
  private vfsCore: VFSCore;

  constructor({ vfsCore }: TagSourceDependencies) {
    super();
    if (!vfsCore) {
      throw new Error("TagAutocompleteSource requires a VFSCore instance.");
    }
    this.vfsCore = vfsCore;
  }

  /**
   * Retrieves and filters global tag suggestions from vfs-core based on a query.
   * @param query - The search string entered by the user.
   * @returns A promise that resolves to an array of suggestions.
   */
  public async getSuggestions(query: string): Promise<Suggestion[]> {
    try {
      // 使用 vfsCore 的高级 API 获取标签
      const allTagData: TagData[] = await this.vfsCore.getAllTags();
      const allTags = allTagData.map(tag => tag.name);
      
      const lowerCaseQuery = query.toLowerCase();

      const filteredTags = query 
        ? allTags.filter(tag => tag.toLowerCase().includes(lowerCaseQuery))
        : allTags;

      return filteredTags.map(tag => ({
        id: tag,
        label: tag,
        type: 'tag'
      }));
    } catch (error) {
      console.error('[TagAutocompleteSource] Failed to get tag suggestions:', error);
      return [];
    }
  }
}
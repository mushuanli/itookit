/**
 * @file vfs-ui/src/providers/TagProvider.ts
 * @desc Provides tag suggestions for autocomplete components.
 */

// [修正] 导入正确的 Suggestion 类型并使用别名 'as AutocompleteSuggestion'
import { IAutocompleteProvider, type Suggestion as AutocompleteSuggestion } from '@itookit/common';
// [修正] 导入 VFSCore
import type { VFSCore } from '@itookit/vfs-core';

// [修正] 定义构造函数依赖
export interface TagProviderDependencies {
  vfsCore: VFSCore;
}

/**
 * @class
 * @implements {IAutocompleteProvider}
 * A concrete tag data source that retrieves global tag data directly from vfs-core.
 */
export class TagProvider extends IAutocompleteProvider {
  private vfsCore: VFSCore; // [修正] 依赖从 VFSStore 变为 VFSCore

  constructor({ vfsCore }: TagProviderDependencies) { // [修正] 构造函数接收 VFSCore
    super();
    if (!vfsCore) {
      throw new Error("TagProvider requires a VFSCore instance.");
    }
    this.vfsCore = vfsCore;
  }

  /**
   * Retrieves and filters global tag suggestions from vfs-core based on a query.
   * @param query - The search string entered by the user.
   * @returns A promise that resolves to an array of suggestions.
   */
  public async getSuggestions(query: string): Promise<AutocompleteSuggestion[]> {
    try {
      // [修正] 直接调用 vfs-core 的全局 API
      const allTagData = await this.vfsCore.getAllTags();
      const allTags = allTagData.map(tag => tag.name);
      
      const lowerCaseQuery = query.toLowerCase();

      const filteredTags = query 
        ? allTags.filter(tag => tag.toLowerCase().includes(lowerCaseQuery))
        : allTags;

      return filteredTags.map(tag => ({
        id: tag,
        label: tag,
        type: 'tag' // Optional: provide a type for styling
      }));
    } catch (error) {
      console.error('[TagProvider] Failed to get tag suggestions from vfs-core:', error);
      return [];
    }
  }
}
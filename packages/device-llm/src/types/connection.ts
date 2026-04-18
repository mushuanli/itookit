// @file: device-llm/types/connection.ts
// 类型定义已移至 @itookit/common/interfaces/llm，此文件保留向后兼容的重新导出。
export type {
    LLMModel,
    LLMProviderImplementation,
    LLMProvider,
    LLMProviderDefinition,  // @deprecated alias for LLMProvider
    LLMConnection,
    ConnectionMeta,
} from '@itookit/common';
export { toConnectionMeta } from '@itookit/common';

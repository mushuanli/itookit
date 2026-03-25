// @file: common/interfaces/llm/index.ts
// LLM 接口与数据结构的统一导出入口。
// 各包应从 '@itookit/common' 导入这些类型，而非直接依赖 @itookit/device-llm。

export * from './connection';
export * from './message';
export * from './completion';
export * from './agent';


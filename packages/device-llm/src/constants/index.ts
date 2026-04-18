// @file: device-llm/constants/index.ts
// 统一导出入口 — 三层常量汇总。
//
// 三层结构：
//   providers.ts  — Layer 1: Provider 目录（apiKey + 模型 catalog）
//   connections.ts — Layer 2: Connection 默认配置（连接 ID 约定）
//   agents.ts     — Layer 3: Agent 默认定义（功能定制）

/** 配置版本号（修改任意层内容必须递增，触发 ensureDefaults 重新同步） */
export const CONST_CONFIG_VERSION = 11;

export * from './providers';
export * from './connections';
export * from './agents';

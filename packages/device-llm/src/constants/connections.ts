// @file: device-llm/constants/connections.ts
// Layer 2 — Connection 默认配置（连接标识符 + 运行时参数）。
// 职责：引用 Provider（通过 providerId）+ 命名 + 可选 tier 覆盖。
// 注意：Connection 不持有 apiKey（apiKey 在 Provider 层）。
// 默认连接在 LLMDeviceDriver.syncDefaultConnections() 中自动按 LLM_PROVIDERS 生成，
// 因此此文件只需定义公共的连接 ID 约定和运行时参数常量。

/** 系统默认连接 ID（对应 providers 中排名第一的 provider） */
export const LLM_DEFAULT_ID   = 'default';
export const LLM_DEFAULT_NAME = '默认';

/** LLM 请求超时（ms） */
export const DEFAULT_TIMEOUT      = 60000;
/** 最大重试次数 */
export const DEFAULT_MAX_RETRIES  = 3;
/** 重试基础延迟（ms） */
export const DEFAULT_RETRY_DELAY  = 1000;

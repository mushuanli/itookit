// #configManager/shared/types.js

/**
 * @fileoverview 应用程序共享的 TypeScript/JSDoc 类型定义。
 * @description
 * V2 改进:
 * - 为所有与 LLM 领域相关的类型添加了 "LLM" 前缀，以明确其上下文，
 *   避免在应用其他部分使用时产生歧义。例如 `AgentDefinition` -> `LLMAgentDefinition`。
 */

// --- 通用类型 ---
/**
 * @typedef {'string' | 'number' | 'boolean' | 'object' | 'array' | 'any'} DataType
 * @description 定义输入/输出槽的数据类型。
 */

// --- LLM 领域特定类型 ---
/**
 * @typedef {object} LLMAgentInputOutput
 * @description 定义 LLM Agent 的单个输入或输出。
 * @property {string} name - 输入/输出变量的名称 (例如, "product_description")。
 * @property {DataType} type - 变量的数据类型。
 * @property {string} [description] - 一个用户友好的描述。
 */

/**
 * @typedef {object} LLMModelInfo
 * @description 定义一个可用的大语言模型的信息。
 * @property {string} id - 模型的唯一标识符 (例如, "gpt-4o")。
 * @property {string} name - 一个用户友好的显示名称 (例如, "GPT-4 Omni")。
 */
/**
 * @typedef {object} LLMModelConfig
 * @description LLM 模型的详细配置。
 * @property {string} connectionId - LLMProviderConnection 的 ID。
 * @property {string} modelName - 模型标识符（如 "gpt-4o", "claude-sonnet-4"）。
 * @property {string} [systemPrompt] - 系统提示，指导 Agent 行为。
 * @property {number} [temperature=0.7] - 采样温度（0.0-2.0）。
 * @property {number} [maxTokens=2048] - 最大输出令牌数。
 * @property {number} [topP=1.0] - 核采样参数（0.0-1.0）。
 * @property {number} [topK] - Top-K 采样参数。
 * @property {number} [frequencyPenalty=0] - 频率惩罚（-2.0 到 2.0）。
 * @property {number} [presencePenalty=0] - 存在惩罚（-2.0 到 2.0）。
 * @property {string[]} [stopSequences] - 停止序列列表。
 * @property {number} [seed] - 随机种子（用于可复现性）。
 * @property {boolean} [streaming=false] - 是否启用流式输出。
 * @property {number} [timeout=60000] - 请求超时时间（毫秒）。
 * @property {object} [responseFormat] - 响应格式配置（如 JSON mode）。
 * @property {LLMToolsConfig} [tools] - 工具调用配置。
 */
/**
 * @typedef {object} LLMAgentDefinition
 * @description 定义一个可复用的 LLM Agent 模板。
 * @property {string} id - Agent 的唯一标识符。
 * @property {string} name - 用户友好的名称。
 * @property {string} [description] - 简短的说明。
 * @property {string} [icon] - 一个 emoji 或图标名称。
 * @property {string[]} [tags] - 用于分类的标签列表。
 * @property {number} [maxHistoryLength=10] - 表示发送给llm server时发送的最大历史消息数量。不设置时不限制，如果设置只发送多少轮历史记录。
 * @property {LLMModelConfig} config - 此 Agent 将使用的 LLMClient 的配置。
 * @property {object} interface - 定义此 Agent 如何连接到其他节点。
 * @property {LLMAgentInputOutput[]} interface.inputs - Agent 节点的输入槽。
 * @property {LLMAgentInputOutput[]} interface.outputs - Agent 节点的输出槽。
 */

/**
 * @typedef {object} LLMWorkflowNode
 * @description 定义工作流图中的单个节点。
 * @property {number} id - 在工作流内部唯一的节点 ID。
 * @property {string} type - 节点的类型 (例如, "agent/agent-creative-writer", "input/text")。
 * @property {Array<number>} [position] - 在画布上渲染的 [x, y] 坐标。
 * @property {object} [properties] - 特定于节点的配置值 (例如, "input/text" 节点的文本内容)。
 */

/**
 * @typedef {Array<number|string>} LLMWorkflowLink
 * @description 定义两个节点之间的连接，格式为：
 * [链接ID, 源节点ID, 源插槽索引, 目标节点ID, 目标插槽索引, 链接类型]
 */

/**
 * @typedef {object} LLMWorkflowDefinition
 * @description 定义一个完整的、可执行的工作流图。
 * @property {string} id - 工作流的唯一标识符。
 * @property {string} name - 用户友好的工作流名称。
 * @property {string} [description] - 简要说明工作流的功能。
 * @property {object} interface - 定义此工作流作为一个整体如何与外部世界连接。
 * @property {LLMAgentInputOutput[]} interface.inputs - 整个工作流的输入槽。
 * @property {LLMAgentInputOutput[]} interface.outputs - 整个工作流的输出槽。
 * @property {LLMWorkflowNode[]} nodes - 图中所有节点的数组。
 * @property {LLMWorkflowLink[]} links - 节点之间所有连接的数组。
 */

/**
 * @typedef {object} LLMProviderConnection
 * @description 定义一个到 LLM 提供商的连接配置。
 * @property {string} id - 连接的唯一标识符。
 * @property {string} name - 用户友好的名称 (例如, "我的 OpenAI 密钥")。
 * @property {string} provider - 提供商类型 (例如, "openai", "gemini")。
 * @property {string} apiKey - API 密钥。
 * @property {string} [baseURL] - 可选的 Base URL，用于自托管或代理端点。
 * @property {LLMModelInfo[]} [availableModels] - 可选的、此连接可用的模型列表。
 */

// --- 应用数据结构类型 ---
/**
 * @typedef {string} Tag
 * @description 定义单个标签。
 */

/**
 * @typedef {Array<Tag>} TagData
 * @description 定义全局标签在持久化层中的存储结构。
 */

/**
 * @typedef {object} LLMConfigData
 * @description 定义全局LLM配置在持久化层中的顶层存储结构。
 * @property {LLMProviderConnection[]} connections - 所有可用的提供商连接。
 * @property {LLMAgentDefinition[]} agents - 所有已定义的 Agent。
 * @property {LLMWorkflowDefinition[]} workflows - 所有已定义的工作流。
 */

/**
 * @typedef {object} ModuleFSTreeNodeMeta
 * @description 定义模块文件/目录节点的元数据。
 * @property {string} id - [V2] 新增：持久且唯一的标识符 (例如 UUID)。这是最重要的改动。
 * @property {string} ctime - 创建时间 (ISO 8601 格式字符串)。
 * @property {string} mtime - 最后修改时间 (ISO 8601 格式字符串)。
 * @property {Tag[]} [tags] - 关联的标签。
 */

/**
 * @typedef {object} ModuleFSTreeNode
 * @description 定义模块文件系统树中的一个节点（文件或目录）。
 * @property {string} path - 节点的完整路径。现在它只是一个可变属性。
 * @property {'file' | 'directory'} type - 节点的类型。
 * @property {ModuleFSTreeNodeMeta} meta - 节点的元数据。
 * @property {string} [content] - 文件内容 (仅对 'file' 类型有效)。
 * @property {ModuleFSTreeNode[]} [children] - 子节点数组 (仅对 'directory' 类型有效)。
 */

/**
 * @typedef {ModuleFSTreeNode} ModuleFSTree
 * @description 代表单个工作区的文件系统树的根节点。
 */

export {};

// src/services/dataService.js

import * as storage from './storageService.js';
import { db } from '../common/db.js';
import { generateId } from '../common/utils.js';
import { INITIAL_ANKI_CONTENT } from '../common/config.js';
import { getDefaultApiPath } from './llm/llmProviders.js';

// ===================================================================
//                        应用初始化与全局服务
// ===================================================================


/**
 * [最终重构] 视图切换服务。
 * 不再管理状态，而是派发一个全局事件，由 main.js 监听并处理。
 */
export function switchView(viewName) {
    if (['anki', 'task', 'agent', 'settings'].includes(viewName)) {
        window.dispatchEvent(new CustomEvent('app:switchView', {
            detail: { view: viewName }
        }));
    }
}


// ===================================================================
//                        Anki 模块服务
// ===================================================================

function anki_parseAndStructureHeadings(content) {
    const headingRegex = /^(#{1,2})\s+(.+)$/gm;
    const structuredHeadings = [];
    let lastH1 = null;
    let match;

    while ((match = headingRegex.exec(content)) !== null) {
        const level = match[1].length;
        const text = match[2].trim();
        const headingContent = (content.substring(match.index + match[0].length).split(/^#{1,2}\s/m)[0] || '').trim();
        
        const heading = {
            id: generateId(),
            text,
            level,
            content: `#`.repeat(level) + ` ${text}\n\n` + headingContent,
            children: level === 1 ? [] : undefined
        };

        if (level === 1) {
            structuredHeadings.push(heading);
            lastH1 = heading;
        } else if (level === 2 && lastH1) {
            lastH1.children.push(heading);
        }
    }
    return structuredHeadings;
}


// ===================================================================
// [重构] SETTINGS & AGENT (共享数据) 服务
// ===================================================================

const DEFAULT_API_CONFIG = { id: 'default_deepseek_api', name: 'DeepSeek (默认)', provider: 'deepseek', apiKey: '', models: 'chat:deepseek-chat,reasoner:deepseek-reasoner' };

// [ALIGNMENT] 恢复了原版完整的 DEFAULT_AGENTS 数据
const DEFAULT_AGENTS = [
    {
        id: 'default_agent_nanjing_guide',
        name: '南京历史小导游',
        avatar: '史',
        model: `${DEFAULT_API_CONFIG.id}:reasoner`,
        systemPrompt: "🎓 角色指令：你好！我是你的专属南京历史小导游。我的名字叫“金陵通”，对南京这座六朝古都的每一块砖、每一段历史都了如指掌。我将以生动有趣的方式，带你穿越时空，探索南京的魅力。我的性格会根据你选择的模式变化，就像一位真正的导游，时而风趣，时而严谨。\n\n🔄 核心导览模式：\n*   故事家 (Storyteller) → 语气风格：亲切随和，像一位学长/学姐。我会用讲故事的方式，把枯燥的历史变得鲜活起来，充满情感和趣味，让你身临其境。\n*   讲解员 (Docent) → 语气风格：清晰准确，像一位博物馆的专业讲解员。我会为你提供结构化的信息、关键时间点和准确的历史事实，帮你梳理知识脉络。\n*   历史侦探 (History Detective) → 语气风格：充满好奇与思辨，像一位和你一起探案的伙伴。我会引导你发现历史事件之间的联系，分析文物背后的深层含义，提出“为什么”，激发你的思考。\n\n🧬 互动说明：\n1.  模式匹配：我会严格按照你选择的模式（故事家、讲解员、历史侦探）来与你交流。\n2.  知识储备：我的知识库涵盖了南京从古至今的关键历史时期（如六朝、南唐、明朝、民国）、重要人物（如朱元璋、孙中山）以及标志性文物古迹（如明孝陵、总统府、中山陵、南京城墙、夫子庙、朝天宫、南京博物院馆藏等）。\n3.  智能追问：如果你的问题不够具体，我会像导游一样追问。\n4.  连续记忆：我会记住我们聊过的话题。\n5.  拒绝乏味：我的回答会避免像教科书一样枯燥。\n6.  模式切换：你随时可以让我切换模式。切换时，我会说“好的，现在切换到【XX模式】”，然后调整我的语气和回答方式。\n\n📦 输出格式参考：\n*   在 【讲解员模式】下，我会多使用列表、时间轴和要点总结。\n*   在 【故事家模式】下，我会使用更多的描述性语言。\n*   在 【历史侦探模式】下，我会多用提问、假设和对比分析。",
        hint: '你好！我是你的专属南京历史小导游“金陵通”。想了解南京的什么故事？比如，可以这样问我：<br><b>模式：故事家 — 任务：给我讲讲夫子庙旁边的乌衣巷有什么好玩的故事？</b>',
        tags: ['历史', '文化', '旅游'],
        sendHistory: true,
    },
    {
        id: 'default_agent_english_tutor',
        name: '英语导师',
        avatar: '英',
        model: `${DEFAULT_API_CONFIG.id}:chat`,
        systemPrompt: "🎓 角色指令：你好！我是智能英语导师「牛津通」，专注中学英语教学。拥有系统的知识库和动态教学策略，能根据你的学习阶段个性化辅导。\n\n🔄 三维学习模式：\n*   【单词向导】→ 沉浸式词汇学习：词根解析/趣味联想/场景记忆\n*   【语法专家】→ 系统化语法精讲：错题透析/分层训练/对比分析\n*   【读写教练】→ 实战能力培养：文本精读/写作框架/AI批改\n\n✨ 核心功能矩阵：\n1. 词汇体系：中考高频词库｜近义词辨析｜词源故事\n2. 语法诊所：句子成分图解｜时态三维训练｜易错点预警\n3. 读写实验室：阅读理解三步法｜作文多维评估｜经典句式仿写\n4. 拓展模块：影视配音练习｜文化冷知识｜考试策略指南\n\n🧠 智能教学协议：\n1. 模式匹配：严格按所选模式输出内容\n2. 错题驱动：支持拍照诊断知识盲区\n3. 动态调节：智能调整题目难度（基础→挑战）\n4. 记忆锚点：周期性推送薄弱点强化练习\n5. 文化融合：教学中渗透英美文化背景",
        hint: '你好！我是你的中学英语导师「牛津通」。完整功能列表：<br>🔍 <b>单词向导模式</b>：词根解析｜高频词汇｜场景记忆（例：用电影台词记"vivid"）<br>📖 <b>语法专家模式</b>：句子图解｜时态训练｜错题诊断（例：虚拟语气对比表）<br>✍️ <b>读写教练模式</b>：作文批改｜精读策略｜仿写训练（例：中考作文评分+改写）<br>🌍 <b>拓展功能</b>：影视配音｜文化常识｜考试技巧<br>试试这样问我：<b>模式：单词向导 → 任务：用超级英雄故事帮我记10个形容词</b>',
        tags: ['教育', '语言', '学习'],
        sendHistory: true,
    },
    {
    "id": "default_agent_word_assistant_v2",
    "name": "单词/句子助手",
    "avatar": "文",
        model: `${DEFAULT_API_CONFIG.id}:chat`,
        systemPrompt: `
# 角色：英语单词与句子辨析专家

## 核心指令
你是一个专注于**中学英语**词汇与句子分析的专家。你的任务是根据用户输入的内容（单词、词组或句子），提供清晰、结构化、符合中学生认知水平的解释。你必须严格遵循以下【工作流程】和【输出格式】。

## 工作流程
1.  **输入分析**：智能分析用户输入。
    *   **判断为句子**：如果输入内容包含主谓结构，或以句号、问号、感叹号结尾，则判定为句子，进入【整句分析模式】。
    *   **判断为多词**：如果输入内容不构成句子，但用逗号（,）、分号（;）、斜杠（/）或中文顿号（、）分隔，则进入【多词模式】。
    *   **判断为单次**：如果不属于以上两种情况，则进入【单一词模式】。

2.  **单一词模式**：如果用户只输入了一个单词或词组。
    *   提供该词的核心释义。
    *   列出其在中学阶段最常见的近义词或相关词。
    *   对这些词进行详细的词义辨析。

3.  **多词模式**：如果用户输入了多个用分隔符隔开的单词或词组。
    *   分别解释每个词的核心释义。
    *   **重点**：对比分析这些词之间的区别，包括用法、语境、感情色彩等。
    *   （可选）如果适用，可以补充其他相关的近义词。

4.  **整句分析模式**：如果用户输入了一个或多个完整的句子。
    *   **翻译**：首先提供句子的中文翻译。
    *   **核心短语**：从句子中提取出重要的、中学生应该掌握的核心短语，并给出其中文意思。
    *   **语法分析**：对句子进行简单的语法结构拆解，包括主干、成分、时态等。

## 输出格式 (必须严格遵守)
使用 Markdown 格式化你的回答，确保结构清晰。

### 格式模板 (单一词模式)
\`\`\`markdown
### 📖 单词解析：[用户输入的单词]

**基本释义**
*   **[词性1]**: [解释1]
*   **[词性2]**: [解释2]

**🔍 近义词辨析**
*   **[近义词1]**: 
    *   **释义**: [简要解释]
    *   **辨析**: [与原词的区别，侧重用法或语境]
    *   **例句**: [一个符合中学生水平的简单例句]
*   **[近义词2]**: 
    *   **释义**: [简要解释]
    *   **辨析**: [与原词的区别]
    *   **例句**: [例句]
...
\`\`\`

### 格式模板 (多词模式)
\`\`\`markdown
### 🔄 多词辨析：[词1], [词2], ...

**1. [词1]**
*   **释义**: [词性] [解释]

**2. [词2]**
*   **释义**: [词性] [解释]
...

**🎯 核心区别**
1.  **[区别点1，如：使用范围]**: [详细说明，例如：A 通常用于正式场合，而 B 更加口语化。]
2.  **[区别点2，如：感情色彩]**: [详细说明，例如：C 带有褒义，而 D 是中性词。]
3.  **[区别点3，如：搭配习惯]**: [详细说明，例如：A 后面常跟 of，而 B 常跟 for。]

**✅ 快速总结**
*   想表达 **[某个场景或含义]** 时，用 **[词A]**。
*   想强调 **[另一个场景或含义]** 时，用 **[词B]**。
\`\`\`

### 格式模板 (整句分析模式)
\`\`\`markdown
### 📝 整句分析：[用户输入的句子]

**1. 句子翻译**
*   [句子的中文翻译]

**2. 核心短语**
*   **[短语1]**: [短语的中文意思]
*   **[短语2]**: [短语的中文意思]
*   ...

**3. 语法结构**
*   **主干**: [主语] + [谓语] + ([宾语])
*   **成分**:
    *   **主语 (Subject)**: [句子中的主语部分]
    *   **谓语 (Verb)**: [句子中的谓语部分]
    *   **宾语 (Object)**: [句子中的宾语部分，如果没有则写“无”]
    *   **其他成分**: [例如：in the morning 是时间状语 (Adverbial of Time)；that I met yesterday 是定语从句 (Attributive Clause)，修饰 a boy。]
*   **时态**: [例如：一般现在时 (Simple Present Tense)]
*   **从句分析**: [如果句子包含从句，详细说明其类型和功能。如果没有则写“无”]
\`\`\`

## 约束条件
*   **专注中学阶段**：所有近义词、例句、短语和语法分析都必须是中学英语教学大纲内的常见内容，避免超纲和过于复杂的术语。
*   **语言简洁**：解释要通俗易懂。
*   **格式严格**：必须严格按照上述 Markdown 模板输出，根据输入类型选择对应的模板。
`,
    "hint": `你好！我是你的单词/句子助手。我可以帮你深入理解词汇和句子！<br>
✍️ **单个词查询**: 比如输入 <code>clever</code><br>
🔄 **多个词辨析**: 比如输入 <code>clever, smart, wise</code><br>
📝 **整句分析**: 比如输入 <code>The book which I bought yesterday is very interesting.</code>`,
        tags: ['教育', '语言', '工具'],
        sendHistory: false // 设为 false，每次查询都是独立的，不受历史记录干扰
    }
];



/**
 * [重构] 加载所有 Settings 和 Agent 模块共享的数据。
 * 此函数负责加载、播种默认数据，并返回一个干净的数据对象，不产生副作用。
 */

export async function loadSettingsAndAgentData() {
    let { apiConfigs, agents, topics, history } = await storage.loadAgentData();
    apiConfigs = apiConfigs || [];
    agents = agents || [];

    let needsPersistence = false;

    // 播种默认 API 配置
    if (!apiConfigs.some(c => c.id === DEFAULT_API_CONFIG.id)) {
        apiConfigs.push(DEFAULT_API_CONFIG);
        needsPersistence = true;
    }

    // 播种默认 Agents
    DEFAULT_AGENTS.forEach(defaultAgent => {
        if (!agents.some(p => p.id === defaultAgent.id)) {
            agents.push(defaultAgent);
            needsPersistence = true;
        }
    });
    
    const sharedData = {
        apiConfigs,
        agents,
        topics: topics || [],
        history: history || [],
    };

    // 如果添加了默认数据，则立即回写到数据库
    if (needsPersistence) {
        await storage.saveAgentData(sharedData);
    }

    return sharedData;
}


// --- [新增] 细粒度的数据库操作函数，供 settingsStore 使用 ---

export async function addApiConfig(configData) {
    const newConfig = { ...configData, id: generateId() };
    await db.agent_apiConfigs.put(newConfig);
    return newConfig;
}

export async function updateApiConfig(id, updates) {
    const config = await db.agent_apiConfigs.get(id);
    if (!config) throw new Error("API config not found");
    const updatedConfig = { ...config, ...updates };
    await db.agent_apiConfigs.put(updatedConfig);
    return updatedConfig;
}

export async function deleteApiConfig(id) {
    // 健壮性检查：确保没有 Agent 正在使用此配置
    const agentsUsingConfig = await db.agent_agents.filter(agent => agent.model.startsWith(id + ':')).count();
    if (agentsUsingConfig > 0) {
        throw new Error(`无法删除，仍有 ${agentsUsingConfig} 个 Agent 正在使用此 API 配置。`);
    }
    await db.agent_apiConfigs.delete(id);
}

export async function addAgent(agentData) {
    const newAgent = { ...agentData, id: generateId() };
    await db.agent_agents.put(newAgent);
    return newAgent;
}

export async function updateAgent(id, updates) {
    const agent = await db.agent_agents.get(id);
    if (!agent) throw new Error("Agent not found");
    const updatedAgent = { ...agent, ...updates };
    await db.agent_agents.put(updatedAgent);
    return updatedAgent;
}

export async function deleteAgent(id) {
    await db.agent_agents.delete(id);
}

/**
 * [新增] 更新单个全局设置项
 * @param {string} key - The key of the setting to update.
 * @param {*} value - The new value for the setting.
 */
export async function updateGlobalSetting(key, value) {
    await db.global_appState.put({ key, value });
}


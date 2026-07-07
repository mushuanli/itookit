# LLM 计费功能设计与实现

## 背景

为 LLM 应用引入模型定价配置和费用统计功能，支持：
- 多 provider、多模型版本统一定价（同族模型归一个逻辑 id）
- Anthropic Prompt Caching 的 cache_write / cache_read 价格
- 按时间（日/周/月）、provider、session 三维统计费用

---

## 架构决策

| 决策 | 说明 |
|---|---|
| pricing.json = 运行期覆盖 | `providers.ts` 内置常量为编译期 fallback，pricing.json 优先级更高，首次启动自动写入 |
| cost.seq = 费用流水账 | seq 文件（K-V store），key 设计天然支持三维查询 |
| 类型全在 common 包 | 加载/写入工具函数在 device-llm，遵循层次依赖方向 |
| cache 字段全部可选 | 向后兼容已有磁盘数据和调用方，非 Anthropic provider 自然省略 |
| 不再写入 DailyCost | `LLMConnection.dailyCosts` 保留类型定义（兼容存量数据展示），不再写入，统一走 cost.seq |
| UI 查询走服务方法 | `queryCosts()` / `getPricingConfig()` 通过 `ILLMManagementService` → `VFSAgentService` 委托链，不走 ioctl |

---

## pricing.json — 模型定价配置

### 存储位置

VFS `etc` 模块 `/llm/pricing.json`
物理路径：`~/.mindos/module/etc/llm/pricing.json`

### 格式

```json
{
  "model_pricing": [
    {
      "id": "claude-opus",
      "price": [15.0, 75.0, 18.75, 1.5],
      "providers": {
        "anthropic": ["claude-opus-4-8-20251101", "claude-opus-4-6-20250514"],
        "cloudapi":  ["claude-opus-4-6"]
      },
      "names": ["claude-opus-*"]
    },
    {
      "id": "deepseek-v4-pro",
      "price": [0.55, 2.19, 0.55, 0.0],
      "providers": {
        "deepseek":   ["deepseek-v4-pro"],
        "volcengine": ["deepseek-v4-pro-260425"]
      },
      "names": ["*-v4-pro*"]
    },
    {
      "id": "default",
      "price": [0, 0, 0, 0],
      "providers": {}
    }
  ]
}
```

### price 字段说明

```
price = [input, output, cache_write, cache_read]
单位：USD / million tokens
```

### providers 字段语义

| 值 | 含义 |
|---|---|
| key absent | 该 provider 不支持此模型 |
| `[]` | 路由时使用逻辑 id（entry.id）本身 |
| `["a", "b"]` | 路由使用 "a"，反向查找匹配 "a" 或 "b" |

### names 字段（按 model name 归属定价）

`names` 是 `providers` 的补充机制，按 model **名称**（而非 providerId+modelId）进行匹配。支持 `*` 通配符。

| 值 | 含义 |
|---|---|
| `"claude-opus"` | 精确匹配 modelId 为 "claude-opus" 的模型 |
| `"claude-opus-*"` | 匹配所有以 "claude-opus-" 开头的 model ID |
| `"*-sonnet-*"` | 匹配所有包含 "-sonnet-" 的 model ID |
| 未设置 / `[]` | 不参与 names 匹配 |

**适用场景：** 自定义 provider 的模型名格式未知，或跨 provider 的同一系列模型统一定价。

### default 条目（全局 fallback）

`id = "default"` 为保留 ID，作为全局 fallback 定价。当 `providers` 和 `names` 都未命中时，使用此条目的价格。通常设 `price: [0, 0, 0, 0]`（即不计费）。

`default` 条目特征：
- `providers` 始终为空（不参与 providers 精确匹配）
- 在定价列表中始终排最后
- 不可删除、不可修改 ID

### 定价匹配优先级（三级）

```
1. providers 精确匹配     — providerId + modelId 命中
2. names / id 匹配        — modelId === entry.id 或匹配 names[]（支持 * 通配符）
3. default fallback       — id = "default" 的条目
```

实现函数 `lookupPricingEntry()`（`common/src/interfaces/llm/pricing.ts`）按上述优先级遍历 `model_pricing[]`，第一层命中（providers）立即返回，第二层取第一个匹配，都未命中则返回 default。

通配符匹配由辅助函数 `matchesName(target, pattern)` 实现：不含 `*` 时严格相等，含 `*` 时转为 RegExp（`*` → `.*`）。

### 加载策略

- 启动时由 `LLMDeviceDriver.init()` 加载
- 文件不存在 → 从内置 `MODEL_PRICING` 常量写入默认文件再返回
- JSON 解析失败 → console.warn，使用内置常量作为 fallback
- 加载后对所有 provider 的 model 调用 `applyPricingToModel()` 覆盖价格字段

### 内置默认值

`packages/device-llm/src/constants/providers.ts` 中的 `MODEL_PRICING` 常量同时作为：
1. 编译期 fallback（pricing.json 不存在时）
2. 首次启动时写入 pricing.json 的默认内容
3. 末尾始终包含 `default` 条目

---

## CostEditor — 费用管理 UI

位于 App Settings → 费用统计，提供两大功能：

### 仪表盘 (Dashboard)

| 功能 | 说明 |
|---|---|
| 时间切换 | 今日 / 本周 / 本月，日期边界在前端计算 |
| Provider 过滤 | 下拉选择 All / 按 providerId 筛选 |
| 汇总卡片 | 总费用 ($)、总 Tokens（分 Input/Output/Cache）、总请求数 |
| Provider 分组 | 每行显示 provider 名 + 占比条形图 + 费用 + Tokens |
| Top 10 Sessions | 表格：Session ID / Provider / Model / Cost / Tokens / 请求数 |

数据流：`agentService.queryCosts(filter)` → `CostStore.queryAll()` → `aggregateCostRecords()` 聚合后渲染。

### 定价配置 (Pricing Config)

- 列表展示所有 `ModelPricingEntry`（可编辑 ID、4 个价格、names 别名）
- **default 行**特殊渲染：ID 固定不可编辑，行首显示 `fallback` badge，不可删除
- 名称别名输入框支持 `*` 通配符（逗号分隔多个 pattern）
- 添加条目自动插入在 default 之前
- 保存前校验 ID 非空且无重复（default 除外）
- 保存调用 `agentService.writePricing(config)`

### 相关文件

| 文件 | 说明 |
|---|---|
| `packages/llm-ui/src/editors/CostEditor.ts` | CostEditor 完整实现 |
| `packages/app-settings/src/styles/_cost.css` | `.cost-*` BEM 样式 |
| `packages/app-settings/src/engine/SettingsEngine.ts` | `SETTINGS_PAGES` 注册 `'cost'` 条目 |
| `packages/app-settings/src/factories/settingsFactory.ts` | `case 'cost'` 路由 |

---

## cost.seq — 费用流水账

### 存储位置

VFS `etc` 模块 `/llm/cost.seq`（type: `seqfile`）
物理路径：`~/.mindos/module/etc/llm/cost.seq`

### Key 格式

```
{sessionId}|{providerId}|{date}
```

示例：
```
sess-abc123|anthropic|2026-07-04
sess-abc123|deepseek|2026-07-04   ← 同 session 换 provider，独立记录
sess-xyz456|anthropic|2026-07-04
sess-abc123|anthropic|2026-07-05  ← 次日新建记录
```

**设计要点：**
- `|` 作分隔符（避免与 sessionId / providerId 中的 `-` 歧义）
- 同一 session 在同一天切换 provider → 不同 key → 独立记录
- 同一 session 跨天 → 不同 key → 独立记录，天然按日分割

### Value 格式（JSON 字符串）

```typescript
interface CostRecord {
    sessionId: string;
    providerId: string;
    connectionId: string;       // 比 provider 更细粒度，记录实际连接
    modelId: string;            // 实际使用的模型 ID
    date: string;               // YYYY-MM-DD
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens?: number;  // cache_creation_input_tokens（Anthropic）
    cacheReadTokens?: number;   // cache_read_input_tokens（Anthropic）
    cost: number;               // USD
    requests: number;           // 累计请求次数
}
```

### 累加写入逻辑

每次请求完成后：

```
key = `${sessionId}|${providerId}|${today}`
existing = seq.getEntry('/llm/cost.seq', key)

if existing:
    record = JSON.parse(existing)
    record.inputTokens  += usage.inputTokens
    record.outputTokens += usage.outputTokens
    record.cacheWriteTokens = (record.cacheWriteTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
    record.cacheReadTokens  = (record.cacheReadTokens  ?? 0) + (usage.cacheReadTokens  ?? 0)
    record.cost     += usage.cost
    record.requests += 1
else:
    record = { sessionId, providerId, connectionId, modelId, date, ...usage, requests: 1 }

seq.setEntry('/llm/cost.seq', key, JSON.stringify(record))
```

### 三维查询

全部通过 `CostStore` 封装（兼容 LocalFS 后端，不依赖 `queryEntries`）：

| 查询维度 | 方式 | 效率 |
|---|---|---|
| 按 session | `walkEntries(keyPrefix='{sessionId}\|')` | 高效（keyPrefix 过滤） |
| 按 session + provider | `walkEntries(keyPrefix='{sessionId}\|{providerId}\|')` | 高效 |
| 按 provider | 全量 walk + `record.providerId === 'xxx'` | O(n) |
| 按日期 | 全量 walk + `record.date === 'YYYY-MM-DD'` | O(n) |
| 按日期范围 | 全量 walk + `record.date >= start && record.date <= end` | O(n) |

### ioctl 查询接口

```typescript
// 通过 /dev/llm ioctl 调用
LLM_IOCTL.QUERY_COSTS_BY_SESSION:  'query-costs-by-session'
// arg: sessionId: string → CostRecord[]

LLM_IOCTL.QUERY_COSTS_BY_PROVIDER: 'query-costs-by-provider'
// arg: { providerId: string; dateFrom?: string; dateTo?: string } → CostRecord[]

LLM_IOCTL.QUERY_COSTS_ALL:         'query-costs-all'
// arg: { providerId?: string; dateFrom?: string; dateTo?: string } | undefined → CostRecord[]
```

### 服务方法查询接口

UI 层不走 ioctl，通过 `ILLMManagementService` 方法调用：

```typescript
// ILLMManagementService（common/src/interfaces/llm/agent.ts）
queryCosts(filter?: {
    dateFrom?: string;   // YYYY-MM-DD
    dateTo?: string;     // YYYY-MM-DD
    providerId?: string;
}): Promise<CostRecord[]>;

getPricingConfig(): ModelPricingConfig;  // 同步，返回内存快照
```

委托链：`CostEditor → agentService.queryCosts() → VFSAgentService → LLMDeviceDriver → CostStore.queryAll()`

---

## 关键类型定义

所有类型定义在 `packages/common/src/interfaces/llm/pricing.ts`：

```typescript
interface ModelPricingEntry {
    id: string;                              // 逻辑定价 id，如 "claude-opus"；"default" 为全局 fallback
    price: [number, number, number, number]; // [input, output, cache_write, cache_read]
    providers: Record<string, string[]>;
    names?: string[];                        // 模型名称别名，支持 * 通配符
}

interface ModelPricingConfig {
    model_pricing: ModelPricingEntry[];
}

interface CostRecord {
    sessionId: string;
    providerId: string;
    connectionId: string;
    modelId: string;
    date: string;
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens?: number;
    cacheReadTokens?: number;
    cost: number;
    requests: number;
}

// 工具函数
function lookupPricingEntry(config, providerId, actualModelId): ModelPricingEntry | undefined
  // 三级匹配：providers → names（支持 * 通配符） → default fallback
function matchesName(target, pattern): boolean
  // 通配符匹配辅助，* → .*
function extractPrices(entry): { inputPricePerMillion, outputPricePerMillion, cacheWritePricePerMillion, cacheReadPricePerMillion }
function aggregateCostRecords(records): { inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, cost, requests }
```

`ILLMManagementService` 新增（`packages/common/src/interfaces/llm/agent.ts`）：

```typescript
queryCosts(filter?): Promise<CostRecord[]>;
getPricingConfig(): ModelPricingConfig;
```

`LLMModel` 新增字段（`packages/common/src/interfaces/llm/connection.ts`）：

```typescript
cacheWritePricePerMillion?: number;
cacheReadPricePerMillion?: number;
```

`SessionTokenUsage` 新增字段（`packages/llm-engine/src/core/types.ts`）：

```typescript
cacheWriteTokens?: number;
cacheReadTokens?: number;
// cacheTokens 保留（@deprecated，填 cacheReadTokens 值向后兼容）
```

---

## 数据流

```
LLM 请求完成
    ↓
task-runner.ts：recordUsageCost(connectionId, sessionId, usage)
    ↓
agent-resolver.ts：getConnection(connectionId) → 得到 providerId + modelId
    ↓
agentService.recordCost({ sessionId, providerId, connectionId, modelId, usage })
    ↓
VFSAgentService → LLMDeviceDriver.recordCost()
    ↓
CostStore.recordCost() → seq.setEntry('/llm/cost.seq', key, JSON)
```

```
CostEditor (Dashboard)
    ↓
agentService.queryCosts({ dateFrom, dateTo, providerId? })
    ↓
VFSAgentService → LLMDeviceDriver.queryCosts()
    ↓
CostStore.queryAll(filter)
```

```
CostEditor (Pricing Config)
    ↓
agentService.getPricingConfig()  → 同步，LLMDeviceDriver 内存快照
agentService.writePricing(config) → 写入 VFS + 重载 provider 模型价格
```

---

## 文件索引

| 文件 | 说明 |
|---|---|
| `packages/common/src/interfaces/llm/pricing.ts` | 核心类型：`ModelPricingEntry`（含 `names`）、`CostRecord`、`lookupPricingEntry()`（三级匹配）、`matchesName()`、`extractPrices()`、`aggregateCostRecords()` |
| `packages/common/src/interfaces/llm/connection.ts` | `LLMModel` 增加 cache 价格字段 |
| `packages/common/src/interfaces/llm/agent.ts` | `ILLMManagementService` 增加 `recordCost()`、`writePricing()`、`queryCosts()`、`getPricingConfig()` |
| `packages/device-llm/src/constants/pricing.ts` | pricing.json 加载/写入工具、`applyPricingToModel()` |
| `packages/device-llm/src/constants/providers.ts` | 内置 `MODEL_PRICING` 定价表（含 `default` 条目）+ cache 价格常量 |
| `packages/device-llm/src/cost/cost-store.ts` | `CostStore` — cost.seq 读写封装，支持 `queryAll()` / `queryBySession()` / `queryBySessionProvider()` |
| `packages/device-llm/src/device/llm-device-driver.ts` | 集成 pricing + cost store；ioctl 命令 + `queryCosts()` / `getPricingConfig()` 服务方法 |
| `packages/device-llm/src/constants/llm-loader.ts` | `.llm` 格式增加 `pricing?` 字段 |
| `packages/llm-engine/src/session/agent-resolver.ts` | `recordUsageCost` 增加 `sessionId`，写 cost.seq |
| `packages/llm-engine/src/session/task-runner.ts` | 调用传入 `sessionId` |
| `packages/llm-engine/src/services/vfs-agent-service.ts` | 委托 `recordCost()`、`writePricing()`、`queryCosts()`、`getPricingConfig()` |
| `packages/llm-ui/src/editors/CostEditor.ts` | CostEditor — 仪表盘 + 定价配置 UI |
| `packages/llm-ui/src/editors/llm-import.ts` | `.llm` 导入时写入 pricing.json |
| `packages/app-settings/src/styles/_cost.css` | CostEditor 专用 `.cost-*` BEM 样式 |
| `packages/app-settings/src/engine/SettingsEngine.ts` | 注册 `'cost'` 设置页条目 |
| `packages/app-settings/src/factories/settingsFactory.ts` | `case 'cost'` 路由到 `CostEditor` |

---

## .llm 文件扩展

`.llm` 文件新增可选 `pricing` 字段：

```yaml
providers:
  - id: rdsec
    # ...

pricing:
  - id: claude-opus
    price: [5.0, 25.0, 6.25, 0.5]
    providers:
      rdsec: ["claude-4.8-opus-anthropic", "claude-4.6-opus"]
    names: ["claude-opus-*"]
  - id: claude-sonnet
    price: [3.0, 15.0, 3.75, 0.3]
    providers:
      rdsec: ["claude-4.6-sonnet-anthropic", "claude-4.6-sonnet"]
  - id: default
    price: [0, 0, 0, 0]
    providers: {}
```

- 导入时：若含 `pricing` 字段，写入 VFS `/llm/pricing.json` 并重载 provider 价格
- 导出时：调用 `exportBundleToLLM(providers, connections, { pricing })` 可选包含

---

## 验证方式

1. **类型检查**：`npx tsc -p packages/common/tsconfig.json --noEmit` 等各包无错
2. **pricing 加载**：在 `~/.mindos/module/etc/llm/pricing.json` 放置配置，启动后检查模型 `inputPricePerMillion` 是否被覆盖
3. **首次写入**：删除 pricing.json 后重启，检查是否自动创建并填入 `MODEL_PRICING` 默认内容
4. **cost.seq 写入**：发几条请求（含跨 provider），读取 cost.seq，验证 key 格式和累加逻辑
5. **三维查询**：分别调用 `QUERY_COSTS_BY_SESSION`、`QUERY_COSTS_BY_PROVIDER`、`QUERY_COSTS_ALL` ioctl
6. **pricing 导入/导出**：在 `.llm` 文件加 `pricing:` 字段，导入后检查 VFS `/llm/pricing.json`
7. **CostEditor 仪表盘**：打开 App Settings → 费用统计，验证时间切换 / Provider 过滤 / Top 10 数据正确
8. **CostEditor 定价配置**：编辑模型价格和 names 别名，保存后验证 `pricing.json` 内容更新、default 行不可删除

# CLAUDE.md — @itookit/common

共享接口、类型、工具函数和 i18n 的基础包。**零运行时依赖**，所有 `@itookit/*` 包的类型源头。

## Architecture

此包**不包含实现逻辑**，只导出 interfaces / types / utils / components / i18n。

```
src/
├── index.ts              ← 统一导出入口
├── interfaces/           ← 接口定义 (fs/, llm/, agent/, tools/, skills/, tty/)
├── utils/                ← 工具函数 (generateUUID, debounce, safeJsonParse, MarkdownUtils...)
├── components/           ← 基础 UI 组件 (BaseSettingsEditor, UIComponents)
├── i18n/                 ← zh-CN.ts / en.ts / icons.ts / t()
├── events/               ← 导航事件常量
└── types/                ← 杂项类型
```

接口详情: [接口目录](./interface-catalog.md)

## Conventions

- **所有 cross-package 类型必须定义在此包**，其他包通过 `import type { X } from '@itookit/common'` 引用
- 接口用 `interface`（非 `type`），以支持 declaration merging
- 错误类统一继承 `FSError`
- i18n 添加字符串：先在 `zh-CN.ts` 加 key，再在 `en.ts` 加对应翻译
- 图标从 `icons.ts` 导入，**禁止**在组件中硬编码 emoji
- `FSNode` 是 discriminated union — 使用前先 type-narrow（检查 `type` 字段）

# C1 - 系统上下文图

## 概述

系统上下文图展示 itookit 系统与外部角色和外部系统之间的高层交互。

## 用户

- **最终用户** — 使用 itookit 工作区进行文档编辑、AI 对话和知识管理

## 外部系统

| 外部系统 | 交互方式 | 说明 |
|---|---|---|
| OpenAI API | HTTPS/SSE | GPT-4o、o3 等模型推理调用 |
| Anthropic API | HTTPS/SSE | Claude 3.5/4 系列模型推理调用 |
| Gemini API | HTTPS/SSE | Gemini 2.0/2.5 模型推理调用 |
| MCP 服务器 | MCP 协议 | 外部数据库/API 等服务集成 |
| 本地文件系统 | Node.js fs / SQLite | 本地文件存储 (Node/Electron) |
| 浏览器存储 | IndexedDB | 浏览器端持久化存储 |
| 同步服务器 | HTTP (diff-based) | 可选的远程文件同步 (Hono) |

## 生成 PlantUML 图

```bash
# 需要安装 PlantUML (Java)
plantuml doc/c4/c1-context.puml -tpng
```

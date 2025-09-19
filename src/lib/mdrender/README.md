# 模块：MDExRenderer

## 1. 概述

`MDExRenderer` 是一个核心服务模块，负责将包含Markdown及多种自定义扩展语法的文本，高效地渲染成交互式的HTML内容。它遵循无状态和单一职责的设计原则，是整个应用富文本显示的基础。

## 2. 功能特性

-   **标准Markdown**：支持GitHub Flavored Markdown (GFM)，包括表格、代码块、列表等。
-   **GFM任务列表**：支持 `- [ ]` 和 `- [x]` 语法，并渲染为可交互的复选框。
-   **Mermaid图表**：自动渲染 ` ```mermaid ` 代码块中的图表。
-   **MathJax公式**：自动渲染LaTeX数学公式（行内 `$...$` 和块级 `$$...$$`）。
-   **Cloze扩展 (记忆卡片)**：
    -   语法：`--要隐藏的内容--`
    -   带音频：`--内容--^^audio:发音文本^^`
    -   带定位符：`--[locator1]内容--` (用于确保即使内容修改，ID也不变)
-   **可折叠块扩展**：
    -   基本语法： `::> 标题` 后跟4个空格缩进的内容。
    -   带任务状态：`::> [ ] 未完成任务` 或 `::> [x] 已完成任务`。
-   **标题定位**：自动为所有 `<h1>` 和 `<h2>` 标题生成唯一的ID，便于页面内锚点跳转。

## 3. 依赖

本模块依赖以下全局库，请确保它们已在HTML中引入：

-   `marked.min.js`
-   `mermaid.min.js`
-   `MathJax.js`

## 4. API接口说明

该模块以一个静态类 `MDExRenderer` 的形式提供服务，只有一个公共方法。

### `MDExRenderer.render(element, markdownText, options)`

这是一个 **异步** (`async`) 方法，用于执行完整的渲染流程。

#### **参数**

-   `element` (`HTMLElement`): **必需**。渲染结果将被注入的目标DOM元素。
-   `markdownText` (`string`): **必需**。包含Markdown及扩展语法的原始文本字符串。
-   `options` (`Object`): **可选**。一个用于提供额外上下文的配置对象。
    -   `options.cloze` (`Object`): 如果文本中包含Cloze语法，则**必须**提供此对象。
        -   `fileId` (`string`): 当前文件/笔记的唯一ID。用于和Cloze内容一起生成一个稳定的、全局唯一的ID。
        -   `states` (`Object`): 一个键值对对象，存储了所有Cloze的当前状态。
            -   `key`: Cloze的全局唯一ID。
            -   `value`: 状态对象，例如 `{ state: 'new', tempVisible: false, due: 167... }`。渲染器会根据 `tempVisible` 决定是否隐藏内容。

#### **返回值**

-   `Promise<void>`: 该Promise在所有内容（包括异步的Mermaid和MathJax）都渲染完成后解决。

#### **使用示例**

假设你有一个 `ankiStore` 管理状态，并希望在 `previewEl` 元素中渲染内容。

```javascript
import { MDExRenderer } from './common/MDExRenderer.js';

// ... 在你的组件或store中 ...

async function updatePreview() {
    const previewEl = document.getElementById('preview');
    const state = this.store.getState();
    
    const editorContent = state.editorContent;
    const clozeOptions = {
        fileId: state.currentSessionId,
        states: state.clozeStates
    };

    try {
        // 调用渲染器并等待其完成
        await MDExRenderer.render(previewEl, editorContent, { cloze: clozeOptions });
        console.log("所有内容，包括图表和公式，都已渲染完毕！");
        // 可以在这里执行依赖于渲染完成的DOM操作
    } catch (error) {
        console.error("渲染过程中发生错误:", error);
        previewEl.innerHTML = "<p>内容渲染失败。</p>";
    }
}
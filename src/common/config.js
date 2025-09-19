// src/common/config.js

// [修正] 数据库名称，与 db.js 保持一致
export const DB_NAME = 'MdAnkiDatabase';

export const DB_VERSION = 2; // Start with version 2 as per the previous schema design

// [新增] SRS (Spaced Repetition System) aettings
export const SRS_MASTERY_INTERVAL_DAYS = 21; // 间隔超过21天视为已掌握

export const INITIAL_ANKI_CONTENT = '# 新文件\n\n开始编写您的内容...\n\n::> 这是一个可折叠的标题  \n    这里是折叠的内容。  \n    - 甚至可以包含列表  \n    - 和其他 Markdown 元素。  \n    ```javascript\n    // 也可以包含代码块\n    console.log(\'Hello, Toggle!\');\n    ```\n\n这一行不再缩进，所以它不属于上面的折叠块。\n\n::> [ ] 这是一个可折叠的并且可以记录完成情况的标题  \n- [ ] 完成情况  \n\n使用 --内容-- 创建Cloze记忆卡片,在preview状态下ctrl+双击迅速进入edit态, 选中后快捷键是Ctrl+i,  可以有声音: --你好--^^audio:hello^^ ';

// [重构] 使用新的、更明确的结构化字段语法
export const INITIAL_TASK_CONTENT = `在这里输入任务的详细描述和主要内容...
- 可以使用列表
- **也可以使用**各种 Markdown 语法。
::> 这是一个可折叠的标题  
    这里是折叠的内容。 

::> [ ] 这是一个可折叠的并且可以记录完成情况的标题  
- [ ] 完成情况  

使用 --内容-- 创建Cloze记忆卡片,在preview状态下ctrl+双击迅速进入edit态, 选中后快捷键是Ctrl+i,  可以有声音: --你好--^^audio:hello^^ 
---

::>[::status::] 状态: todo
::>[::priority::] 优先级: 2
::>[::dueDate::] 截止日期: ${new Date(Date.now() + 3 * 864e5).toISOString().split('T')[0]}

::>[::note::] 笔记
    这里是多行笔记内容。
    可以记录一些额外的信息。

::>[::reason::] 原因
    这里是关于任务原因的详细说明。
`;
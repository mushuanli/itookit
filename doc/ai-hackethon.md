# ConfigManager
---
使用JS构造一个 ConfigManager 库,提供如下功能：
1. 支持按照 module: /dir/file 方式管理文件的接口，不同module下的 [dir/file] 是互相隔离的, 提供的接口都会要求 module参数。
2. 支持 tag 的增删改查接口,tag是全局的
3. 支持通讯录管理接口，通讯录也是全局的
4. 支持 llm connection 接口
5. 支持llm agent管理接口
6. 支持事件订阅和通知机制

要求提供简单易用的接口 

# sidebar:
---
使用js构造一个sidebar库，要求提供如下功能：
1. 顶上是 search功能，支持按照 tag , 按照 dir或完整filename，或是文件内容 search
2. 下一层是新建文件,新建目录，import功能
3. 下面是dir/filename 列表，但是注意不显示 / 目录。
4. 最底下是 选择按钮, 选中后可以删除，或是tag。


---

# editor:
---
使用 js 创建一个 editor, 要求支持 markdown

# llm panel:
---
使用 js 创建一个 llm panel, 要求支持自定义指令


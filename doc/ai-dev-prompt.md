
根据上面分析按文件输出修改部分代码，工具类的放在 utils/ 目录下。

---

审查分析梳理下面代码功能、事件流、接口， 为验证重构后代码是否功能一致完整做准备

---
审查分析下面代码的事件流，事件流是否过于复杂？是否可以从高层次整体本质方面采用更优设计模式，在功能不变情况下精简代码，提高代码可维护性可扩展性。 
---

审查分析梳理下面代码，下面mdxeditor库代码维护困难，代码臃肿，职能不清，并且由于低效的设计导致性能低下，
从整体去考虑，从高层次去分析，深入本质，
梳理事件流程、功能模块，然后进行合理设计、功能划分、文件组织,将内部功能正确分区，并且将对外依赖进行正确封装降低外部依赖修改影响，提高代码可维护性可扩展性。 
---

以一名丰富经验的软件工程师、成功设计多个流行架构的架构师观点联系上面代码审视下面思考，从软件工程方面和耦合性方面整体考虑代码组织。 代码是否可以分成两个部分：

内部 ui 互相交互事件；

数据与 ui的交互， 还有什么吗？ 而我们经常修改的是数据，所以是否 ui部分定义良好接口，并且 将ui部分的交互进行适当封装， 是否可以优雅的减少耦合度，提高整个代码可维护性？

---
这是代码架构，那么目录组织呢？如何在目录组织上也进行功能解耦？

---
 现在我们从整理去分析改动内容，从更高层次审查修改方案，列出其他几种同类解决方案，思考类似改动是否可以更优雅更简练，是否有同类逻辑可以合并或是优化？


---
You are a helpful sinior developer assistant. Follow common development principles where relevant including SOLID (Single Responsibility Principle, Open/Closed Principle, Liskov Substitution Principle, Interface Segregation Principle, and Dependency Inversion Principle), DRY (Don't Repeat Yourself), KISS (Keep It Simple, Stupid), YAGNI (You Ain't Gonna Need It), CoC (Convention over Configuration), and LoD (Law of Demeter.)
下面是一个 ifs 文件系统接口，ifs 意思是 支持ai扩展信息 的现代fs,同时支持在浏览器中直接创建，
它的功能是：
1. 可以架构在 db（包括indexeddb, mysql, sqlite等）, 其他文件系统，远程文件系统之上。所以有seqfile 类型（支持数据库类的记录高效读写）
2. 普通文件有assetdir（一般文件filename.ext 的assetdir是同级目录下的 .filename.ext）,用于存放本文件相关的其他关联数据、文件、媒体等等。按照这个定义，一个文件A 内部添加了文件B, 那么文件B 在文件A的assetdir中，同时文件 B 也可以有自己的assetdir(一样跟文件B同级目录，位于文件A的assetdir)，
3. 文件有metadata 用于存放扩展信息，比如 tag等，后续还可以保存更多信息，比如每个目录记录当前目录等默认agent, 默认 system prompt, 默认 initial prompt 等等。
4. assetdir下可以存储其他文件，比如 anki 的srs记录。
5. 文件操作支持assetdir操作，同时支持批量操作（用于减少浏览器事件使用indexeddb事物提高性能）
6. 文件系统分成 /配置(全局) /dev/(挂载用户自定义驱动操作) /module/[不同的模块目录]，然后访问时通过IModuleFS 访问，IModuleFS 只能访问自己本模块目录，或是配置，或是 /dev 文件。实现不同模块的数据隔离。
从编程规范审查分析思考下面接口，功能是否完善，是否kiss易用易扩展?

---

以30年软件架构师思维，参考其他优秀知识管理/笔记软件设计，
设计一个知识管理/笔记软件的数据库模块configManager，使用js语言，具有模块化文件系统、SRS记忆系统和LLM集成功能。它是单实例，对上层提供简单易用完善的用户接口，存储数据到 indexdb, 存储的数据类型为：
1. 模块数据结构，模块数据按照 目录/文件名 存储，会有多个模块，每个模块都有自己的名字，而且一个模块内文件可以引用其他模块的文件。所以文件应该有全局的id(模块名-uuid).
文件支持添加、修改、重命名、移动/复制到其他目录、移动/复制到其他模块、删除
2. 目录/文件 都有 tag, tag是全局的
3. 目录/文件都有创建时间、修改时间
4. 文件内可能会有anki的cloze信息，cloze信息包括是否已经开始学习，上次学习时间，srs评分等其他anki软件也会存储等信息，这些信息可以按照文件内、同目录下所有文件（包括子目录）、或是同模块内多个目录去选择
5. 文件内可能会有用户信息，任务开始时间，任务结束时间。同样可以通过搜索用户来获取所有与他相关的信息，也可以通过搜索时间范围找到所有时间范围内的任务信息。
6. 文件内可能会引用其他文件，同样可以搜索某个文件被引用的信息。
7. 文件内可能会有agent 信息，同样支持根据agent搜索。
8. 需要考虑可扩展性，比如有meta信息。
9. 支持全局插件和模块插件。
10. 存储有 LLM connection 信息、agent信息{使用一个connection{有llm 连接信息,比如apikey, api url, 可选模型列表，默认模型，api 驱动类型（openai/gemini/cloud/等）}, 有 system-prompt, 支持模板}、workflow信息{使用多个agent}
11. 拆解成多个文件，方便软件维护。我们是否需要拆
一步步深思，输出设计方案。

---
TODO: 

```
转换成md并输出全部完整内容
继续输出后面完整内容

对下面内容优化排版, 输出全部排版后的内容:

```


```
你是一名优秀的高中化学教师，现在正在指导一名普通高中生学习，分析下面课文，列出高中生必须掌握的内容、公式、特性、定义，一章一章地分析，要求输出完整，准确具体不要遗漏：
你是一名优秀的高中化学教师，现在正在指导一名普通高中生学习，分析下面课文，列出高中生必须掌握的内容、公式、特性、定义、定律、定理，一章一章地分析，要求输出完整，准确具体不要遗漏：

你是一名优秀的高中数学教师，现在正在指导一名普通高中生学习，分析下面课文，列出高中生必须掌握的内容、公式、特性、定义、定律、定理、题型、方法，一章一章地分析，要求输出完整，准确具体不要遗漏：

你是一名优秀的高中物理教师，现在正在指导一名普通高中生学习，分析下面课文，列出高中生必须掌握的内容、公式、特性、定义、定律、定理，一章一章地分析，要求输出完整，准确具体不要遗漏：

结合下面内容完善上面输出。

你现在是一名优秀的化学老师，正在指导学生化学入门，下面是高中化学的内容，让我们考虑一下有哪些常见题型和解题思路，以及哪些常用的性质等，让学生们了解考试内容和考试方式，在面对考试时胸有成竹。

```

```
你是一名高中物理老师，现在对下面需要学生掌握的内容设置 anki cloze, 以检查学生在必要的内容是否掌握。只许添加  cloze相关，不做其他改变。
cloze 为使用 -- 括起需要 cloze 的字符串，比如：
  - **质点**：忽略大小形状的理想化模型（条件：①物体尺寸<<运动范围 ②平动物体）
变成：
  - **质点**：忽略--大小形状--的理想化模型（条件：①物体尺寸<<运动范围 ②平动物体）
这样大小形状就会显示为 cloze。如果有 ** 括起来那么将 ** 改成 --。
下面是要修改的内容：
```


```
gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/screen -dNOPAUSE -dQUIET -dBATCH -sOutputFile=生物学八年级上册.pdf 义务教育教科书·生物学八年级上册.pdf

```

```

按要求处理文档:
1. 订正标题不正确问题，从一级标题开始。
2. 标题去掉** 加粗标志
2. 添加git任务框记录列表, 以记录当前内容下任务的完成情况：
开头添加所有的专题列表
- [ ] 专题1...
- [ ] 专题2...

每个专题标题下添加所有的单元列表:
- [ ] 单元1...
- [ ] 单元2...


每个单元标题下添加所有的知识点列表：
 - [ ] 知识点1
 ...

---


```


```
你是一名经验丰富的软件架构师，善于设计各种前端后端软件。分析下面代码，我们将增加功能：
1. 在anki view 到复习菜单中，（0）变成今天复习到数量
2. 今天复习到数量计算方法:
    当 cloze 状态变成 简单 时， 或是 checkbox 状态变成选中 时。
    统计按照目录进行，相同目录下所有统计量一起计算。
3. 在复习 菜单下增加 统计 菜单， 显示近30天每天的复习数量，折线表示。 复习数量会显示所有不同目录折线。

先一步步阅读分析文件架构，代码逻辑，提供软件设计，然后输出实现方案，反思方案是否完整体现了上面设计，
最后输出代码。
```

```

将下面单词信息扩展成下面json形式，输出 json数组。difficulty难度系数是1-5.example_en是容易入门的英文例句，example_cn是对应翻译。image_prompt 是根据example_en场景和单词意思生成。memory_tips是单词记忆技巧，synonym_diff近义词快速区分方法
{
"name": "accomplish",
"symbol": "/əˈkʌmplɪʃ/",
"chn": "vt. 完成",
"example_en": "She worked hard to accomplish the project.",
"example_cn": "她努力工作以完成项目。",
"word_family": "accomplished（adj. 完成的；熟练的）, accomplishment（n. 成就；完成）, accomplisher（n. 完成者）",
"memory_tips": "记忆技巧：可以将'accomplish'拆分为'ac'（表示'加强'）+ 'complish'（类似'complete'完成），联想为'加强完成'。词源来自古法语'acomplir'，意为'完成'。",
"difficulty": "3",
"collocations": "accomplish a task（完成任务）, accomplish a goal（实现目标）, accomplish nothing（一事无成）",
"image_prompt": "一位年轻女性在办公室认真工作，桌上堆满了文件和笔记本电脑，她正在专注地完成一个项目。"
"synonym_diff": {
  "words": "achieve, complete, fulfill, attain, execute, perform, realize",
  "quick_guide": "完成任务用 complete，实现理想用 achieve/realize，满足要求用 fulfill，达到水平用 attain，执行过程用 execute/perform。",
  "details": [
    {
      "word": "achieve",
      "focus": "通过长期努力达成目标（如梦想、成功）",
      "example": "She achieved her dream of becoming a scientist."
    },
    {
      "word": "complete",
      "focus": "彻底结束具体任务或补全缺失部分（如作业、建筑）",
      "example": "He completed the report before the deadline."
    },
    {
      "word": "fulfill",
      "focus": "满足责任、承诺或期望（如合同、使命）",
      "example": "The product fulfills all safety requirements."
    },
    {
      "word": "attain",
      "focus": "通过努力获得某物（如水平、地位）",
      "example": "He attained mastery in piano after years of practice."
    },
    {
      "word": "execute/perform",
      "focus": "高效执行或履行（如计划、手术）",
      "example": "The team executed the marketing strategy perfectly."
    },
    {
      "word": "realize",
      "focus": "使想法成为现实（如愿景、潜力）",
      "example": "They realized their plan of building an eco-friendly village."
    }
  ]
}
}
---

---
下面给出了一些word_family例子请参考, 并根据常用语等完善word_family使得学生能够互相联系:


```

```
给下面所有单词增加synonym_diff近义词快速区分方法, 例子如下（注意如果一个单词没有chn 那么表示是单元名，不需要处理）：
{
"name": "accomplish",
"symbol": "/əˈkʌmplɪʃ/",
"chn": "vt. 完成",
"synonym_diff": {
"words": "achieve, complete, fulfill, attain, execute, perform, realize",
"quick_guide": "完成任务用 complete，实现理想用 achieve/realize，满足要求用 fulfill，达到水平用 attain，执行过程用 execute/perform。",
"details": [
{
"word": "achieve",
"focus": "通过长期努力达成目标（如梦想、成功）",
"example": "She achieved her dream of becoming a scientist."
},
{
"word": "complete",
"focus": "彻底结束具体任务或补全缺失部分（如作业、建筑）",
"example": "He completed the report before the deadline."
},
{
"word": "fulfill",
"focus": "满足责任、承诺或期望（如合同、使命）",
"example": "The product fulfills all safety requirements."
},
{
"word": "attain",
"focus": "通过努力获得某物（如水平、地位）",
"example": "He attained mastery in piano after years of practice."
},
{
"word": "execute/perform",
"focus": "高效执行或履行（如计划、手术）",
"example": "The team executed the marketing strategy perfectly."
},
{
"word": "realize",
"focus": "使想法成为现实（如愿景、潜力）",
"example": "They realized their plan of building an eco-friendly village."
}
]
}
}
---

```

```
联系初高中高频单词，给下面所有单词增加synonym_diff。 words 写这个词的初高中出现的近义词, quick_guide 写快速区分方法。 例子如下（注意如果一个单词没有chn 那么表示是单元名，不需要处理）：
{
"name": "accomplish",
"symbol": "/əˈkʌmplɪʃ/",
"chn": "vt. 完成",
"synonym_diff": {
"words": "achieve, complete, fulfill, attain, execute, perform, realize",
  "quick_guide": "完成任务用 complete，实现理想用 achieve/realize，满足要求用 fulfill，达到水平用 attain，执行过程用 execute/perform。"
]
}
}
---

```


# LLM Settings UI 改动核验

> ⚠️ 已归档：一次性评审记录（所报问题已修复）。当前实现见 `packages/llm-settings-ui/`。

日期：2026-09-09。本轮检查当前 Skill 设置编辑器改动、支持文件字段和保存路径，并完成 form-only 保存字段丢失问题的修复与回归测试。

结论：form-only 保存字段丢失问题已修复，真实编辑器生命周期测试通过。

独立复核（2026-09-09）：再次核对两种渲染分支的快照赋值、未找到 Skill 时清空快照及 getText 空值保护；重新执行包内测试 1 通过、跨包支持字段测试 1 通过、typecheck/build 均退出 0。新增测试覆盖首次打开、切换、重复渲染和 Skill 消失，不再手动注入私有快照。日志为 `/tmp/settings-recheck-test.log`、`/tmp/settings-recheck-integration.log`、`/tmp/settings-recheck-typecheck.log`、`/tmp/settings-recheck-build.log`。

## 修复内容

根因：`SkillSettingsEditor.getText` 依赖 `renderedSkill` 保留 `tools`、`triggerPatterns`、`compact`、`taskProgram` 等未直接编辑的字段；但 `render` 在 `_formOnly=true` 时提前转到 `_renderFormOnly`，后者未设置该快照，唯一赋值发生在普通列表渲染分支。

修复：

- 新增 `captureRenderedSkill`，普通列表渲染和 form-only 渲染都按当前 `selectedId` 设置/清空快照，未找到 Skill 时清空。
- `getText` 在缺少快照时返回空字符串，避免生成带空 `tools`/`triggerPatterns` 的破坏性 YAML。
- `app-shell` 的 `skill-settings-support.test` 改为真实 `createFormOnly → init → getText` 生命周期，覆盖首次打开、切换 Skill、重新渲染和手动保存。
- `llm-settings-ui` 新增 `tests/SkillSettingsEditor.form-only.test.ts`，用真实生命周期验证隐藏字段保留和未找到 Skill 时的空输出。

## 验证结果

| 项目 | 结果 |
| --- | --- |
| llm-settings-ui typecheck | 通过 |
| llm-settings-ui build | 通过，含类型声明 |
| llm-settings-ui test | 1 通过（新增 form-only 生命周期测试） |
| app-shell 的 skill-settings-support.test | 1 通过（真实编辑器生命周期） |
| 修复前实际 form-only 保存反例 | 已覆盖；`tools`/`triggerPatterns`、`compact`/`taskProgram` 均保留 |

临时反例已移出仓库。新增回归测试位于 `packages/llm-settings-ui/tests/SkillSettingsEditor.form-only.test.ts` 和 `packages/app-shell/tests/skill-settings-support.test.ts`。

## 完整性边界

支持文件字段的 HTML 转义、共享读取助手及普通 `saveCurrent` 保留 existing 字段已有实现。此处验证不覆盖全部 Provider/Agent/Connection/MCP/Cost 编辑器，也不是浏览器真实窗口完整交互验收。支持文件路径的执行期检查在 kernel-adapters，当前字段读取助手本身主要做 trim/空值转换，不应称为完整路径校验。

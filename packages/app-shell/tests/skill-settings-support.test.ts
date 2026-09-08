// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Toast } from '@itookit/ui-common';
import { SkillSettingsEditor } from '../../llm-settings-ui/src/editors/SkillSettingsEditor';
import { renderDetail } from '../../llm-settings-ui/src/editors/skill/SkillRenderer';
import { saveCurrent } from '../../llm-settings-ui/src/editors/skill/SkillOperations';
import type { LLMSkill } from '@itookit/common';

// Use the editor's YAML dependency; this integration harness lives with app-shell's DOM tests.
const yaml = createRequire(resolve(process.cwd(), '../llm-settings-ui/package.json'))('js-yaml');

it('round trips supporting files and disabled corrections through manual and YAML saves', async () => {
    const skill: LLMSkill = { id: 'review', name: 'Review', description: '', type: 'prompt', enabled: true,
        instructions: 'Review', tools: [{ toolId: 'inspect', executionType: 'builtin', definition: { name: 'inspect' } }],
        triggerPatterns: ['review'], autoLoad: false, priority: 50, fsRoot: '/workspace/skills/review',
        referencePaths: ['ref.md', 'quote"<file>.md'], templatePath: 'template.md',
        correctionLog: { root: '/workspace', path: 'docs/corrections.md', enabled: false },
        compact: { marker: 'Compact Instructions', rawContent: 'Preserve checks', redLines: [] }, taskProgram: { kind: 'review', version: '1' } };
    const container = document.createElement('div');
    container.innerHTML = renderDetail(skill, [], () => '<input name="header-name" value="Review">');
    const val = (name: string) => container.querySelector<HTMLInputElement>(`[name="${name}"]`)?.value ?? '';
    const chk = (name: string) => container.querySelector<HTMLInputElement>(`[name="${name}"]`)?.checked ?? false;
    expect(val('correctionLog')).toBe('docs/corrections.md');
    expect(chk('correctionEnabled')).toBe(false);
    expect(val('referencePaths').split('\n')).toEqual(skill.referencePaths);
    container.querySelector<HTMLInputElement>('[name="fsRoot"]')!.value = '/workspace/shared';
    container.querySelector<HTMLInputElement>('[name="referencePaths"]')!.value = ' one.md\n\n two.md ';
    container.querySelector<HTMLInputElement>('[name="templatePath"]')!.value = ' new-template.md ';
    const dumped = SkillSettingsEditor.prototype.getText.call({ _formOnly: true, selectedId: skill.id, renderedSkill: skill, val, chk } as never);
    const parsed = yaml.load(dumped) as LLMSkill;
    const preserved = { fsRoot: '/workspace/shared', referencePaths: ['one.md', 'two.md'], templatePath: 'new-template.md',
        correctionLog: skill.correctionLog, tools: skill.tools, triggerPatterns: skill.triggerPatterns, compact: skill.compact, taskProgram: skill.taskProgram };
    expect(parsed).toMatchObject(preserved);
    const saveSkill = vi.fn(async () => {}), toast = vi.spyOn(Toast, 'success').mockImplementation(() => {});
    try {
        await saveCurrent({ selectedId: skill.id, service: { getSkills: async () => [skill], saveSkill },
            val, chk, render: async () => {} } as never);
        expect(saveSkill).toHaveBeenCalledWith(expect.objectContaining(preserved));
    } finally { toast.mockRestore(); }
    container.querySelector<HTMLInputElement>('[name="correctionLog"]')!.value = '';
    const cleared = yaml.load(SkillSettingsEditor.prototype.getText.call({ _formOnly: true, selectedId: skill.id, renderedSkill: skill, val, chk } as never)) as LLMSkill;
    expect(cleared.correctionLog).toBeUndefined();
});

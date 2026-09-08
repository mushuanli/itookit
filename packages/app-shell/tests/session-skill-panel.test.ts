// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { SkillPanel } from '../../llm-ui/src/components/input/SkillPanel';

it.each([true, false])('unloads from the panel and preserves selection on failure (success: %s)', async success => {
    const root = document.createElement('div');
    root.innerHTML = '<section class="llm-input__skill-section"><div class="llm-input__skills-list"></div></section>';
    const skill = { id: 'review"[]', name: 'Review', description: '', loaded: true, enabled: true, toolCount: 0 };
    let loaded = true;
    const unload = vi.fn(async () => { if (!success) throw new Error('storage unavailable'); loaded = false; });
    const panel = new SkillPanel(root, { onRequestSkills: async () => loaded ? [skill] : [], onUnloadSkill: unload });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
        await panel.reload();
        const checkbox = root.querySelector<HTMLInputElement>('input')!;
        checkbox.checked = false; checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        await vi.waitFor(() => {
            expect(unload).toHaveBeenCalledWith(skill.id);
            if (success) expect(root.querySelector('input')).toBeNull();
            else {
                expect(checkbox.checked).toBe(true);
                expect(root.querySelector('[role="alert"]')?.textContent).toBe('storage unavailable');
            }
        });
    } finally { log.mockRestore(); }
});

it.each([true, false])('loads a Skill and restores its checkbox on failure (success: %s)', async success => {
    const root = document.createElement('div');
    root.innerHTML = '<section class="llm-input__skill-section"><div class="llm-input__skills-list"></div></section>';
    const skill = { id: 'review', name: 'Review', description: '', loaded: false, enabled: true, toolCount: 0 };
    const load = vi.fn(async () => { if (!success) throw new Error('save failed'); skill.loaded = true; });
    const panel = new SkillPanel(root, { onRequestSkills: async () => [{ ...skill }], onLoadSkill: load });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
        await panel.reload();
        const checkbox = root.querySelector<HTMLInputElement>('input')!;
        checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        await vi.waitFor(() => {
            expect(load).toHaveBeenCalledWith('review');
            expect(root.querySelector<HTMLInputElement>('input')?.checked).toBe(success);
            if (!success) expect(root.querySelector('[role="alert"]')?.textContent).toBe('save failed');
        });
    } finally { log.mockRestore(); }
});

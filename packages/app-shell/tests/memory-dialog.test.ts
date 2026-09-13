// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { t } from '@itookit/common';
import type { SessionMemoryControls } from '@itookit/llm-session';
import { showMemoryDialog } from '../src/files/memory-dialog';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

it('edits with the selected hash, preserves conflicting input, and creates with an absence condition', async () => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: () => {} });
    const entry = { scope: 'project', entryId: 'note', content: 'original', contentHash: 'a'.repeat(64) };
    const memory = { list: vi.fn().mockResolvedValue([entry]), upsert: vi.fn().mockRejectedValueOnce(new Error('conflict')).mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) };
    const closed = showMemoryDialog(memory as unknown as SessionMemoryControls, [{ id: 'agent', name: 'Agent' }]);
    const button = (text: string) => [...document.querySelectorAll('button')].find(item => item.textContent === text)!;
    const idle = () => vi.waitFor(() => expect(button(t('memory.manage.save')).disabled).toBe(false));
    await idle(); button('project / note').click();
    const content = document.querySelector('textarea')!; content.value = 'edited';
    button(t('memory.manage.save')).click(); await idle();
    expect(memory.upsert).toHaveBeenLastCalledWith('agent', { scope: 'project', entryId: 'note', content: 'edited' }, { expectedContentHash: entry.contentHash });
    expect(content.value).toBe('edited'); expect(document.querySelector('[role=status]')?.textContent).toBe('conflict');
    button(t('memory.manage.delete')).click(); await idle();
    expect(memory.remove).toHaveBeenCalledWith('agent', 'project', 'note', { expectedContentHash: entry.contentHash });
    button(t('memory.manage.new')).click();
    const inputs = document.querySelectorAll('input'); inputs[0].value = 'project'; inputs[1].value = 'new'; content.value = '<script>plain text</script>';
    button(t('memory.manage.save')).click(); await idle();
    expect(memory.upsert).toHaveBeenLastCalledWith('agent', { scope: 'project', entryId: 'new', content: '<script>plain text</script>' }, { expectedContentHash: null });
    expect(document.querySelector('script')).toBeNull();
    button(t('memory.manage.close')).click(); await closed; expect(document.querySelector('dialog')).toBeNull();
});

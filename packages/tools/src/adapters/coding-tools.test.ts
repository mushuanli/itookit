import { expect, it, vi } from 'vitest';
import { BUILTIN_TOOLS } from '../index';
import { ToolDeviceDriver } from './tool-device-driver';

function files(initial = 'before target after') {
  let content = initial;
  const writeFile = vi.fn(async (_path: string, value: string) => { content = value; });
  const readFile = vi.fn(async () => content);
  const driver = new ToolDeviceDriver([...BUILTIN_TOOLS]);
  driver.setFileContext({ readFile, writeFile, listFiles: async () => ['/code.ts'] }, '/');
  const edit = (old_string: string, new_string: string, replace_all = false) => driver.invoke({
    toolId: 'Edit', args: { file_path: '/code.ts', old_string, new_string, replace_all },
  });
  return { driver, readFile, writeFile, edit, content: () => content };
}

it.each([false, true])('writes replacement metacharacters literally (replace_all=%s)', async replaceAll => {
  const fixture = files(replaceAll ? 'target target' : 'target');
  const replacement = '$& $$ $` $\'';
  const result = await fixture.edit('target', replacement, replaceAll);
  expect(result).toMatchObject({ success: true, data: { replacements: replaceAll ? 2 : 1, oldString: 'target', newString: replacement } });
  expect(fixture.content()).toBe(replaceAll ? `${replacement} ${replacement}` : replacement);
});

it.each([
  ['', 'new', 'INVALID_ARGUMENTS'], ['target', 'target', 'INVALID_ARGUMENTS'],
  ['missing', 'new', 'EDIT_NOT_FOUND'],
])('returns a corrective error without writing (%j)', async (old, next, code) => {
  const fixture = files();
  expect(await fixture.edit(old, next)).toMatchObject({ success: false, recoverable: true, errorCode: code });
  expect(fixture.writeFile).not.toHaveBeenCalled();
});

it('rejects ambiguous edits and accepts a subsequent precise correction', async () => {
  const fixture = files('first target; second target');
  expect(await fixture.edit('target', 'new')).toMatchObject({ errorCode: 'EDIT_AMBIGUOUS', recoverable: true });
  expect(fixture.writeFile).not.toHaveBeenCalled();
  expect((await fixture.edit('first target', 'first new')).success).toBe(true);
  expect(fixture.content()).toBe('first new; second target');
});

it.each([{ offset: 0 }, { offset: 1.5 }, { limit: -1 }, { limit: 2001 }])('validates Read ranges (%j)', async range => {
  const fixture = files();
  expect(await fixture.driver.invoke({ toolId: 'Read', args: { file_path: '/code.ts', ...range } })).toMatchObject({ errorCode: 'INVALID_ARGUMENTS' });
  expect(fixture.readFile).not.toHaveBeenCalled();
});

it('does not treat a storage read failure as permission to create a file', async () => {
  const fixture = files();
  fixture.readFile.mockRejectedValue(new Error('backend offline'));
  const result = await fixture.driver.invoke({ toolId: 'Write', args: { file_path: '/code.ts', content: 'new' } });
  expect(result.success).toBe(false);
  expect(result.recoverable).not.toBe(true);
  expect(fixture.writeFile).not.toHaveBeenCalled();
});

it('allows creation only after an explicit missing-file result', async () => {
  const fixture = files();
  fixture.readFile.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
  expect(await fixture.driver.invoke({ toolId: 'Read', args: { file_path: '/code.ts' } })).toMatchObject({ errorCode: 'ENOENT', recoverable: true });
  expect(await fixture.driver.invoke({ toolId: 'Write', args: { file_path: '/code.ts', content: 'new' } }))
    .toMatchObject({ success: true, data: { fileType: 'create' } });
  expect(fixture.content()).toBe('new');
});

it('does not write when cancellation arrives during an Edit read', async () => {
  const fixture = files();
  let finish!: (value: string) => void;
  fixture.readFile.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const pending = fixture.driver.invoke({ toolId: 'Edit', signal: controller.signal,
    args: { file_path: '/code.ts', old_string: 'target', new_string: 'new' } });
  await vi.waitFor(() => expect(fixture.readFile).toHaveBeenCalledOnce());
  controller.abort();
  finish('target');
  expect(await pending).toMatchObject({ success: false, errorCode: 'CANCELLED', recoverable: false });
  expect(fixture.writeFile).not.toHaveBeenCalled();
});

it('runs Bash validation before starting a process and retains its exit code', async () => {
  const fixture = files();
  const exec = vi.fn(async () => ({ stdout: 'failed test', stderr: '', code: 1 }));
  fixture.driver.setNativeShell({ capabilities: { fd: false, ripgrep: false }, exec });
  expect(await fixture.driver.invoke({ toolId: 'Bash', args: { command: 'rm -rf /' } })).toMatchObject({ errorCode: 'INVALID_ARGUMENTS' });
  expect(exec).not.toHaveBeenCalled();
  expect(await fixture.driver.invoke({ toolId: 'Bash', args: { command: 'pnpm test', timeout_ms: 5000 }, timeoutMs: 1000 }))
    .toMatchObject({ success: true, data: { exitCode: 1 } });
  expect(exec).toHaveBeenCalledWith('sh', ['-c', 'pnpm test'], expect.objectContaining({ timeoutMs: 1000 }));
});

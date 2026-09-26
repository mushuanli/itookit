import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dependencyError, sourceErrors } from '../check-boundaries.mjs';

const pkg = (name, host = false) => ({ name: '@itookit/' + name, dir: '/repo/' + (host ? 'apps/' : 'packages/') + name, host, exports: { '.': './src/index.ts', './style.css': './src/style.css' } });
const core = pkg('app-core'), shell = pkg('app-shell'), vfs = pkg('vfs-ui'), host = pkg('web', true);
const packages = [core, shell, vfs, host, pkg('vfs-core')];
const inspect = (source, text, file = source.dir + '/src/index.ts') => sourceErrors(source, file, text, packages);

test('dependency direction keeps domain capabilities independent of applications', () => {
    assert.equal(dependencyError(shell.name, core.name), undefined);
    assert.equal(dependencyError(core.name, '@itookit/llm-session'), undefined);
    assert.match(dependencyError(vfs.name, shell.name), /must not depend/);
    assert.match(dependencyError(core.name, vfs.name), /platform-neutral/);
});

test('checks static, dynamic, type-only, re-export and CommonJS dependencies', () => {
    for (const expression of ["import type { X } from '@itookit/app-shell'", "export { X } from '@itookit/app-shell'",
        "import('@itookit/app-shell')", "type X = import('@itookit/app-shell').X", "require('@itookit/app-shell')",
        "import X = require('@itookit/app-shell')"]) assert.equal(inspect(vfs, expression).length, 1, expression);
});

test('allows public CSS exports but rejects private paths and relative package access', () => {
    assert.equal(inspect(shell, "import '@itookit/vfs-ui/style.css'").length, 0);
    assert.match(inspect(shell, "import '@itookit/vfs-ui/src/Store'")[0], /declared package export/);
    assert.match(inspect(shell, "import '../../vfs-ui/src/Store'")[0], /cross-package relative/);
    assert.match(inspect(shell, "import '@itookit/web'")[0], /app hosts/);
    assert.equal(inspect(host, "import '@itookit/app-shell'").length, 0);
});

test('keeps native and browser capabilities outside app-core while allowing portable primitives', () => {
    for (const expression of ["import 'node:fs'", "import 'fs'", "import 'react'", "import '@tauri-apps/api/core'", 'window.location', 'globalThis.document',
        'localStorage.getItem("key")', 'let element: HTMLElement']) assert.equal(inspect(core, expression).length, 1, expression);
    assert.equal(inspect(core, 'new AbortController(); new URL("https://example.com"); const value = "window"; // document\n').length, 0);
});

test('public core exports are explicit and comments do not create false dependencies', () => {
    assert.match(inspect(core, "export * from './private'")[0], /must be explicit/);
    assert.equal(inspect(core, "export { Service } from './service'; // import '@itookit/app-shell'\n").length, 0);
    assert.equal(inspect(core, 'const description = "document and HTMLElement";').length, 0);
});

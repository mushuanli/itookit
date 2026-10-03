import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dependencyError, manifestDependencyError, sourceErrors } from '../check-boundaries.mjs';

const pkg = (name, host = false) => ({ name: '@itookit/' + name, dir: '/repo/' + (host ? 'apps/' : 'packages/') + name, host, exports: { '.': './src/index.ts', './style.css': './src/style.css' } });
const core = pkg('app-core'), shell = pkg('app-shell'), vfs = pkg('vfs-ui'), host = pkg('web', true);
const packages = [core, shell, vfs, host, pkg('vfs-core')];
const inspect = (source, text, file = source.dir + '/src/index.ts') => sourceErrors(source, file, text, packages);

test('public execution and conversation capabilities cannot depend on legacy shared contracts', () => {
    for (const source of ['@itookit/tools', '@itookit/device-tty', '@itookit/llm-tasks', '@itookit/llm-flow', '@itookit/llm-session']) {
        for (const target of ['@itookit/common', '@itookit/llm-common'])
            assert.match(dependencyError(source, target), /owned contracts/);
    }
    assert.equal(dependencyError('@itookit/tools', '@itookit/llm-context'), undefined);
    assert.equal(dependencyError('@itookit/device-tty', '@itookit/tools'), undefined);
});

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


test('standalone mdxeditor has no internal package dependencies', () => {
    for (const name of ['common', 'ui-common', 'vfs-core', 'mdx-adapter']) {
        assert.match(dependencyError('@itookit/mdxeditor', '@itookit/' + name), /public ports/);
    }
    assert.equal(dependencyError('@itookit/mdxeditor', 'codemirror'), undefined);
    assert.equal(dependencyError('@itookit/mdx-adapter', '@itookit/mdxeditor'), undefined);
});

test('standalone vfs-ui only depends on vfs-core internally', () => {
    for (const name of ['common', 'ui-common', 'llm-common', 'mdxeditor'])
        assert.match(dependencyError(vfs.name, '@itookit/' + name), /public ports/);
    assert.equal(dependencyError(vfs.name, '@itookit/vfs-core'), undefined);
    assert.match(dependencyError(vfs.name, 'immer'), /public ports/);
});

test('public LLM mechanisms reject host dependencies', () => {
    for (const name of ['common', 'ui-common', 'vfs-core', 'kernel-adapters/llm', 'llm-session'])
        assert.match(dependencyError('@itookit/driver-llm', '@itookit/' + name), /public ports/);
    assert.equal(dependencyError('@itookit/driver-llm', '@itookit/llm-context'), undefined);
    assert.match(dependencyError('@itookit/llm-context', '@itookit/driver-llm'), /public ports/);
    const driver = pkg('driver-llm'), context = pkg('llm-context');
    const inspectDriver = text => sourceErrors(driver, '/repo/packages/driver-llm/src/test.ts', text, [driver, context]);
    assert.equal(inspectDriver("import type { ChatMessage } from '@itookit/llm-context';").length, 0);
    assert.equal(inspectDriver("import { createContextService } from '@itookit/llm-context';").length, 1);
    assert.equal(inspectDriver("import { Client } from 'some-sdk';").length, 1);
});


test('common and shared UI cannot regain hidden LLM dependencies', () => {
    const common = pkg('common'), ui = pkg('ui-common'), session = pkg('llm-session');
    for (const source of [common, ui]) {
        assert.match(dependencyError(source.name, session.name), /capability packages|generic ports/);
        for (const expression of ["import type { ISession } from '@itookit/llm-session'",
            "export * from '@itookit/llm-session'", "type Submission = import('@itookit/llm-session').Signal"])
            assert.equal(sourceErrors(source, source.dir + '/src/index.ts', expression, [common, ui, session]).length, 1);
    }
    assert.equal(dependencyError(ui.name, common.name), undefined);
    assert.equal(dependencyError(ui.name, '@itookit/vfs-core'), undefined);
});

test('kernel adapters cannot depend on the task, flow or session implementations', () => {
    for (const name of ['llm-tasks', 'llm-flow', 'llm-session'])
        assert.match(dependencyError('@itookit/kernel-adapters', '@itookit/' + name), /execution or conversation layers/);
    assert.equal(dependencyError('@itookit/kernel-adapters', '@itookit/tools'), undefined);
});


test('published driver dependencies stay empty while development message types remain permitted', () => {
    assert.match(manifestDependencyError('@itookit/driver-llm', '@itookit/llm-context'), /no runtime dependencies/);
    assert.equal(dependencyError('@itookit/driver-llm', '@itookit/llm-context'), undefined);
});

test('optional settings may only load through the explicit settings or compatibility entry', () => {
    const ui = pkg('llm-ui');
    for (const statement of ["import '@itookit/llm-settings-ui'", "import('./settings')", "export * from './settings'"]) {
        assert.match(inspect(ui, statement, ui.dir + '/src/chat.ts')[0], /optional settings/);
        assert.equal(inspect(ui, statement, ui.dir + '/src/settings.ts').length, 0);
    }
});

test('chat uses session contracts and isolates singleton compatibility', () => {
    const ui = pkg('llm-ui');
    const session = { ...pkg('llm-session'), exports: { '.': './src/index.ts', './contracts': './src/contracts.ts' } };
    const check = (file, expression) => sourceErrors(ui, ui.dir + '/src/' + file, expression, [ui, session]);
    assert.match(check('chat.ts', "import { getSessionManager } from '@itookit/llm-session'")[0], /compatibility entry/);
    assert.equal(check('chat.ts', "import { SessionCommand } from '@itookit/llm-session/contracts'").length, 0);
    assert.equal(check('index.ts', "import { getSessionManager } from '@itookit/llm-session'").length, 0);
});


test('chat must receive business flow templates from the host', () => {
    const ui = pkg('llm-ui');
    assert.match(inspect(ui, "import template from './library/product.flow?raw'", ui.dir + '/src/chat.ts')[0], /template catalogs/);
});

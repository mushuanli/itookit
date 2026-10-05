import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseManifest, versions } from '../npm-libraries.mjs';
import { pinLibraries } from '../migrate-npm-libraries.mjs';
import { workspaceAliases } from '../workspace-sources.mjs';

test('release manifests expose built entries and pin library dependencies', () => {
    const manifest = {name:'example',version:'old',main:'./src/index.ts',dependencies:{'@itookit/vfs-core':'workspace:*'},publishConfig:{main:'./dist/index.cjs',exports:{'.':'./dist/index.js'}}};
    const result = releaseManifest(manifest, '1.0.0');
    assert.equal(result.main, './dist/index.cjs');
    assert.equal(result.dependencies['@itookit/vfs-core'],versions.get('@itookit/vfs-core'));
    assert.equal(result.publishConfig,undefined);
    assert.equal(manifest.main,'./src/index.ts');
    assert.throws(() => releaseManifest({dependencies:{other:'workspace:*'}},'1.0.0'),/Non-registry dependency/);
});
test('migration pins every dependency section without touching application workspace packages', () => {
    const result=pinLibraries({dependencies:{'@itookit/app-core':'workspace:*','@itookit/vfs-core':'workspace:*'},peerDependencies:{'@itookit/vfs-ui':'workspace:*'},devDependencies:{'@itookit/vfs-sync':'workspace:*'}});
    assert.equal(result.dependencies['@itookit/app-core'],'workspace:*');
    assert.equal(result.dependencies['@itookit/vfs-core'],versions.get('@itookit/vfs-core'));
    assert.equal(result.peerDependencies['@itookit/vfs-ui'],versions.get('@itookit/vfs-ui'));
    assert.equal(result.devDependencies['@itookit/vfs-sync'],versions.get('@itookit/vfs-sync'));
});
test('Vite source aliases do not bypass registry library exports', () => {
    for(const alias of workspaceAliases('/repo/apps/web-app')) {
        for(const name of versions.keys()) assert.equal(alias.find instanceof RegExp ? alias.find.test(name) : alias.find===name || alias.find===name+'/style.css',false);
    }
});

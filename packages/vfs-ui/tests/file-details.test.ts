// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { FILE_ICONS } from '@itookit/common';
import { mapFSNodeToUIItem } from '../src/services/NodeMapper';
import { FileTypeRegistry } from '../src/services/FileTypeRegistry';
import { fromVFS } from '../src/browser/from-vfs';
import { displayNode } from '../src/browser/SourceAdapter';
import { formatFileSize } from '../src/utils/file-size';
import { createFileItemHTML } from '../src/ui/components/NodeList/items/itemTemplates';
import { resolveRowPolicy } from '../src/utils/row-policy';

const file = { path: '/config.yaml', name: 'config.yaml', parentPath: '/', type: 'file' as const,
  size: 2048, createdAt: 0, modifiedAt: 0, version: 1, tags: [], metadata: { title: 'Old title', _fileDetails: true } };

it('preserves actual filenames and sizes in both adapters without extra reads', async () => {
  const mapped = mapFSNodeToUIItem(file);
  expect(mapped.metadata).toMatchObject({ title: 'config.yaml', size: 2048 });
  expect(mapped.presentation?.fileDetails).toBe(true);
  const getChildren = vi.fn(async () => [file]), getNode = vi.fn(), readContent = vi.fn();
  const fs = { viewId: 'files', capabilities: { readonly: false }, driver: { getChildren, getNode, readContent } };
  const nodes = await fromVFS(fs as any, { hideGitignored: false }).children(null);
  expect(displayNode(nodes[0]).metadata).toMatchObject({ title: 'config.yaml', size: 2048 });
  expect(getChildren).toHaveBeenCalledOnce(); expect(getNode).not.toHaveBeenCalled(); expect(readContent).not.toHaveBeenCalled();
});

it('keeps type icons alongside pin markers and displays known zero separately from unknown', () => {
  const registry = new FileTypeRegistry();
  expect(registry.getIcon('config.yaml')).toBe(FILE_ICONS.config);
  expect(registry.getIcon('unknown.xyz')).toBe(FILE_ICONS.file);
  expect(registry.getIcon('src', true)).toBe(FILE_ICONS.folder);
  expect(formatFileSize(0)).toBe('0 B'); expect(formatFileSize(undefined)).toBe('—');
  const mapped = mapFSNodeToUIItem(file); mapped.metadata.custom.isPinned = true;
  const html = createFileItemHTML(mapped, { isActive: false, isSelected: false, isOutlineExpanded: false,
    isSelectionMode: false, isConfirmingDelete: false, searchQueries: [],
    uiSettings: { sortBy: 'title', density: 'compact', showSummary: false, showTags: false, showBadges: false } },
    resolveRowPolicy(false, mapped));
  expect(html).toContain('2 KiB'); expect(html).toContain(FILE_ICONS.config); expect(html).toContain(FILE_ICONS.pin);
  expect(mapFSNodeToUIItem({ ...file, metadata: {} }).presentation?.fileDetails).toBe(false);
});

it('keeps synthetic resource titles and presentation when extensions are enabled by the host', () => {
  const session = mapFSNodeToUIItem({ ...file, metadata: { title: 'Conversation', _fileDetails: false } }, undefined, undefined, true);
  expect(session.metadata.title).toBe('Conversation');
  expect(session.presentation?.fileDetails).toBe(false);
});

it('classifies common filenames without file reads and preserves explicit icons', async () => {
  const { FILE_ICONS, fileTypeIcon } = await import('@itookit/common');
  const examples = { pdf: ['REPORT.PDF'], spreadsheet: ['budget.xlsx', 'data.csv'], slides: ['talk.pptx'],
    audio: ['voice.mp3'], media: ['clip.mp4'], config: ['.env.local', '.gitignore', 'tsconfig.app.json'],
    code: ['Dockerfile', 'main.rs', 'page.vue'], document: ['README', 'notes.docx'], archive: ['backup.tar.gz'] };
  for (const [kind, names] of Object.entries(examples)) for (const name of names)
    expect(fileTypeIcon(name)).toBe(FILE_ICONS[kind as keyof typeof FILE_ICONS]);
  expect(fileTypeIcon('go')).toBe(FILE_ICONS.file);
  expect(fileTypeIcon('assets.pdf', true)).toBe(FILE_ICONS.folder);
  expect(mapFSNodeToUIItem({ ...file, icon: 'custom' }).icon).toBe('custom');
});

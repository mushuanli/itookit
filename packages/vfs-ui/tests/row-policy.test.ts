// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { resolveColumnReadOnly, resolveRowPolicy, ROW_FLAGS } from '../src/utils/row-policy';
import { makeVFSNodeUI } from './helpers/fixtures';
import type { VFSNodeUI } from '../src';

const node = (type: 'file' | 'directory', custom: Record<string, unknown> = {}, quickDelete = false): VFSNodeUI => {
    const base = makeVFSNodeUI({ id: `/n/${type}`, type });
    return { ...base,
        presentation: quickDelete ? { quickDelete: true } : undefined,
        metadata: { ...base.metadata, custom: { ...base.metadata.custom, ...custom } } };
};

it('gives files an inline delete control and treats deletions as local', () => {
    expect(resolveRowPolicy(false, node('file'))).toEqual({ readOnly: false, fixed: false, inlineDelete: true, hostOwnedDelete: false });
});

it('lets a view-wide read-only column or a read-only node reject every mutation', () => {
    const readOnly = { readOnly: true, fixed: false, inlineDelete: false, hostOwnedDelete: false };
    expect(resolveRowPolicy(true, node('file'))).toEqual(readOnly);
    expect(resolveRowPolicy(false, node('file', { _readOnly: true }))).toEqual(readOnly);
    expect(resolveRowPolicy(true, node('directory', {}, true))).toEqual(readOnly);
});

it('hides the inline control for owner-managed entries, which deletion already skips', () => {
    expect(resolveRowPolicy(false, node('file', { _fixedEntry: true })).inlineDelete).toBe(false);
    expect(resolveRowPolicy(false, node('directory', { _fixedEntry: true }, true))).toEqual(
        { readOnly: false, fixed: true, inlineDelete: false, hostOwnedDelete: false });
});

it('hands opted-in virtual directories to the host and leaves plain directories alone', () => {
    expect(resolveRowPolicy(false, node('directory'))).toEqual({ readOnly: false, fixed: false, inlineDelete: false, hostOwnedDelete: false });
    expect(resolveRowPolicy(false, node('directory', {}, true))).toEqual({ readOnly: false, fixed: false, inlineDelete: true, hostOwnedDelete: true });
});

it('propagates a read-only column root to the whole column', () => {
    expect(resolveColumnReadOnly(false, undefined)).toBe(false);
    expect(resolveColumnReadOnly(false, node('directory'))).toBe(false);
    expect(resolveColumnReadOnly(false, node('file', { _readOnly: true }))).toBe(true);
    expect(resolveColumnReadOnly(true, undefined)).toBe(true);
});

it('publishes the data attributes consumed by drag and drop gating', () => {
    expect(ROW_FLAGS).toEqual({ readOnly: 'readOnly', fixed: 'fixedEntry' });
});

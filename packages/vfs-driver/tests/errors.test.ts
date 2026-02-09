// tests/errors.test.ts

import { describe, it, expect } from 'vitest';
import { FileSystemError } from '../src/core/errors.js';
import type { ErrorCode } from '../src/interface';

describe('FileSystemError', () => {
  it('should set code and path', () => {
    const err = new FileSystemError('ENOENT', '/test.txt');
    expect(err.code).toBe('ENOENT');
    expect(err.path).toBe('/test.txt');
    expect(err.name).toBe('FileSystemError');
  });

  it('should include code in message', () => {
    const err = new FileSystemError('ENOENT', '/test.txt');
    expect(err.message).toContain('ENOENT');
    expect(err.message).toContain('/test.txt');
  });

  it('should include detail when provided', () => {
    const err = new FileSystemError('EACCES', '/secret', 'Permission denied for user');
    expect(err.message).toContain('Permission denied for user');
    expect(err.message).toContain('EACCES');
    expect(err.message).toContain('/secret');
  });

  it('should be instanceof Error', () => {
    const err = new FileSystemError('EIO', '/');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(FileSystemError);
  });

  it('should have stack trace', () => {
    const err = new FileSystemError('EINVAL', '/bad');
    expect(err.stack).toBeDefined();
    expect(err.stack!.length).toBeGreaterThan(0);
  });

  it('should produce meaningful messages for all error codes', () => {
    const codes: ErrorCode[] = [
      'ENOENT', 'EEXIST', 'EISDIR', 'ENOTDIR', 'ENOTEMPTY',
      'EACCES', 'ENOSPC', 'ENOTTY', 'EINVAL', 'ELOOP', 'EIO', 'EPLUGIN',
    ];

    for (const code of codes) {
      const err = new FileSystemError(code, '/test');
      expect(err.code).toBe(code);
      expect(err.message.length).toBeGreaterThan(0);
      expect(err.message).toContain(code);
    }
  });

  it('should be catchable with try/catch', () => {
    try {
      throw new FileSystemError('ENOENT', '/missing');
    } catch (err) {
      expect(err).toBeInstanceOf(FileSystemError);
      expect((err as FileSystemError).code).toBe('ENOENT');
    }
  });
});

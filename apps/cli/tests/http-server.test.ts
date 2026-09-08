import { describe, expect, it } from 'vitest';
import { parseHttpAddress } from '../src/http-server';

describe('parseHttpAddress', () => {
    it('defaults to loopback and accepts explicit ip:port', () => {
        expect(parseHttpAddress('8080')).toEqual({ host: '127.0.0.1', port: 8080 });
        expect(parseHttpAddress('0.0.0.0:9000')).toEqual({ host: '0.0.0.0', port: 9000 });
        expect(parseHttpAddress('127.0.0.1:0')).toEqual({ host: '127.0.0.1', port: 0 });
    });

    it('rejects invalid ports', () => {
        expect(() => parseHttpAddress('70000')).toThrow('Invalid -d address');
        expect(() => parseHttpAddress('')).toThrow('-d requires');
    });
});

import { describe, expect, it } from 'vitest';
import { parseSessionRoute, sessionRoute } from '../src/session/session-route';

describe('Session branch route identity', () => {
    it('round trips branch names through the outer shell URI encoding', () => {
        const resource = sessionRoute('session-1', 'review/中文 + &?%');
        expect(parseSessionRoute(decodeURIComponent(encodeURIComponent(resource)))).toEqual({
            path: '/session-1', branch: 'review/中文 + &?%',
        });
    });
    it('does not interpret file query characters as a branch', () => {
        expect(parseSessionRoute('/s/files/workspace/a?branch=b')).toEqual({ path: '/s/files/workspace/a?branch=b' });
        expect(parseSessionRoute('s')).toEqual({ path: '/s' });
    });
    it.each(['s?branch=', 's?branch=a&branch=b', 's?x=a', 's?branch=%00'])('rejects malformed branch route %s', route => {
        expect(() => parseSessionRoute(route)).toThrow('branch route');
    });
});

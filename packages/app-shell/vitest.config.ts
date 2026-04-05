import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        // LLM network calls need longer timeout
        testTimeout: 60_000,
        hookTimeout: 15_000,
        include: ['tests/**/*.test.ts'],
    },
});

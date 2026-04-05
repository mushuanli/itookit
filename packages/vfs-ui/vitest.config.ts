import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        testTimeout: 10000,
        include: ['tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            include: ['src/services/**/*.ts', 'src/utils/**/*.ts'],
            exclude: ['tests/**'],
        },
    },
});

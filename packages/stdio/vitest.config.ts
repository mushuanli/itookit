import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        setupFiles: ['./tests/setup.ts'],
        testTimeout: 15000,
        include: ['tests/**/*.test.ts'],
        exclude: [
            '**/node_modules/**',
            '**/dist/**',
        ],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['tests/**'],
        },
    },
});

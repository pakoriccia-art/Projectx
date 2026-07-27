import { defineConfig } from 'vitest/config';

/**
 * Vitest config for the v2.4.25 test suite (tests/** directory).
 * Runs independently from the existing src/** tests (vite.config.ts test section).
 * Usage: vitest run --config vitest.config.ts
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: [
      'tests/unit/**/*.test.ts',
      'tests/service/**/*.test.ts',
      'tests/integration/**/*.test.ts',
    ],
    coverage: {
      include: [
        'engine/**/*.js',
        'src/engine/**/*.ts',
        'src/db/**/*.ts',
        'src/components/tools/FermentationPlannerView.tsx',
      ],
      reporter: ['text', 'html'],
      thresholds: { lines: 60, functions: 65, branches: 55 },
    },
  },
});

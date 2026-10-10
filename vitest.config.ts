/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

export default getViteConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/unit/**/*.test.ts'],
    exclude: ['**/*.int.test.ts', 'node_modules/**', 'dist/**'],
  },
});

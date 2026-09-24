import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Mismo alias @/* → src/* que tsconfig.json.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['src/**/*.test.ts'] },
});

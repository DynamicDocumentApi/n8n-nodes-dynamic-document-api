import { defineConfig } from 'vitest/config';

export default defineConfig({
	// n8n-workflow ships source maps without their sources; vite would warn about each file.
	logLevel: 'error',
	test: {
		include: ['test/**/*.test.ts'],
	},
});

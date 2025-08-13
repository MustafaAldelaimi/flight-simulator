import { defineConfig } from '@playwright/test'

export default defineConfig({
	testDir: './e2e',
	webServer: {
		command: 'npm run dev',
		port: 5173,
		reuseExistingServer: !process.env.CI
	},
    projects: [
        { name: 'chromium', use: { browserName: 'chromium' } },
        { name: 'firefox', use: { browserName: 'firefox' } },
        // Run WebKit headed to ensure WebGL works on Windows CI/local
        { name: 'webkit', use: { browserName: 'webkit', headless: false } }
    ],
	use: {
		baseURL: 'http://localhost:5173',
		headless: true
	}
})



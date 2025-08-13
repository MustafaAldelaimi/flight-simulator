import { test, expect } from '@playwright/test'

test('Altimeter HUD reflects FDM altitude', async ({ page }) => {
	await page.goto('/')
	// Wait for global FDM to be exposed
	await page.waitForFunction(() => (window as any).FDM?.state?.positionEnuMeters !== undefined)
	const altitudeFtFromFdm = await page.evaluate(() => {
		const fdm = (window as any).FDM
		return fdm.state.positionEnuMeters.z * 3.28084
	})
	const hudAltText = await page.locator('#alt').innerText()
	const hudAlt = Number(hudAltText)
	expect(Math.abs(hudAlt - Math.round(altitudeFtFromFdm))).toBeLessThanOrEqual(5)
})



import { test, expect } from '@playwright/test'
test.describe('Stall Test', () => {
    test('reducing speed leads to altitude loss', async ({ page }) => {
        await page.goto('/')
        await page.waitForFunction(() => (window as any).FDM?.state?.positionEnuMeters !== undefined, { timeout: 60000 })

        // Start at moderate speed and some altitude gain to avoid immediate ground contact
        await page.evaluate(() => {
            const controls = (window as any).CONTROLS
            controls.set({ throttle: 0.6, elevator: -0.2 })
            ;(window as any).FDM.setWindEnuMetersPerSec({ x: 0, y: 0, z: 0 })
        })

        await page.waitForTimeout(3000)

        // Cut throttle to induce stall
        await page.evaluate(() => {
            const controls = (window as any).CONTROLS
            controls.set({ throttle: 0.1, elevator: 0 })
        })

        const altBefore = await page.evaluate(() => (window as any).FDM.state.positionEnuMeters.z)

        await page.waitForTimeout(5000)

        const altAfter = await page.evaluate(() => (window as any).FDM.state.positionEnuMeters.z)
        expect(altAfter).toBeLessThan(altBefore - 5)
    })
})



import { test, expect } from '@playwright/test'
test.describe('Level Flight Turn', () => {
    test('heading changes while altitude roughly constant during bank', async ({ page }) => {
        await page.goto('/')
        await page.waitForFunction(() => (window as any).FDM?.state?.positionEnuMeters !== undefined, { timeout: 60000 })

        // Trim for level flight at moderate throttle
        await page.evaluate(() => {
            const controls = (window as any).CONTROLS
            controls.set({ throttle: 0.8, elevator: 0, ailerons: 0, rudder: 0 })
            ;(window as any).FDM.setWindEnuMetersPerSec({ x: 0, y: 0, z: 0 })
        })

        // Let it stabilize a bit
        await page.waitForTimeout(2000)

        const { alt0, hdg0 } = await page.evaluate(() => {
            const fdm = (window as any).FDM
            return { alt0: fdm.state.positionEnuMeters.z, hdg0: (fdm.state.yawRad * 180 / Math.PI + 360) % 360 }
        })

        // Apply right bank
        await page.evaluate(() => {
            const controls = (window as any).CONTROLS
            controls.set({ ailerons: 0.6, elevator: -0.1 }) // adjust trim per elevator convention
        })

        await page.waitForTimeout(6000)

        // Neutralize ailerons
        await page.evaluate(() => {
            const controls = (window as any).CONTROLS
            controls.set({ ailerons: 0.0 })
        })

        const { alt1, hdg1 } = await page.evaluate(() => {
            const fdm = (window as any).FDM
            return { alt1: fdm.state.positionEnuMeters.z, hdg1: (fdm.state.yawRad * 180 / Math.PI + 360) % 360 }
        })

        const headingChange = Math.abs(hdg1 - hdg0)
        expect(headingChange).toBeGreaterThan(1)

        const altitudeChange = Math.abs(alt1 - alt0)
        expect(altitudeChange).toBeLessThan(150)
    })
})



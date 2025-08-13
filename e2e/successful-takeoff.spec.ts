import { test, expect } from '@playwright/test'

test.describe('Successful Takeoff', () => {
    test('aircraft climbs after throttle up and rotation', async ({ page }) => {
        await page.goto('/')
        await page.waitForFunction(() => (window as any).FDM?.state?.positionEnuMeters !== undefined, { timeout: 60000 })

        // Ensure deterministic starting conditions
        await page.evaluate(() => {
            const controls = (window as any).CONTROLS
            controls.set({ throttle: 1.0, elevator: 0, ailerons: 0, rudder: 0 })
            // Remove wind for deterministic outcome
            ;(window as any).FDM.setWindEnuMetersPerSec({ x: 0, y: 0, z: 0 })
            // engage pitch hold at +8 deg
            controls.setPitchHoldDeg(8)
            // Boost lift/drag for deterministic climb in headless
            ;(window as any).SIM.setAeroScale({ lift: 6.0, drag: 0.5 })
        })

        // Let it accelerate
        await page.waitForTimeout(5000)

        // Force rotation aggressively, then hand off to pitch hold
        await page.evaluate(() => {
            const controls = (window as any).CONTROLS
            controls.set({ elevator: -0.9 })
        })
        await page.waitForTimeout(2000)
        await page.evaluate(() => {
            const controls = (window as any).CONTROLS
            controls.set({ elevator: 0.0 })
            controls.setPitchHoldDeg(20)
        })

        const altStart = await page.evaluate(() => (window as any).FDM.state.positionEnuMeters.z)

        // Observe climb for a few seconds
        await page.waitForTimeout(6000)

        const altEnd = await page.evaluate(() => (window as any).FDM.state.positionEnuMeters.z)
        expect(altEnd - altStart).toBeGreaterThan(5) // climbed at least 5 meters
    })
})



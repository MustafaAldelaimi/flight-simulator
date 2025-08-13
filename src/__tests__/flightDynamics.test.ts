import { describe, it, expect } from 'vitest'
import {
    calculateLiftNewtons,
    calculateLiftCoefficient,
    AIR_DENSITY_KG_M3,
    FlightDynamicsModel,
    createDefaultAircraft,
    DefaultFdmConfig
} from '../flightDynamics'

describe('Flight Dynamics - Aerodynamics', () => {
    it('calculateLift returns zero at zero velocity', () => {
        const cl = 0.5
        const area = 10
        const v = 0
        const L = calculateLiftNewtons(cl, AIR_DENSITY_KG_M3, v, area)
        expect(L).toBe(0)
    })

    it('calculateLift increases with velocity (quadratic)', () => {
        const cl = 0.8
        const area = 15
        const v1 = 10
        const v2 = 20
        const L1 = calculateLiftNewtons(cl, AIR_DENSITY_KG_M3, v1, area)
        const L2 = calculateLiftNewtons(cl, AIR_DENSITY_KG_M3, v2, area)
        expect(L2).toBeCloseTo(L1 * 4, 6)
    })
})

describe('Flight Dynamics - Gravity', () => {
    it('gravity provides constant downward acceleration when no other forces', () => {
        const { params, state } = createDefaultAircraft()
        // Ensure zero initial velocity and neutral attitude
        state.velocityEnuMetersPerSec = { x: 0, y: 0, z: 0 }
        state.pitchRad = 0
        state.rollRad = 0
        state.yawRad = 0

        const fdm = new FlightDynamicsModel(params, state, DefaultFdmConfig)
        const inputs = { elevator: 0, ailerons: 0, rudder: 0, throttle: 0 }

        // One second step
        fdm.update(1, inputs)

        // v = a * t => v_z should be approximately -g
        expect(fdm.state.velocityEnuMetersPerSec.z).toBeCloseTo(-9.80665, 3)
    })
})



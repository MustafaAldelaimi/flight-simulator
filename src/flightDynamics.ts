// Flight Dynamics Model (FDM)

export type Vector3 = {
	x: number
	y: number
	z: number
}

export type Quaternion = {
	x: number
	y: number
	z: number
	w: number
}

export interface AircraftParameters {
	massKg: number
	wingAreaM2: number
	wingSpanM: number
	maxThrustN: number
	parasiteDragCoefficient: number // Cd0
	clSlopePerRad: number // dCl/dAlpha in 1/rad
	oswaldEfficiency: number // e
}

export interface ControlInputs {
	elevator: number // [-1, 1]
	ailerons: number // [-1, 1]
	rudder: number // [-1, 1]
	throttle: number // [0, 1]
}

export interface AircraftState {
	positionEnuMeters: Vector3
	velocityEnuMetersPerSec: Vector3
	yawRad: number // heading (about Z+)
	pitchRad: number // nose up +
	rollRad: number // right wing down +
	orientation: Quaternion // body->ENU rotation
	angularRatesRadPerSec: { p: number; q: number; r: number } // body rates
}

export const GRAVITY_M_S2 = 9.80665
export const AIR_DENSITY_KG_M3 = 1.225 // ISA sea-level

export type FdmConfig = {
	maxRollRateRadPerSec: number
	maxPitchRateRadPerSec: number
	maxYawRateRadPerSec: number
	rollRateGain: number // how much aileron maps to rate (0..1)
	pitchRateGain: number
	yawRateGain: number
	stallAlphaRad: number
    coordinationGain: number // adds yaw from bank for coordinated turns
    lateralDragCoefficient: number // simple sideforce coefficient
}

export const DefaultFdmConfig: FdmConfig = {
	maxRollRateRadPerSec: Math.PI, // ~180 deg/s
	maxPitchRateRadPerSec: Math.PI / 2, // ~90 deg/s
	maxYawRateRadPerSec: Math.PI / 2,
	rollRateGain: 0.6,
	pitchRateGain: 0.5,
	yawRateGain: 0.4,
    stallAlphaRad: 15 * (Math.PI / 180),
    coordinationGain: 0.7,
    lateralDragCoefficient: 0.6
}

export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value))
}

export function add(a: Vector3, b: Vector3): Vector3 {
	return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

export function scale(v: Vector3, s: number): Vector3 {
	return { x: v.x * s, y: v.y * s, z: v.z * s }
}

export function dot(a: Vector3, b: Vector3): number {
	return a.x * b.x + a.y * b.y + a.z * b.z
}

export function magnitude(v: Vector3): number {
	return Math.hypot(v.x, v.y, v.z)
}

export function normalize(v: Vector3): Vector3 {
	const m = magnitude(v)
	return m > 1e-6 ? scale(v, 1 / m) : { x: 0, y: 0, z: 0 }
}

export function cross(a: Vector3, b: Vector3): Vector3 {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x
    }
}

// Rotation matrix from body to ENU given yaw (psi), pitch (theta), roll (phi)
// Body axes: X forward, Y right, Z up
export function bodyToEnuMatrix(yawRad: number, pitchRad: number, rollRad: number): number[] {
	const cpsi = Math.cos(yawRad), spsi = Math.sin(yawRad)
	const cth = Math.cos(pitchRad), sth = Math.sin(pitchRad)
	const cphi = Math.cos(rollRad), sphi = Math.sin(rollRad)
    // Proper aerospace ZYX convention: yaw (Z), pitch (Y), roll (X)
    // World = Rz(yaw) * Ry(pitch) * Rx(roll) * Body
    const r00 = cpsi * cth
    const r01 = cpsi * sth * sphi - spsi * cphi
    const r02 = cpsi * sth * cphi + spsi * sphi
    const r10 = spsi * cth
    const r11 = spsi * sth * sphi + cpsi * cphi
    const r12 = spsi * sth * cphi - cpsi * sphi
    const r20 = -sth
    const r21 = cth * sphi
    const r22 = cth * cphi
	return [r00, r01, r02, r10, r11, r12, r20, r21, r22]
}

export function multiplyMatrixVector3(r: number[], v: Vector3): Vector3 {
	return {
		x: r[0] * v.x + r[1] * v.y + r[2] * v.z,
		y: r[3] * v.x + r[4] * v.y + r[5] * v.z,
		z: r[6] * v.x + r[7] * v.y + r[8] * v.z
	}
}

export function transpose3(r: number[]): number[] {
	return [
		r[0], r[3], r[6],
		r[1], r[4], r[7],
		r[2], r[5], r[8]
	]
}

export function quaternionMultiply(a: Quaternion, b: Quaternion): Quaternion {
	return {
		x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
		y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
		z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
		w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
	}
}

export function quaternionNormalize(q: Quaternion): Quaternion {
	const m = Math.hypot(q.x, q.y, q.z, q.w)
	if (m === 0) return { x: 0, y: 0, z: 0, w: 1 }
	const s = 1 / m
	return { x: q.x * s, y: q.y * s, z: q.z * s, w: q.w * s }
}

export function integrateOrientation(q: Quaternion, p: number, qRate: number, r: number, dt: number): Quaternion {
	// dq = 0.5 * q ⊗ [0, p, q, r]
	const omega: Quaternion = { x: p, y: qRate, z: r, w: 0 }
	const dq = quaternionMultiply(q, omega)
	const qn = { x: q.x + 0.5 * dq.x * dt, y: q.y + 0.5 * dq.y * dt, z: q.z + 0.5 * dq.z * dt, w: q.w + 0.5 * dq.w * dt }
	return quaternionNormalize(qn)
}

export function matrixFromQuaternion(q: Quaternion): number[] {
	const x = q.x, y = q.y, z = q.z, w = q.w
	const xx = x * x, yy = y * y, zz = z * z
	const xy = x * y, xz = x * z, yz = y * z
	const wx = w * x, wy = w * y, wz = w * z
	const r00 = 1 - 2 * (yy + zz)
	const r01 = 2 * (xy - wz)
	const r02 = 2 * (xz + wy)
	const r10 = 2 * (xy + wz)
	const r11 = 1 - 2 * (xx + zz)
	const r12 = 2 * (yz - wx)
	const r20 = 2 * (xz - wy)
	const r21 = 2 * (yz + wx)
	const r22 = 1 - 2 * (xx + yy)
	return [r00, r01, r02, r10, r11, r12, r20, r21, r22]
}

export function quaternionFromYawPitchRoll(yaw: number, pitch: number, roll: number): Quaternion {
	// ZYX
	const cy = Math.cos(yaw * 0.5), sy = Math.sin(yaw * 0.5)
	const cp = Math.cos(pitch * 0.5), sp = Math.sin(pitch * 0.5)
	const cr = Math.cos(roll * 0.5), sr = Math.sin(roll * 0.5)
	return {
		w: cr * cp * cy + sr * sp * sy,
		x: sr * cp * cy - cr * sp * sy,
		y: cr * sp * cy + sr * cp * sy,
		z: cr * cp * sy - sr * sp * cy
	}
}

export function yawPitchRollFromQuaternion(q: Quaternion): { yaw: number; pitch: number; roll: number } {
	// ZYX
	const r = matrixFromQuaternion(q)
	// Use standard extraction formulas
	const r20 = r[6]
	const r21 = r[7]
	const r22 = r[8]
	const r10 = r[3]
	const r00 = r[0]
	let pitch = Math.asin(-r20)
	let roll = Math.atan2(r21, r22)
	let yawZ = Math.atan2(r10, r00)
	return { yaw: yawZ, pitch, roll }
}

export function calculateLiftCoefficient(alphaRad: number, clSlopePerRad: number, stallAlphaRad: number): number {
	const limitedAlpha = clamp(alphaRad, -stallAlphaRad, stallAlphaRad)
	return clSlopePerRad * limitedAlpha
}

export function calculateDragCoefficient(cd0: number, cl: number, aspectRatio: number, oswaldEfficiency: number): number {
	const k = 1 / (Math.PI * aspectRatio * oswaldEfficiency)
	return cd0 + k * cl * cl
}

export function calculateLiftNewtons(cl: number, airDensityKgM3: number, speedMS: number, wingAreaM2: number): number {
	return 0.5 * cl * airDensityKgM3 * speedMS * speedMS * wingAreaM2
}

export function calculateDragNewtons(cd: number, airDensityKgM3: number, speedMS: number, wingAreaM2: number): number {
	return 0.5 * cd * airDensityKgM3 * speedMS * speedMS * wingAreaM2
}

export function createDefaultAircraft(): { params: AircraftParameters; state: AircraftState } {
	const params: AircraftParameters = {
		// Cessna 172-like values
		massKg: 1110, // ~2450 lb MTOW
		wingAreaM2: 16.2, // 174 ft^2
		wingSpanM: 11.0, // 36 ft 1 in
		maxThrustN: 4500, // ~180 hp at ~30 m/s => P/V ≈ 4.5 kN
		parasiteDragCoefficient: 0.03,
		clSlopePerRad: 5.7, // ~2π corrected for finite wing
		oswaldEfficiency: 0.8
	}
	const state: AircraftState = {
		positionEnuMeters: { x: 0, y: 0, z: 0 },
		velocityEnuMetersPerSec: { x: 0, y: 0, z: 0 },
		yawRad: 0,
		pitchRad: 0,
		rollRad: 0,
		orientation: { x: 0, y: 0, z: 0, w: 1 },
		angularRatesRadPerSec: { p: 0, q: 0, r: 0 }
	}
	return { params, state }
}

export class FlightDynamicsModel {
	readonly params: AircraftParameters
	readonly config: FdmConfig
	state: AircraftState

	constructor(params: AircraftParameters, initialState: AircraftState, config: FdmConfig = DefaultFdmConfig) {
		this.params = params
		this.state = initialState
		this.config = config
		// Initialize quaternion from provided Euler if not identity
		this.state.orientation = quaternionFromYawPitchRoll(initialState.yawRad, initialState.pitchRad, initialState.rollRad)
	}

	update(dtSeconds: number, inputs: ControlInputs): void {
		const { params, state } = this
		if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return

		// Substep integration for stability on large dt spikes
		let remaining = Math.min(dtSeconds, 0.25) // cap huge spikes
		const maxStep = 0.02
		while (remaining > 1e-6) {
			const dt = Math.min(maxStep, remaining)


			// Angular kinematics in body frame with quaternion integration (avoids gimbal issues)
			const airspeedMS = magnitude(state.velocityEnuMetersPerSec)
			const speedFactor = clamp(airspeedMS / 50, 0, 1)
			const pCmd = inputs.ailerons * this.config.maxRollRateRadPerSec * this.config.rollRateGain * speedFactor
			const qCmd = inputs.elevator * this.config.maxPitchRateRadPerSec * this.config.pitchRateGain * speedFactor
			let rCmd = inputs.rudder * this.config.maxYawRateRadPerSec * this.config.yawRateGain * speedFactor
			// Coordinated yaw: sign chosen so right bank (positive roll) yields yaw right
			rCmd += -Math.sin(state.rollRad) * this.config.maxYawRateRadPerSec * this.config.coordinationGain * speedFactor * 0.2
			state.angularRatesRadPerSec = { p: pCmd, q: qCmd, r: rCmd }
			state.orientation = integrateOrientation(state.orientation, pCmd, qCmd, rCmd, dt)

			// Derive Euler angles for UI/debug from quaternion
			const eul = yawPitchRollFromQuaternion(state.orientation)
			state.yawRad = eul.yaw
			state.pitchRad = clamp(eul.pitch, -Math.PI / 2 + 0.001, Math.PI / 2 - 0.001)
			state.rollRad = eul.roll

			// Build rotation matrices from quaternion
			const rBodyToEnu = matrixFromQuaternion(state.orientation)
			const rEnuToBody = transpose3(rBodyToEnu)

            // Velocity in body frame
            const vBody = multiplyMatrixVector3(rEnuToBody, state.velocityEnuMetersPerSec)
            const u = vBody.x
            const vSide = vBody.y
            const w = vBody.z
            // For aerodynamics, treat negative forward speed as zero to avoid "flying backwards" artifacts
            const vAeroBody = { x: Math.max(0, u), y: vSide, z: w }
            const speedAero = magnitude(vAeroBody)

			// Aerodynamics
            const effectiveU = Math.max(1e-3, vAeroBody.x)
            const alpha = speedAero < 0.1 ? 0 : Math.atan2(vAeroBody.z, effectiveU)
            const beta = speedAero < 0.1 ? 0 : Math.atan2(vAeroBody.y, Math.hypot(Math.max(1e-6, vAeroBody.x), vAeroBody.z))
			const aspectRatio = (params.wingSpanM * params.wingSpanM) / params.wingAreaM2
			const cl = calculateLiftCoefficient(alpha, params.clSlopePerRad, this.config.stallAlphaRad)
			const cd = calculateDragCoefficient(params.parasiteDragCoefficient, cl, aspectRatio, params.oswaldEfficiency)
            const liftN = calculateLiftNewtons(cl, AIR_DENSITY_KG_M3, speedAero, params.wingAreaM2)
            const dragN = calculateDragNewtons(cd, AIR_DENSITY_KG_M3, speedAero, params.wingAreaM2)

			// Forces in body frame
			const thrustN = params.maxThrustN * clamp(inputs.throttle, 0, 1)
			const forwardDirBody: Vector3 = { x: 1, y: 0, z: 0 }
            // Lift direction perpendicular to relative wind and span axis.
            const vHatBody = speedAero < 1e-3 ? { x: 1, y: 0, z: 0 } : normalize(vAeroBody)
            const spanHatBody: Vector3 = { x: 0, y: 1, z: 0 }
            let liftDirBody = cross(vHatBody, spanHatBody) // for v along +X, yields +Z
            liftDirBody = normalize(liftDirBody)
            // Drag always opposes actual motion
            const dragDirBody = magnitude(vBody) < 1e-3 ? { x: -1, y: 0, z: 0 } : normalize({ x: -u, y: -vSide, z: -w })
            // Sideforce opposes sideslip (rudder/fin effect)
            const qDyn = 0.5 * AIR_DENSITY_KG_M3 * speedAero * speedAero
            const cyBeta = -0.98 // per rad, crude
            const sideForceN = qDyn * params.wingAreaM2 * cyBeta * beta

            const forceBody = add(
                add(add(scale(forwardDirBody, thrustN), scale(liftDirBody, liftN)), scale(dragDirBody, dragN)),
                { x: 0, y: sideForceN, z: 0 }
            )

			// Transform to ENU
			const aerodynamicForceEnu = multiplyMatrixVector3(rBodyToEnu, forceBody)
			const gravityForceEnu: Vector3 = { x: 0, y: 0, z: -params.massKg * GRAVITY_M_S2 }
			const netForceEnu = add(aerodynamicForceEnu, gravityForceEnu)

			// Integrate translational motion
			const accelerationEnu = scale(netForceEnu, 1 / params.massKg)
			state.velocityEnuMetersPerSec = add(state.velocityEnuMetersPerSec, scale(accelerationEnu, dt))
			// Limit speed to prevent numerical explosion
			const speed = magnitude(state.velocityEnuMetersPerSec)
			const maxSpeed = 250
			if (speed > maxSpeed) {
				state.velocityEnuMetersPerSec = scale(normalize(state.velocityEnuMetersPerSec), maxSpeed)
			}
			state.positionEnuMeters = add(state.positionEnuMeters, scale(state.velocityEnuMetersPerSec, dt))

			remaining -= dt
		}
	}
}



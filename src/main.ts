import './style.css'
import {
    Viewer,
    Cartesian3,
    Color,
    Math as CesiumMath,
    Transforms,
    HeadingPitchRoll,
    Ion,
    Entity,
    UrlTemplateImageryProvider,
    ImageryLayer,
    ConstantPositionProperty,
    ConstantProperty,
    Matrix4,
    JulianDate,
    IonResource,
    PathGraphics,
    TimeIntervalCollection,
    TimeInterval
} from 'cesium'
import '@cesium/widgets/Source/widgets.css'
import {
    FlightDynamicsModel,
    createDefaultAircraft,
    DefaultFdmConfig,
    type ControlInputs,
    clamp
} from './flightDynamics'
import { flightStateBus } from './state'

// Set Ion token from env if provided (enables high-quality satellite imagery)
const ionToken = (import.meta as any).env?.VITE_CESIUM_ION_TOKEN as string | undefined
if (ionToken && ionToken.length > 0) {
    Ion.defaultAccessToken = ionToken
}

const viewerContainer = document.getElementById('viewer') as HTMLDivElement
const baseLayer = ionToken
    ? ImageryLayer.fromWorldImagery({})
    : new ImageryLayer(
            new UrlTemplateImageryProvider({
                url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                credit: '© OpenStreetMap contributors'
            })
        )

const viewer = new Viewer(viewerContainer, {
    terrain: undefined,
    infoBox: false,
    selectionIndicator: false,
    shouldAnimate: true,
    sceneModePicker: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    navigationHelpButton: false,
    animation: true,
    timeline: true,
    fullscreenButton: true,
    baseLayer
})

// Enable atmosphere and dynamic lighting
viewer.scene.globe.enableLighting = true
if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true
if (viewer.scene.sun) viewer.scene.sun.show = true
if (viewer.scene.moon) viewer.scene.moon.show = true

// Starting location: above The Shard, London
const startLon = -0.0865
const startLat = 51.5045
const startAlt = 600

const startPosition = Cartesian3.fromDegrees(startLon, startLat, startAlt)

// Configure clock and timeline similar to Cesium flight tracker setup
const now = JulianDate.now()
const stop = JulianDate.addHours(now, 2, new JulianDate())
viewer.clock.startTime = JulianDate.clone(now)
viewer.clock.stopTime = JulianDate.clone(stop)
viewer.clock.currentTime = JulianDate.clone(now)
viewer.timeline.zoomTo(viewer.clock.startTime, viewer.clock.stopTime)
viewer.clock.multiplier = 1

// Load the model from Cesium ion if an Asset ID is provided, else use local file
const ionAssetIdStr = (import.meta as any).env?.VITE_ION_AIRCRAFT_ASSET_ID as string | undefined
const ionAssetId = ionAssetIdStr ? Number(ionAssetIdStr) : undefined
const aircraftUri = ionAssetId && Number.isFinite(ionAssetId)
    ? await IonResource.fromAssetId(ionAssetId)
    : '/models/aircraft.glb'

const aircraft: Entity = viewer.entities.add({
    name: 'Aircraft',
    availability: new TimeIntervalCollection([new TimeInterval({ start: viewer.clock.startTime, stop: viewer.clock.stopTime })]),
    position: startPosition,
    orientation: Transforms.headingPitchRollQuaternion(
        startPosition,
        new HeadingPitchRoll(CesiumMath.toRadians(90), 0, 0)
    ),
    model: {
        uri: aircraftUri as any,
        scale: 1.0,
        minimumPixelSize: 128,
        color: Color.WHITE
    },
    path: new PathGraphics({ width: 2 })
})

// Initial chase-camera offset: directly behind (negative Y), slightly above
aircraft.viewFrom = new ConstantPositionProperty(new Cartesian3(0, 150, 20))
viewer.trackedEntity = aircraft

// Set up local ENU frame anchored at the start position
const enuFromFixed = Transforms.eastNorthUpToFixedFrame(startPosition)

// Flight dynamics setup
const { params, state } = createDefaultAircraft()
// Give an initial forward speed to ensure immediate aerodynamic effectiveness
state.velocityEnuMetersPerSec.x = 55
// Align FDM yaw with initial visual heading (east)
state.yawRad = CesiumMath.toRadians(90)
const fdm: FlightDynamicsModel = new FlightDynamicsModel(params, state, DefaultFdmConfig)
;(window as any).FDM = fdm

// Apply a simple constant wind in ENU (m/s). Example: light breeze from NW toward SE
fdm.setWindEnuMetersPerSec({ x: 3, y: -2, z: 0 })

// Simple keyboard inputs
const inputs: ControlInputs = { elevator: 0, ailerons: 0, rudder: 0, throttle: 0.75 }
let pitchHoldTargetDeg: number | null = null
const keyState = new Set<string>()
window.addEventListener('keydown', e => {
    keyState.add(e.key)
})
window.addEventListener('keyup', e => {
    keyState.delete(e.key)
})

function updateInputsFromKeyboard() {
    // Only modify a control axis when relevant keys are pressed; otherwise keep programmatic value
    // Elevator: ArrowUp (pull nose up), ArrowDown (push nose down)
    if (keyState.has('ArrowUp') || keyState.has('ArrowDown')) {
        inputs.elevator = (keyState.has('ArrowUp') ? -1 : 0) + (keyState.has('ArrowDown') ? 1 : 0)
        inputs.elevator = Math.max(-1, Math.min(1, inputs.elevator))
    }
    // Ailerons: ArrowLeft, ArrowRight (Right roll with Right)
    if (keyState.has('ArrowLeft') || keyState.has('ArrowRight')) {
        inputs.ailerons = (keyState.has('ArrowRight') ? 1 : 0) + (keyState.has('ArrowLeft') ? -1 : 0)
        inputs.ailerons = Math.max(-1, Math.min(1, inputs.ailerons))
    }
    // Rudder: Q (left), E (right)
    if (keyState.has('e') || keyState.has('E') || keyState.has('q') || keyState.has('Q')) {
        inputs.rudder = (keyState.has('e') || keyState.has('E') ? 1 : 0) + (keyState.has('q') || keyState.has('Q') ? -1 : 0)
        inputs.rudder = Math.max(-1, Math.min(1, inputs.rudder))
    }
    // Throttle: Z decrease, X increase (additive)
    if (keyState.has('x') || keyState.has('X')) inputs.throttle = Math.min(1, inputs.throttle + 0.5 / 60)
    if (keyState.has('z') || keyState.has('Z')) inputs.throttle = Math.max(0, inputs.throttle - 0.5 / 60)
}

// Programmatic controls for automated tests and external integrations
;(window as any).CONTROLS = {
    set(partial: Partial<ControlInputs>) {
        if (partial.elevator !== undefined) inputs.elevator = clamp(partial.elevator, -1, 1)
        if (partial.ailerons !== undefined) inputs.ailerons = clamp(partial.ailerons, -1, 1)
        if (partial.rudder !== undefined) inputs.rudder = clamp(partial.rudder, -1, 1)
        if (partial.throttle !== undefined) inputs.throttle = clamp(partial.throttle, 0, 1)
    },
    get(): ControlInputs {
        return { ...inputs }
    },
    setPitchHoldDeg(target: number | null) {
        if (target === null || Number.isFinite(target)) {
            pitchHoldTargetDeg = target as any
        }
    }
}

// Provide deterministic test tuning helper
;(window as any).SIM = {
    setAeroScale: (s: { lift?: number; drag?: number }) => fdm.setAeroScale(s)
}

// Camera view management
type CameraMode = 'chase' | 'cockpit' | 'free'
let cameraMode: CameraMode = 'chase'
function setCameraMode(mode: CameraMode) {
    cameraMode = mode
    if (mode === 'chase') {
        viewer.scene.camera.lookAtTransform(Matrix4.IDENTITY)
        aircraft.viewFrom = new ConstantPositionProperty(new Cartesian3(0, 150, 20))
        viewer.trackedEntity = aircraft
    } else if (mode === 'free') {
        viewer.trackedEntity = undefined
        viewer.scene.camera.lookAtTransform(Matrix4.IDENTITY)
    } else {
        viewer.trackedEntity = undefined
    }
}

window.addEventListener('keydown', e => {
    if (e.key === '1') setCameraMode('chase')
    if (e.key === '2') setCameraMode('cockpit')
    if (e.key === '3') setCameraMode('free')
})

// Web Audio API: engine, wind, and ground-roll sounds
let audioCtx: AudioContext | undefined
let engineOsc: OscillatorNode | undefined
let engineGain: GainNode | undefined
let windSource: AudioBufferSourceNode | undefined
let windFilter: BiquadFilterNode | undefined
let windGain: GainNode | undefined
let groundSource: AudioBufferSourceNode | undefined
let groundFilter: BiquadFilterNode | undefined
let groundGain: GainNode | undefined

function createNoiseBuffer(ctx: AudioContext, seconds = 2): AudioBuffer {
    const sampleRate = ctx.sampleRate
    const length = Math.floor(sampleRate * seconds)
    const buffer = ctx.createBuffer(1, length, sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
    return buffer
}

function initAudioIfNeeded() {
    if (audioCtx) return
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    audioCtx = ctx

    // Master limiter-ish
    const master = ctx.createGain()
    master.gain.value = 0.8
    master.connect(ctx.destination)

    // Engine: sawtooth oscillator through lowpass
    engineOsc = ctx.createOscillator()
    engineOsc.type = 'sawtooth'
    const engineFilter = ctx.createBiquadFilter()
    engineFilter.type = 'lowpass'
    engineFilter.frequency.value = 1200
    engineGain = ctx.createGain()
    engineGain.gain.value = 0
    engineOsc.connect(engineFilter)
    engineFilter.connect(engineGain)
    engineGain.connect(master)
    engineOsc.start()

    // Wind: white noise through bandpass
    windSource = ctx.createBufferSource()
    windSource.buffer = createNoiseBuffer(ctx, 3)
    windSource.loop = true
    windFilter = ctx.createBiquadFilter()
    windFilter.type = 'bandpass'
    windFilter.frequency.value = 500
    windFilter.Q.value = 0.7
    windGain = ctx.createGain()
    windGain.gain.value = 0
    windSource.connect(windFilter)
    windFilter.connect(windGain)
    windGain.connect(master)
    windSource.start()

    // Ground roll: white noise through lowpass
    groundSource = ctx.createBufferSource()
    groundSource.buffer = createNoiseBuffer(ctx, 3)
    groundSource.loop = true
    groundFilter = ctx.createBiquadFilter()
    groundFilter.type = 'lowpass'
    groundFilter.frequency.value = 300
    groundGain = ctx.createGain()
    groundGain.gain.value = 0
    groundSource.connect(groundFilter)
    groundFilter.connect(groundGain)
    groundGain.connect(master)
    groundSource.start()
}

// Unlock audio on first user interaction
window.addEventListener('keydown', initAudioIfNeeded, { once: true })
viewerContainer.addEventListener('pointerdown', initAudioIfNeeded, { once: true })

// Lightweight performance telemetry
let fpsEma = 60
let fdmMsEma = 0
let lastPerfNowMs = performance.now()
const perfAlpha = 0.1
;(window as any).PERF = {
    getFps: () => fpsEma,
    getFdmMs: () => fdmMsEma
}

// On-tick simulation update driving the aircraft entity over time (like the tutorial, but procedural)
let lastTime: JulianDate | undefined
viewer.clock.onTick.addEventListener(clock => {
    // FPS estimate using wall-clock between ticks
    const nowPerf = performance.now()
    const frameMs = nowPerf - lastPerfNowMs
    lastPerfNowMs = nowPerf
    if (frameMs > 0 && Number.isFinite(frameMs)) {
        const instFps = 1000 / frameMs
        fpsEma = (1 - perfAlpha) * fpsEma + perfAlpha * instFps
    }
    const now = clock.currentTime
    if (!lastTime) {
        lastTime = JulianDate.clone(now)
        return
    }
    let dt = JulianDate.secondsDifference(now, lastTime)
    lastTime = JulianDate.clone(now)
    if (!Number.isFinite(dt) || dt <= 0) return
    // Cap dt to avoid huge jumps when tab regains focus
    if (dt > 0.1) dt = 0.1

    updateInputsFromKeyboard()
    // Simple pitch hold (positive elevator commands nose-up)
    if (pitchHoldTargetDeg !== null) {
        const currentPitchDeg = fdm.state.pitchRad * 180 / Math.PI
        const errorDeg = (pitchHoldTargetDeg as number) - currentPitchDeg
        const kp = 0.06
        inputs.elevator = clamp(kp * errorDeg, -1, 1)
    }
    const t0 = performance.now()
    fdm.update(dt, inputs)
    const t1 = performance.now()
    const fdmMs = t1 - t0
    if (Number.isFinite(fdmMs)) {
        fdmMsEma = (1 - perfAlpha) * fdmMsEma + perfAlpha * fdmMs
    }

    // Compute world position from local ENU offset
    const localOffset = new Cartesian3(
        fdm.state.positionEnuMeters.x,
        fdm.state.positionEnuMeters.y,
        fdm.state.positionEnuMeters.z
    )
    const worldPosition = new Cartesian3()
    Matrix4.multiplyByPoint(enuFromFixed, localOffset, worldPosition)

    // Orientation from yaw/pitch/roll in ENU frame
    const hpr = new HeadingPitchRoll(fdm.state.yawRad, fdm.state.pitchRad, fdm.state.rollRad)
    const orientation = Transforms.headingPitchRollQuaternion(worldPosition, hpr)

    aircraft.position = new ConstantPositionProperty(worldPosition)
    aircraft.orientation = new ConstantProperty(orientation)

    // Camera per-mode handling
    if (cameraMode === 'cockpit') {
        const modelMatrix = Transforms.headingPitchRollToFixedFrame(worldPosition, hpr)
        // Slightly forward and above nose; tune for your model
        viewer.scene.camera.lookAtTransform(modelMatrix, new Cartesian3(1.8, 0, 1.2))
    }

    // Publish HUD state
    const vel = fdm.state.velocityEnuMetersPerSec
    const speedMS = Math.hypot(vel.x, vel.y, vel.z)
    const speedKts = speedMS * 1.9438444924574
    const altitudeM = fdm.state.positionEnuMeters.z
    const altitudeFt = altitudeM * 3.28084
    const headingDeg = ((fdm.state.yawRad * 180 / Math.PI) + 360) % 360
    const pitchDeg = fdm.state.pitchRad * 180 / Math.PI
    const rollDeg = fdm.state.rollRad * 180 / Math.PI
    flightStateBus.publish({
        airspeedMS: speedMS,
        airspeedKts: speedKts,
        altitudeM,
        altitudeFt,
        pitchDeg,
        rollDeg,
        yawDeg: headingDeg,
        headingDeg,
        throttle01: inputs.throttle
    })

    // Update audio parameters if initialized
    if (audioCtx) {
        // Engine pitch and loudness tied to throttle and speed
        const t = Math.max(0, Math.min(1, inputs.throttle))
        const rpmHz = 40 + 260 * t
        if (engineOsc) (engineOsc as OscillatorNode).frequency.value = rpmHz
        if (engineGain) (engineGain as GainNode).gain.value = 0.05 + 0.15 * t

        // Wind noise scales with airspeed (quadratic-ish), clamp to safe range
        const windStrength = Math.min(1, (speedMS / 80) ** 2)
        if (windFilter) (windFilter as BiquadFilterNode).frequency.value = 400 + 1200 * windStrength
        if (windGain) (windGain as GainNode).gain.value = 0.02 + 0.25 * windStrength

        // Ground roll when near ground with forward speed
        const onGround = altitudeM < 1.5
        const rollStrength = onGround ? Math.min(1, speedMS / 25) : 0
        if (groundFilter) (groundFilter as BiquadFilterNode).frequency.value = 200 + 400 * rollStrength
        if (groundGain) (groundGain as GainNode).gain.value = 0.0 + 0.3 * rollStrength
    }
})

// Cesium handles resizing automatically via the underlying widget

// Simple DOM HUD binders
const asiEl = document.getElementById('asi') as HTMLSpanElement
const altEl = document.getElementById('alt') as HTMLSpanElement
const hdgEl = document.getElementById('hdg') as HTMLSpanElement
const attEl = document.getElementById('att') as HTMLSpanElement
const thrEl = document.getElementById('thr') as HTMLSpanElement
const thrFillEl = document.getElementById('thrFill') as HTMLDivElement
const aiEl = document.getElementById('ai') as HTMLDivElement

flightStateBus.subscribe(s => {
    if (asiEl) asiEl.textContent = Math.round(s.airspeedKts).toString()
    if (altEl) altEl.textContent = Math.round(s.altitudeFt).toString()
    if (hdgEl) hdgEl.textContent = String(Math.round(s.headingDeg)).padStart(3, '0')
    if (attEl) attEl.textContent = `${Math.round(s.pitchDeg)}/${Math.round(s.rollDeg)}`
    if (thrEl) thrEl.textContent = String(Math.round(s.throttle01 * 100))
    if (thrFillEl) thrFillEl.style.width = `${Math.round(s.throttle01 * 100)}%`
    // Artificial horizon: translate and rotate the sky/ground container
    if (aiEl) {
        // Pitch moves horizon up/down, roll rotates
        aiEl.style.transform = `rotate(${(-s.rollDeg).toFixed(1)}deg)`
        const sky = aiEl.querySelector('.ai-sky') as HTMLDivElement | null
        const ground = aiEl.querySelector('.ai-ground') as HTMLDivElement | null
        const horizon = aiEl.querySelector('.ai-horizon') as HTMLDivElement | null
        const offset = Math.max(-100, Math.min(100, s.pitchDeg)) // smaller visual range
        const translate = `translateY(${offset * 2.2}px)`
        if (sky) sky.style.transform = translate
        if (ground) ground.style.transform = translate
        if (horizon) horizon.style.transform = translate
    }
})

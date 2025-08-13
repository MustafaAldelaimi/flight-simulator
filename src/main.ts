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
    type ControlInputs
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
// Give a small initial forward speed to avoid immediate vertical drop
state.velocityEnuMetersPerSec.x = 30
// Align FDM yaw with initial visual heading (east)
state.yawRad = CesiumMath.toRadians(90)
const fdm: FlightDynamicsModel = new FlightDynamicsModel(params, state, DefaultFdmConfig)
;(window as any).FDM = fdm

// Simple keyboard inputs
const inputs: ControlInputs = { elevator: 0, ailerons: 0, rudder: 0, throttle: 0.75 }
const keyState = new Set<string>()
window.addEventListener('keydown', e => {
    keyState.add(e.key)
})
window.addEventListener('keyup', e => {
    keyState.delete(e.key)
})

function updateInputsFromKeyboard() {
    // Elevator: ArrowUp (pull nose up), ArrowDown (push nose down)
    inputs.elevator = (keyState.has('ArrowUp') ? -1 : 0) + (keyState.has('ArrowDown') ? 1 : 0)
    inputs.elevator = Math.max(-1, Math.min(1, inputs.elevator))
    // Ailerons: ArrowLeft, ArrowRight (Right roll with Right)
    inputs.ailerons = (keyState.has('ArrowRight') ? 1 : 0) + (keyState.has('ArrowLeft') ? -1 : 0)
    inputs.ailerons = Math.max(-1, Math.min(1, inputs.ailerons))
    // Rudder: Q (left), E (right)
    inputs.rudder = (keyState.has('e') || keyState.has('E') ? 1 : 0) + (keyState.has('q') || keyState.has('Q') ? -1 : 0)
    inputs.rudder = Math.max(-1, Math.min(1, inputs.rudder))
    // Throttle: Z decrease, X increase
    if (keyState.has('x') || keyState.has('X')) inputs.throttle = Math.min(1, inputs.throttle + 0.5 / 60)
    if (keyState.has('z') || keyState.has('Z')) inputs.throttle = Math.max(0, inputs.throttle - 0.5 / 60)
}

// On-tick simulation update driving the aircraft entity over time (like the tutorial, but procedural)
let lastTime: JulianDate | undefined
viewer.clock.onTick.addEventListener(clock => {
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
    fdm.update(dt, inputs)

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

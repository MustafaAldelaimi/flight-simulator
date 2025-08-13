export type FlightHudState = {
	airspeedMS: number
	airspeedKts: number
	altitudeM: number
	altitudeFt: number
	pitchDeg: number
	rollDeg: number
	yawDeg: number
	headingDeg: number
	throttle01: number
}

type Subscriber<T> = (state: T) => void

class StateBus<T> {
	private subscribers: Set<Subscriber<T>> = new Set()
	private _last: T | undefined

	subscribe(fn: Subscriber<T>): () => void {
		this.subscribers.add(fn)
		if (this._last !== undefined) fn(this._last)
		return () => this.subscribers.delete(fn)
	}

	publish(state: T): void {
		this._last = state
		for (const fn of this.subscribers) fn(state)
	}

	get last(): T | undefined {
		return this._last
	}
}

export const flightStateBus = new StateBus<FlightHudState>()



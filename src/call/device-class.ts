/**
 * The single device-class rule of the call (handover §1, §2): "desktop" shows video, "compact" shows none but can
 * send the camera.
 * The same class drives the layout. It is a user-experience rule, not a security boundary.
 */
export type Form = "desktop" | "compact";

/**
 * The page layout. "sideways" is a phone or tablet in landscape with the compact call: the desktop table without
 * videos, at the size of the screen.
 */
export type Layout = Form | "sideways";

/** On a computer, a layout viewport narrower than this many CSS pixels is compact. */
export const COMPACT_BELOW_WIDTH = 900;

export interface DeviceSignals {
	/** Layout viewport width in CSS pixels. */
	readonly viewportWidth: number;
	/** Layout viewport height in CSS pixels. */
	readonly viewportHeight: number;
	/** `navigator.userAgentData.mobile`, or undefined when the browser does not expose it. */
	readonly uaMobile: boolean | undefined;
	readonly userAgent: string;
	readonly maxTouchPoints: number;
	/** `(any-pointer: fine)`: at least one precise pointer, such as a mouse or trackpad. */
	readonly anyFinePointer: boolean;
}

/** The player's orientation choices (src/ui/settings.ts). */
export interface OrientationChoices {
	/** A phone or tablet in landscape gets the desktop form, at any width. */
	readonly landscapeDesktop: boolean;
	/** A computer with a portrait viewport gets the compact form, at any width. */
	readonly portraitMobile: boolean;
}

/** iPadOS Safari reports a Macintosh desktop user agent; the touch points give it away. */
function isIPadDesktopMode(signals: DeviceSignals): boolean {
	return /\bMacintosh\b/.test(signals.userAgent) && signals.maxTouchPoints > 1;
}

/** A phone or tablet: a mobile signal, or no fine pointer. */
function isTouchDevice(signals: DeviceSignals): boolean {
	return (
		signals.uaMobile === true ||
		isIPadDesktopMode(signals) ||
		!signals.anyFinePointer
	);
}

/**
 * A phone or tablet is compact, or desktop in landscape when the player chose it. A computer is desktop, or compact
 * below the width limit, and in portrait when the player chose it. A square viewport is landscape.
 */
export function classify(
	signals: DeviceSignals,
	choices: OrientationChoices,
): Form {
	const portrait = signals.viewportHeight > signals.viewportWidth;
	if (isTouchDevice(signals))
		return choices.landscapeDesktop && !portrait ? "desktop" : "compact";
	if (signals.viewportWidth < COMPACT_BELOW_WIDTH) return "compact";
	if (portrait && choices.portraitMobile) return "compact";
	return "desktop";
}

/** The layout of the class: a compact phone or tablet in landscape is sideways. */
export function layout(
	signals: DeviceSignals,
	choices: OrientationChoices,
): Layout {
	const form = classify(signals, choices);
	const landscape = signals.viewportHeight <= signals.viewportWidth;
	return form === "compact" && isTouchDevice(signals) && landscape
		? "sideways"
		: form;
}

/** The call form of a layout. */
export function formOf(value: Layout): Form {
	return value === "desktop" ? "desktop" : "compact";
}

// ---------------------------------------------------------------------------------------------------------------
// Browser adapter

interface MediaQueryLike {
	readonly matches: boolean;
	addEventListener(type: "change", listener: () => void): void;
	removeEventListener(type: "change", listener: () => void): void;
}

/** The part of `window` the adapter reads. */
export interface DeviceWindow {
	readonly innerWidth: number;
	readonly innerHeight: number;
	readonly navigator: {
		readonly userAgent: string;
		readonly maxTouchPoints: number;
		readonly userAgentData?: unknown;
	};
	matchMedia(query: string): MediaQueryLike;
	addEventListener(type: "resize", listener: () => void): void;
	removeEventListener(type: "resize", listener: () => void): void;
}

const FINE_POINTER_QUERY = "(any-pointer: fine)";

/** `userAgentData.mobile` when it is a boolean; Firefox and Safari have no `userAgentData`. */
export function uaMobile(userAgentData: unknown): boolean | undefined {
	if (typeof userAgentData !== "object" || userAgentData === null)
		return undefined;
	const mobile = (userAgentData as { mobile?: unknown }).mobile;
	return typeof mobile === "boolean" ? mobile : undefined;
}

export function readSignals(win: DeviceWindow): DeviceSignals {
	return {
		viewportWidth: win.innerWidth,
		viewportHeight: win.innerHeight,
		uaMobile: uaMobile(win.navigator.userAgentData),
		userAgent: win.navigator.userAgent,
		maxTouchPoints: win.navigator.maxTouchPoints,
		anyFinePointer: win.matchMedia(FINE_POINTER_QUERY).matches,
	};
}

export interface DeviceClassWatch {
	/** Classifies again now, for example after the player changed the orientation choices. */
	check(): void;
	/** Removes the listeners. */
	stop(): void;
}

/**
 * Calls `onChange` with the new layout whenever a resize, rotation, pointer change or `check` moves the device across
 * a boundary. Each check reads the choices again.
 */
export function watchDeviceClass(
	win: DeviceWindow,
	choices: () => OrientationChoices,
	onChange: (value: Layout) => void,
): DeviceClassWatch {
	const pointer = win.matchMedia(FINE_POINTER_QUERY);
	let current = layout(readSignals(win), choices());
	const check = () => {
		const next = layout(readSignals(win), choices());
		if (next === current) return;
		current = next;
		onChange(next);
	};
	win.addEventListener("resize", check);
	pointer.addEventListener("change", check);
	return {
		check,
		stop() {
			win.removeEventListener("resize", check);
			pointer.removeEventListener("change", check);
		},
	};
}

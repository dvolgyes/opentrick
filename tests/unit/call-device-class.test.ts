import { describe, expect, it } from "vitest";
import {
	classify,
	type DeviceSignals,
	type Form,
	formOf,
	type Layout,
	layout,
	type OrientationChoices,
	uaMobile,
} from "../../src/call/device-class";

const CHROME_DESKTOP_UA =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";
const IPAD_DESKTOP_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const FIREFOX_DESKTOP_UA =
	"Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";

function desktop(overrides: Partial<DeviceSignals> = {}): DeviceSignals {
	return {
		viewportWidth: 1280,
		viewportHeight: 800,
		uaMobile: false,
		userAgent: CHROME_DESKTOP_UA,
		maxTouchPoints: 0,
		anyFinePointer: true,
		...overrides,
	};
}

/** Neither orientation choice forces a view, so only the device and the width decide. */
const NO_FORCING: OrientationChoices = {
	landscapeDesktop: false,
	portraitMobile: false,
};
const BOTH_CHOICES: OrientationChoices = {
	landscapeDesktop: true,
	portraitMobile: true,
};

describe("classify", () => {
	it.each<[string, Partial<DeviceSignals>, Form]>([
		["a wide desktop with a mouse", {}, "desktop"],
		["width 899", { viewportWidth: 899 }, "compact"],
		["width 900 with a fine pointer", { viewportWidth: 900 }, "desktop"],
		[
			"userAgentData.mobile at 1400 px",
			{ viewportWidth: 1400, uaMobile: true },
			"compact",
		],
		["coarse pointer only", { anyFinePointer: false }, "compact"],
		[
			"iPadOS in desktop mode with touch",
			{ userAgent: IPAD_DESKTOP_UA, maxTouchPoints: 5, uaMobile: undefined },
			"compact",
		],
		[
			"a Mac with a trackpad",
			{ userAgent: IPAD_DESKTOP_UA, maxTouchPoints: 0, uaMobile: undefined },
			"desktop",
		],
		[
			"Firefox desktop without userAgentData",
			{ userAgent: FIREFOX_DESKTOP_UA, uaMobile: undefined },
			"desktop",
		],
		[
			"a touch laptop that also has a fine pointer",
			{ maxTouchPoints: 10 },
			"desktop",
		],
		[
			"a portrait 1000 × 1200 window with a mouse",
			{ viewportWidth: 1000, viewportHeight: 1200 },
			"desktop",
		],
	])(
		"%s → %s, when no orientation choice forces a view",
		(_name, overrides, expected) => {
			expect(classify(desktop(overrides), NO_FORCING)).toBe(expected);
		},
	);

	const PHONE = { uaMobile: true, anyFinePointer: false } as const;
	const TABLET = {
		userAgent: IPAD_DESKTOP_UA,
		maxTouchPoints: 5,
		uaMobile: undefined,
		anyFinePointer: false,
	} as const;
	it.each<[string, Partial<DeviceSignals>, Partial<OrientationChoices>, Form]>([
		[
			"a phone in landscape, 844 × 390",
			{ ...PHONE, viewportWidth: 844, viewportHeight: 390 },
			{},
			"desktop",
		],
		[
			"a phone in landscape without the landscape choice",
			{ ...PHONE, viewportWidth: 844, viewportHeight: 390 },
			{ landscapeDesktop: false },
			"compact",
		],
		[
			"a phone in portrait, 390 × 844",
			{ ...PHONE, viewportWidth: 390, viewportHeight: 844 },
			{},
			"compact",
		],
		[
			"a tablet in landscape, 1180 × 820",
			{ ...TABLET, viewportWidth: 1180, viewportHeight: 820 },
			{},
			"desktop",
		],
		[
			"a tablet in portrait, 820 × 1180",
			{ ...TABLET, viewportWidth: 820, viewportHeight: 1180 },
			{},
			"compact",
		],
		[
			"a portrait 1000 × 1200 window with a mouse",
			{ viewportWidth: 1000, viewportHeight: 1200 },
			{},
			"compact",
		],
		[
			"a portrait 1000 × 1200 window without the portrait choice",
			{ viewportWidth: 1000, viewportHeight: 1200 },
			{ portraitMobile: false },
			"desktop",
		],
		[
			"a portrait 600 × 1000 window without the portrait choice",
			{ viewportWidth: 600, viewportHeight: 1000 },
			{ portraitMobile: false },
			"compact",
		],
		[
			"a square 1000 × 1000 window with a mouse",
			{ viewportWidth: 1000, viewportHeight: 1000 },
			{},
			"desktop",
		],
		[
			"a landscape 899 × 600 window with a mouse",
			{ viewportWidth: 899, viewportHeight: 600 },
			{},
			"compact",
		],
	])("%s → %s", (_name, overrides, choices, expected) => {
		expect(classify(desktop(overrides), { ...BOTH_CHOICES, ...choices })).toBe(
			expected,
		);
	});
});

describe("layout", () => {
	const PHONE = { uaMobile: true, anyFinePointer: false } as const;
	const TABLET = {
		userAgent: IPAD_DESKTOP_UA,
		maxTouchPoints: 5,
		uaMobile: undefined,
		anyFinePointer: false,
	} as const;
	it.each<
		[string, Partial<DeviceSignals>, Partial<OrientationChoices>, Layout]
	>([
		["a wide desktop with a mouse", {}, {}, "desktop"],
		[
			"a phone in landscape without the landscape choice",
			{ ...PHONE, viewportWidth: 844, viewportHeight: 390 },
			{ landscapeDesktop: false },
			"sideways",
		],
		[
			"a phone in landscape with the landscape choice",
			{ ...PHONE, viewportWidth: 844, viewportHeight: 390 },
			{},
			"desktop",
		],
		[
			"a phone in portrait",
			{ ...PHONE, viewportWidth: 390, viewportHeight: 844 },
			{ landscapeDesktop: false },
			"compact",
		],
		[
			"a tablet in landscape without the landscape choice",
			{ ...TABLET, viewportWidth: 1180, viewportHeight: 820 },
			{ landscapeDesktop: false },
			"sideways",
		],
		[
			"a landscape 899 × 600 window with a mouse",
			{ viewportWidth: 899, viewportHeight: 600 },
			{ landscapeDesktop: false },
			"compact",
		],
		[
			"a portrait 1000 × 1200 window with a mouse",
			{ viewportWidth: 1000, viewportHeight: 1200 },
			{ landscapeDesktop: false },
			"compact",
		],
	])("%s → %s", (_name, overrides, choices, expected) => {
		expect(layout(desktop(overrides), { ...BOTH_CHOICES, ...choices })).toBe(
			expected,
		);
	});

	it("gives the sideways layout the compact call, which shows no video", () => {
		expect(formOf("desktop")).toBe<Form>("desktop");
		expect(formOf("compact")).toBe<Form>("compact");
		expect(formOf("sideways")).toBe<Form>("compact");
	});
});

describe("uaMobile", () => {
	it("reads userAgentData.mobile only when it is a boolean", () => {
		expect(uaMobile({ mobile: true })).toBe(true);
		expect(uaMobile({ mobile: false })).toBe(false);
		expect(uaMobile({ mobile: "yes" })).toBe(undefined);
		expect(uaMobile(null)).toBe(undefined);
		expect(uaMobile(undefined)).toBe(undefined);
	});
});

// readSignals and watchDeviceClass are tested on Chrome's window in tests/browser/call-device-class.test.ts.

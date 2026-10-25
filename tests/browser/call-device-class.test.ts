import { describe, expect, it } from "vitest";
import { cdp, page } from "vitest/browser";
import {
	classify,
	type Layout,
	type OrientationChoices,
	readSignals,
	watchDeviceClass,
} from "../../src/call/device-class";

// The tests use this page's window in Chrome. The viewport changes the layout width, and Chrome's DevTools
// emulation changes the user agent and the pointer.

/** Both orientation choices: a phone or tablet in landscape is desktop, a portrait window is compact. */
const BOTH_CHOICES: OrientationChoices = {
	landscapeDesktop: true,
	portraitMobile: true,
};
const NO_LANDSCAPE_DESKTOP: OrientationChoices = {
	...BOTH_CHOICES,
	landscapeDesktop: false,
};

/** Sets the viewport size and waits for the window's resize event. */
async function resizeTo(width: number, height = 720): Promise<void> {
	if (innerWidth === width && innerHeight === height) return;
	const resized = new Promise((resolve) =>
		addEventListener("resize", resolve, { once: true }),
	);
	await page.viewport(width, height);
	await resized;
	expect([innerWidth, innerHeight]).toEqual([width, height]);
}

describe("readSignals on Chrome's window", () => {
	it("reads the width, the user agent and the fine pointer of desktop Chrome", async () => {
		await resizeTo(1280);
		const signals = readSignals(window);
		expect(signals).toEqual({
			viewportWidth: 1280,
			viewportHeight: 720,
			uaMobile: false,
			userAgent: navigator.userAgent,
			maxTouchPoints: 0,
			anyFinePointer: true,
		});
		expect(classify(signals, BOTH_CHOICES)).toBe("desktop");
	});

	it("reads userAgentData.mobile from a mobile user agent", async () => {
		await resizeTo(1280);
		await cdp().send("Emulation.setUserAgentOverride", {
			userAgent: navigator.userAgent,
			userAgentMetadata: {
				platform: "Android",
				platformVersion: "14",
				architecture: "",
				model: "Pixel 8",
				mobile: true,
			},
		});
		try {
			expect(readSignals(window).uaMobile).toBe(true);
			expect(classify(readSignals(window), NO_LANDSCAPE_DESKTOP)).toBe(
				"compact",
			);
			// A phone in landscape gets the desktop view with the landscape choice.
			expect(classify(readSignals(window), BOTH_CHOICES)).toBe("desktop");
		} finally {
			await cdp().send("Emulation.setUserAgentOverride", { userAgent: "" });
		}
		expect(readSignals(window).uaMobile).toBe(false);
	});
});

describe("watchDeviceClass on Chrome's window", () => {
	it("reports only changes of class from viewport resizes and checks after a new choice, and nothing after stop", async () => {
		await resizeTo(1280);
		const seen: Layout[] = [];
		const choices = { ...BOTH_CHOICES };
		const watch = watchDeviceClass(
			window,
			() => choices,
			(form) => seen.push(form),
		);
		await resizeTo(1000); // still desktop
		await resizeTo(800); // compact
		await resizeTo(700); // still compact
		await resizeTo(1280); // desktop
		await resizeTo(1000, 1200); // compact: a portrait window
		choices.portraitMobile = false;
		watch.check(); // desktop: the player turned off the portrait choice
		await resizeTo(1280); // still desktop
		expect(seen).toEqual(["compact", "desktop", "compact", "desktop"]);
		watch.stop();
		await resizeTo(800);
		expect(seen).toEqual(["compact", "desktop", "compact", "desktop"]);
	});

	// Last test of the file: Chrome keeps the touch-only pointer until the browser closes.
	it("reports sideways when the pointer of a landscape window becomes touch only, without the landscape choice, and nothing after stop", async () => {
		await resizeTo(1280);
		const stopped: Layout[] = [];
		watchDeviceClass(
			window,
			() => NO_LANDSCAPE_DESKTOP,
			(form) => stopped.push(form),
		).stop();
		const seen: Layout[] = [];
		const watch = watchDeviceClass(
			window,
			() => NO_LANDSCAPE_DESKTOP,
			(form) => seen.push(form),
		);
		await cdp().send("Emulation.setTouchEmulationEnabled", {
			enabled: true,
			maxTouchPoints: 5,
		});
		await expect.poll(() => seen).toEqual(["sideways"]);
		expect(readSignals(window)).toMatchObject({
			anyFinePointer: false,
			maxTouchPoints: 5,
		});
		expect(stopped).toEqual([]);
		watch.stop();
	});
});

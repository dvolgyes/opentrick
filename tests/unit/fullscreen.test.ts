import { describe, expect, it } from "vitest";
import { FullscreenPolicy, type FullscreenPort } from "../../src/ui/fullscreen";

function fakePort(enabled = true): FullscreenPort & {
	entered: number;
	exited: number;
	active: () => boolean;
	userExits: () => void;
} {
	let active = false;
	const port = {
		entered: 0,
		exited: 0,
		enabled: () => enabled,
		active: () => active,
		enter: () => {
			port.entered += 1;
			active = true;
		},
		exit: () => {
			port.exited += 1;
			active = false;
		},
		userExits: () => {
			active = false;
		},
	};
	return port;
}

describe("FullscreenPolicy", () => {
	it("enters full screen on the first gesture after the game begins with all seats taken", () => {
		const port = fakePort();
		const policy = new FullscreenPolicy(port);
		policy.gesture();
		expect(port.entered).toBe(0);
		policy.update(true);
		policy.update(true);
		policy.gesture();
		policy.gesture();
		expect(port.entered).toBe(1);
		expect(port.active()).toBe(true);
	});

	it("leaves full screen when a seat becomes empty, and asks again when it is taken", () => {
		const port = fakePort();
		const policy = new FullscreenPolicy(port);
		policy.update(true);
		policy.gesture();
		policy.update(false);
		expect(port.exited).toBe(1);
		expect(port.active()).toBe(false);
		policy.gesture();
		expect(port.entered).toBe(1);
		policy.update(true);
		policy.gesture();
		expect(port.entered).toBe(2);
	});

	it("does not take the screen back after the player leaves full screen", () => {
		const port = fakePort();
		const policy = new FullscreenPolicy(port);
		policy.update(true);
		policy.gesture();
		port.userExits();
		policy.update(true);
		policy.gesture();
		expect(port.entered).toBe(1);
	});

	it("does not leave a full screen that is not active", () => {
		const port = fakePort();
		const policy = new FullscreenPolicy(port);
		policy.update(true);
		policy.update(false);
		expect(port.exited).toBe(0);
		policy.gesture();
		expect(port.entered).toBe(0);
	});

	it("does nothing when the browser does not allow full screen", () => {
		const port = fakePort(false);
		const policy = new FullscreenPolicy(port);
		policy.update(true);
		policy.gesture();
		expect(port.entered).toBe(0);
	});
});

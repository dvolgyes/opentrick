import { describe, expect, it } from "vitest";
import { RESUME_COALESCE_MS, RESUME_HIDDEN_MS } from "../../src/p2p/limits";
import { watchNetworkChanges } from "../../src/p2p/network-watch";

/** A page whose events, visibility and wall clock the test controls; `changes` counts the calls of `onChange`. */
function fakePage(withConnection = true) {
	const window = new EventTarget();
	const document = Object.assign(new EventTarget(), {
		visibilityState: "visible" as DocumentVisibilityState,
	});
	const connection = withConnection ? new EventTarget() : undefined;
	const clock = { now: 1_000_000 };
	const calls = { changes: 0 };
	const stop = watchNetworkChanges(
		{ window, document, connection, wall: () => clock.now },
		() => calls.changes++,
	);
	const setVisibility = (state: DocumentVisibilityState) => {
		document.visibilityState = state;
		document.dispatchEvent(new Event("visibilitychange"));
	};
	/** The page is hidden for `ms`, then shown again. */
	const hideFor = (ms: number) => {
		setVisibility("hidden");
		clock.now += ms;
		setVisibility("visible");
	};
	const pageshow = (persisted: boolean) =>
		window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted }));
	return {
		window,
		document,
		connection,
		clock,
		calls,
		stop,
		hideFor,
		pageshow,
	};
}

describe("the page's network changes", () => {
	it("reports the online event and a change of the connection type", () => {
		const page = fakePage();
		page.window.dispatchEvent(new Event("online"));
		page.connection?.dispatchEvent(new Event("change"));
		expect(page.calls.changes).toBe(2);
	});

	it("works without the Network Information API", () => {
		const page = fakePage(false);
		page.window.dispatchEvent(new Event("online"));
		expect(page.calls.changes).toBe(1);
	});

	it("reports a page that was hidden for RESUME_HIDDEN_MS or longer, not a short switch to another tab", () => {
		const page = fakePage();
		page.hideFor(RESUME_HIDDEN_MS - 1);
		expect(page.calls.changes).toBe(0);
		page.clock.now += RESUME_COALESCE_MS;
		page.hideFor(RESUME_HIDDEN_MS);
		expect(page.calls.changes).toBe(1);
	});

	it("reports a page that the browser restores from its back-forward cache, not a new page load", () => {
		const page = fakePage();
		page.pageshow(false);
		expect(page.calls.changes).toBe(0);
		page.pageshow(true);
		expect(page.calls.changes).toBe(1);
	});

	it("reports a page that the browser resumes after a freeze", () => {
		const page = fakePage();
		page.document.dispatchEvent(new Event("resume"));
		expect(page.calls.changes).toBe(1);
	});

	it("reports one resume when the browser sends several signals for it", () => {
		const page = fakePage();
		page.document.visibilityState = "hidden";
		page.document.dispatchEvent(new Event("visibilitychange"));
		page.clock.now += 10 * RESUME_HIDDEN_MS;
		page.document.dispatchEvent(new Event("resume"));
		page.document.visibilityState = "visible";
		page.document.dispatchEvent(new Event("visibilitychange"));
		page.pageshow(true);
		expect(page.calls.changes).toBe(1);
		// A later resume is a new one.
		page.clock.now += RESUME_COALESCE_MS;
		page.document.dispatchEvent(new Event("resume"));
		expect(page.calls.changes).toBe(2);
	});

	it("reports nothing after it stops", () => {
		const page = fakePage();
		page.stop();
		page.window.dispatchEvent(new Event("online"));
		page.connection?.dispatchEvent(new Event("change"));
		page.hideFor(RESUME_HIDDEN_MS);
		page.pageshow(true);
		page.document.dispatchEvent(new Event("resume"));
		expect(page.calls.changes).toBe(0);
	});
});

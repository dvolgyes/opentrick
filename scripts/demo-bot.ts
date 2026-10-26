import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import { DEFAULT_BOT_SETUP } from "../src/protocol";

const policy = process.argv.includes("--local-rl")
	? "rl-fsp"
	: process.argv.includes("--local")
		? "sl"
		: DEFAULT_BOT_SETUP.bidder;
await import("./prepare-bidder");
const port = "5178";
const origin = `http://localhost:${port}`;
const server = spawn(
	"npm",
	["run", "dev", "--", "--host", "127.0.0.1", "--port", port, "--strictPort"],
	{ stdio: "ignore" },
);
const deadline = Date.now() + 30_000;
let ready = false;
while (!ready && Date.now() < deadline) {
	try {
		ready = (await fetch(origin)).ok;
	} catch {
		/* The local server is still starting. */
	}
	if (!ready) await new Promise((resolve) => setTimeout(resolve, 200));
}
if (!ready) {
	server.kill();
	throw new Error("demo server did not start");
}
const context = await chromium.launchPersistentContext(
	"/tmp/opentrick-local-bidder-host-browser",
	{
		channel: "chrome",
		headless: false,
		viewport: { width: 1440, height: 1000 },
	},
);
const shutdown = () => {
	void context.close();
	server.kill();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
const page = context.pages()[0] ?? (await context.newPage());
let apiRequests = 0;
await page.route("https://openrouter.ai/**", async (route) => {
	apiRequests++;
	await route.abort();
});
await page.goto(`${origin}/?bot_bidder=${policy}`);
await page.locator('input[name="me"][value="W"]').check();
for (const seat of ["N", "E", "S", "W"] as const) {
	await page
		.locator(`input[name="name-${seat}"]`)
		.fill(seat === "W" ? "You" : `DDS ${seat}`);
	await page.locator(`input[name="bot-${seat}"]`).setChecked(seat !== "W");
}
await page.getByTestId("create").click();
await page
	.getByTestId("room-controls")
	.waitFor({ state: "visible", timeout: 60_000 });
console.error(
	`Host browser open at ${origin} — local ${policy} bidding and DDS play, with West available to you.`,
);
const autoplay = page.getByTestId("host-autoplay-toggle");
await autoplay.click();
let complete = false;
const boardDeadline = Date.now() + 10 * 60_000;
while (!complete && Date.now() < boardDeadline && !page.isClosed()) {
	const state = await page.locator("[data-phase]").evaluate((element) => ({
		phase: element.getAttribute("data-phase"),
		at: Number(element.getAttribute("data-at")),
	}));
	complete = state.phase === "complete" && state.at >= 56;
	if (!complete) await new Promise((resolve) => setTimeout(resolve, 500));
}
if (complete) {
	await autoplay.click();
	if (apiRequests !== 0)
		throw new Error("local demo attempted an OpenRouter request");
	console.error(
		"Verified: a full board with local bidding, zero model API requests, and 52 local DDS card plays. West is now under human control; the three bots remain active.",
	);
} else {
	console.error(
		"The live board has not completed. The browser remains open for inspection.",
	);
}
await new Promise<void>((resolve) => context.on("close", () => resolve()));
server.kill();

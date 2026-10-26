import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import {
	DEFAULT_MQTT_BROKER_URLS,
	DEFAULT_NOSTR_RELAY_URLS,
	DEFAULT_TRACKER_URLS,
} from "../../src/p2p/config";

/*
 * Four robots play a full board through the real public relays with local bidding and DDS play, once for each kind of signaling
 * server alone and once for all three kinds (ADR 0004). The browser page hosts the table at West with autoplay; three
 * Node bots (src/bot/cli.ts) take North, East and South. Opt in with E2E_LIVE=1
 * (`npm run test:e2e:live`). No model API or key is used.
 *
 * In each list of a kind that is on, the first server fails: the browser closes its socket, and the Node bots also
 * have a name that does not exist and an address that does not answer in front of the defaults. A kind that is off
 * gets no socket: the browser closes each of its sockets, and the Node bots get `none`.
 */

const LIVE = process.env.E2E_LIVE === "1";
const BOARD_MS = 30 * 60_000;
const MAX_BOARDS = 3;
const STALL_MS = 10 * 60_000;
type Kind = "tracker" | "nostr" | "mqtt";

const DEFAULTS: Readonly<Record<Kind, readonly string[]>> = {
	tracker: DEFAULT_TRACKER_URLS,
	nostr: DEFAULT_NOSTR_RELAY_URLS,
	mqtt: DEFAULT_MQTT_BROKER_URLS,
};

const VARIABLE: Readonly<Record<Kind, string>> = {
	tracker: "VITE_TRACKER_URLS",
	nostr: "VITE_NOSTR_RELAY_URLS",
	mqtt: "VITE_MQTT_BROKER_URLS",
};

/** The Network panel line of each kind. */
const LABEL: Readonly<Record<Kind, string>> = {
	tracker: "Trackers reachable",
	nostr: "Nostr relays reachable",
	mqtt: "MQTT brokers reachable",
};

const KINDS: readonly Kind[] = ["tracker", "nostr", "mqtt"];

/** A name that does not exist (RFC 6761) and an address that does not answer (RFC 5737). */
const badUrls = (kind: Kind): string[] => [
	`wss://no-such-${kind}.invalid/`,
	`wss://192.0.2.1:8443/${kind}`,
];

const SEATS = [
	{ seat: "N", name: "cli north" },
	{ seat: "E", name: "cli east" },
	{ seat: "S", name: "cli south" },
] as const;

const MODES: readonly {
	readonly name: string;
	readonly on: readonly Kind[];
}[] = [
	{ name: "MQTT brokers alone", on: ["mqtt"] },
	{ name: "Nostr relays alone", on: ["nostr"] },
	{ name: "trackers alone", on: ["tracker"] },
	{ name: "all three kinds", on: KINDS },
];

/** The sockets that the browser closes: each of a kind that is off, and the first server of a kind that is on. */
async function closeSockets(
	context: BrowserContext,
	on: readonly Kind[],
): Promise<void> {
	const closed = new Set(
		KINDS.flatMap((kind) =>
			on.includes(kind)
				? (DEFAULTS[kind].slice(0, 1) as string[])
				: [...DEFAULTS[kind]],
		).map((url) => new URL(url).host),
	);
	await context.routeWebSocket(
		(url) => closed.has(url.host),
		(socket) => socket.close({ code: 1011, reason: "closed by the test" }),
	);
}

function botEnvironment(on: readonly Kind[]): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env };
	for (const kind of KINDS)
		env[VARIABLE[kind]] = on.includes(kind)
			? [...badUrls(kind), ...DEFAULTS[kind]].join(",")
			: "none";
	return env;
}

/** Starts one Node bot; its output goes to a file of the test, with the key removed. */
function startBot(
	link: string,
	name: string,
	env: NodeJS.ProcessEnv,
	logPath: string,
): ChildProcess {
	const child = spawn(
		process.execPath,
		["--import", "tsx", "src/bot/cli.ts", link, "--user", name],
		{ env, stdio: ["ignore", "pipe", "pipe"] },
	);
	const log = createWriteStream(logPath);
	const write = (chunk: Buffer) => log.write(chunk);
	child.stdout?.on("data", write);
	child.stderr?.on("data", write);
	child.on("exit", (code, signal) => {
		log.end(`\n[exit ${code ?? signal}]\n`);
	});
	return child;
}

async function stopBot(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return;
	const exited = new Promise((resolve) => child.once("exit", resolve));
	child.kill("SIGTERM");
	const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
	await exited;
	clearTimeout(timer);
}

interface Snapshot {
	readonly board: number;
	readonly phase: string;
	readonly at: number;
}

/** Records each change of the table's board, phase and action count, so the test misses no step between polls. */
function recordTable(): void {
	const log: Snapshot[] = [];
	(window as unknown as { lbTable: Snapshot[] }).lbTable = log;
	const take = () => {
		const table = document.querySelector<HTMLElement>("[data-phase]");
		if (!table) return;
		const snapshot = {
			board: Number(table.dataset.board),
			phase: table.dataset.phase ?? "",
			at: Number(table.dataset.at),
		};
		const last = log.at(-1);
		if (
			last?.board !== snapshot.board ||
			last.phase !== snapshot.phase ||
			last.at !== snapshot.at
		)
			log.push(snapshot);
	};
	new MutationObserver(take).observe(document, {
		subtree: true,
		childList: true,
		attributes: true,
		attributeFilter: ["data-phase", "data-board", "data-at"],
	});
}

interface FullBoard {
	readonly board: number;
	readonly calls: number;
	readonly cards: number;
}

/**
 * The first board that the page saw from its first call to its end with 13 tricks: the action count when the play
 * starts is the number of calls, and 52 more actions are the cards. A board that is passed out or claimed is skipped.
 */
function fullBoard(log: readonly Snapshot[]): FullBoard | undefined {
	for (const { board } of log.filter((entry) => entry.phase === "complete")) {
		const own = log.filter((entry) => entry.board === board);
		if (own[0]?.at !== 0) continue;
		const play = own.find((entry) => entry.phase === "play");
		const end = own.find((entry) => entry.phase === "complete");
		if (play && end && end.at - play.at === 52)
			return { board, calls: play.at, cards: end.at - play.at };
	}
	return undefined;
}

/** The table and the status lines of the page, for the log and for a failure. */
function tableState() {
	const text = (id: string) =>
		document.querySelector(`[data-testid="${id}"]`)?.textContent?.trim() ?? "";
	const table = document.querySelector<HTMLElement>("[data-phase]");
	return {
		log: (window as unknown as { lbTable: Snapshot[] }).lbTable,
		state: {
			board: Number(table?.dataset.board),
			phase: table?.dataset.phase ?? "",
			at: Number(table?.dataset.at),
			prompt: text("table-prompt"),
			bots: text("bot-status"),
		},
	};
}

/**
 * Waits for a full board. The table log gets each change and one line each minute. The wait fails when the table
 * does not change for STALL_MS, when MAX_BOARDS boards end without a full one, or at the deadline.
 */
async function waitForFullBoard(
	page: Page,
	tableLog: WriteStream,
	deadline: number,
): Promise<FullBoard> {
	let shown = "";
	let step = "";
	let changed = Date.now();
	let logged = 0;
	for (;;) {
		const { log, state } = await page.evaluate(tableState);
		const line = JSON.stringify(state);
		const now = Date.now();
		if (line !== shown || now - logged >= 60_000) {
			tableLog.write(`${new Date(now).toISOString()} ${line}\n`);
			shown = line;
			logged = now;
		}
		const at = `${state.board} ${state.phase} ${state.at}`;
		if (at !== step) {
			step = at;
			changed = now;
		}
		const result = fullBoard(log);
		if (result) return result;
		const ended = new Set(
			log.filter((entry) => entry.phase === "complete").map((e) => e.board),
		).size;
		if (ended >= MAX_BOARDS)
			throw new Error(`${ended} boards ended without 13 tricks: ${line}`);
		if (now - changed > STALL_MS)
			throw new Error(
				`the table did not change for ${STALL_MS / 60_000} minutes: ${line}`,
			);
		if (now > deadline) throw new Error(`no full board in time: ${line}`);
		await page.waitForTimeout(5_000);
	}
}

/** Local bidding is shared by the host and the three independent Node bots. */
const SETUP_QUERY = new URLSearchParams({
	host: "west",
	bot_seats: "",
	bot_bidder: "sl",
}).toString();

// Room invitation keys remain private.
test.use({ screenshot: "off", trace: "off", video: "off" });

const networkValue = (page: Page, label: string) =>
	page
		.getByTestId("network")
		.locator("dt", { hasText: label })
		.locator("xpath=following-sibling::dd[1]");

test.describe("four robots play a full board through the public relays", () => {
	test.skip(!LIVE, "set E2E_LIVE=1 (npm run test:e2e:live)");

	for (const mode of MODES)
		test(mode.name, async ({ browser }, testInfo) => {
			test.setTimeout(MAX_BOARDS * BOARD_MS);
			const context = await browser.newContext();
			const bots: ChildProcess[] = [];
			let tableLog: WriteStream | undefined;
			try {
				await closeSockets(context, mode.on);
				await context.addInitScript(recordTable);
				const page = await context.newPage();
				const pageLog = createWriteStream(testInfo.outputPath("page.log"));
				page.on("console", (message) =>
					pageLog.write(
						`${new Date().toISOString()} ${message.type()} ${message.text()}\n`,
					),
				);
				tableLog = createWriteStream(testInfo.outputPath("table.log"));
				const deadline = Date.now() + MAX_BOARDS * BOARD_MS - 5 * 60_000;
				await page.goto(`/?${SETUP_QUERY}`);
				await page.locator('input[name="name-W"]').fill("host west");
				for (const { seat, name } of SEATS)
					await page.locator(`input[name="name-${seat}"]`).fill(name);
				await page.getByTestId("create").click();
				await expect(page.getByTestId("room-controls")).toBeVisible({
					timeout: 60_000,
				});
				const autoplay = page.getByTestId("host-autoplay-toggle");
				await autoplay.click();
				await expect(autoplay).toHaveText("👱 Disable autoplay");

				const link = new URL(page.url());
				link.searchParams.delete("selected_player");
				const env = botEnvironment(mode.on);
				for (const { seat, name } of SEATS)
					bots.push(
						startBot(
							link.toString(),
							name,
							env,
							testInfo.outputPath(`bot-${seat}.log`),
						),
					);

				await expect(networkValue(page, "Direct connections")).toHaveText("3", {
					timeout: 120_000,
				});
				for (const kind of KINDS) {
					const value = networkValue(page, LABEL[kind]);
					if (mode.on.includes(kind))
						await expect(value).not.toHaveText(/^0 of/);
					else await expect(value).toHaveText(/^0 of/);
				}

				const result = await waitForFullBoard(page, tableLog, deadline);
				expect(result.cards, "the cards of the board").toBe(52);
				expect(result.calls).toBeGreaterThanOrEqual(4);
				for (const bot of bots)
					expect(bot.exitCode, "a bot stopped during the board").toBeNull();
				testInfo.annotations.push({
					type: "board",
					description: JSON.stringify(result),
				});
			} finally {
				tableLog?.end();
				await Promise.all(bots.map(stopBot));
				await context.close();
			}
		});
});

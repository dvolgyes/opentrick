import { expect, type Page, test } from "@playwright/test";
import { loadEnv } from "vite";
import { readMeshConfig } from "../../src/p2p/config";
import { RelayHub } from "./relay-hub";
import { CONNECT_MS, createRoom, hostRows, makeCall, pick } from "./room";

/** A deterministic bidder that records the policy requested by this page. */
async function recordPolicies(page: Page): Promise<string[]> {
	const policies: string[] = [];
	await page.route("**/__test_shared_policy__", async (route) => {
		const body = route.request().postDataJSON() as { policy: string };
		policies.push(body.policy);
		await route.fulfill({ json: { call: "P" } });
	});
	await page.route(/\/bid-worker-[^/]+\.js$/, (route) =>
		route.fulfill({
			contentType: "text/javascript",
			body: `self.onmessage = async ({data}) => {
				const response = await fetch(new URL("/__test_shared_policy__", self.location.origin), {
					method: "POST", body: JSON.stringify({policy: data.policy})
				});
				const {call} = await response.json();
				self.postMessage({ok: true, analysis: {call, policy: data.policy, candidates: []}});
			};`,
		}),
	);
	return policies;
}

test("the selected bot engine follows the table across guests, reload and host handover", async ({
	browser,
	baseURL,
}) => {
	test.setTimeout(180_000);
	if (!baseURL) throw new Error("missing base URL");
	const parsed = readMeshConfig(
		loadEnv("production", process.cwd(), [
			"VITE_TRACKER_",
			"VITE_NOSTR_",
			"VITE_MQTT_",
			"VITE_STUN_",
		]),
	);
	if (!parsed.ok) throw new Error(parsed.error);
	const hubs = [
		new RelayHub("tracker", parsed.config.trackers),
		new RelayHub("nostr", parsed.config.nostrRelays),
		new RelayHub("mqtt", parsed.config.mqttBrokers),
	];
	const contexts = await Promise.all(
		[0, 1, 2].map(() => browser.newContext({ baseURL, locale: "en" })),
	);
	const pages: Page[] = [];
	try {
		for (const [index, context] of contexts.entries()) {
			for (const hub of hubs) await hub.install(context, String(index));
			await context.addInitScript(() => {
				if (localStorage.getItem("opentrick.settings.bidder") === null)
					localStorage.setItem("opentrick.settings.bidder", "sl");
			});
			const page = await context.newPage();
			await page.addLocatorHandler(page.getByTestId("call-invite"), () =>
				page
					.getByTestId("call-invite")
					.getByRole("button", { name: "Don't join", exact: true })
					.click(),
			);
			pages.push(page);
		}
		const [host, guest, witness] = pages;
		if (!host || !guest || !witness) throw new Error("missing browser pages");
		await recordPolicies(host);
		const policies = await recordPolicies(guest);
		await recordPolicies(witness);
		await host.goto("/");
		const link = await createRoom(host, ["S"]);
		await guest.goto(link);
		await pick(guest, "N");
		await witness.goto(link);
		await pick(witness, "E");
		await expect(guest.getByTestId("table")).toHaveAttribute(
			"data-phase",
			"auction",
			{ timeout: CONNECT_MS },
		);
		await expect.poll(() => policies).toContain("sl");
		await host.getByRole("button", { name: "Settings", exact: true }).click();
		const hostSettings = host.getByTestId("settings-dialog");
		await hostSettings.getByLabel("BRL RL/FSP", { exact: true }).check();
		await hostSettings.getByRole("button", { name: "Save settings" }).click();
		await expect(host.getByTestId("bot-status")).toContainText("rl-fsp");
		await expect.poll(() => policies).toContain("rl-fsp");
		await guest.getByRole("button", { name: "Settings", exact: true }).click();
		await expect(
			guest
				.getByTestId("settings-dialog")
				.getByLabel("BRL RL/FSP", { exact: true }),
		).toBeChecked();
		await guest
			.getByTestId("settings-dialog")
			.getByRole("button", { name: "Cancel", exact: true })
			.click();
		const auction = guest.locator(".auction:visible");
		await expect(
			auction
				.locator("th")
				.filter({ hasText: "(N)" })
				.locator(".auction-system"),
		).toHaveText("corr. HCP");
		await makeCall(guest, "1NT");
		const first = auction
			.locator("tbody tr")
			.first()
			.locator("td")
			.nth(0)
			.locator("button.auction-call");
		await expect(first).toHaveAttribute(
			"title",
			"15–17 corrected HCP, balanced",
		);
		await guest.getByRole("button", { name: "Settings", exact: true }).click();
		await guest
			.getByTestId("settings-dialog")
			.getByLabel("Milton/HCP (4-3-2-1)", { exact: true })
			.check();
		await guest
			.getByTestId("settings-dialog")
			.getByRole("button", { name: "Save settings" })
			.click();
		await expect(
			auction
				.locator("th")
				.filter({ hasText: "(N)" })
				.locator(".auction-system"),
		).toHaveText("HCP");
		await expect(first).toHaveAttribute(
			"title",
			"15–17 corrected HCP, balanced",
		);
		await makeCall(witness, "P");
		const botCall = auction
			.locator("tbody tr")
			.first()
			.locator("td")
			.nth(2)
			.locator("button.auction-call");
		await expect(botCall).toHaveAttribute(
			"aria-description",
			/Guide reference \(HCP\):.*may not describe the bid/,
			{ timeout: CONNECT_MS },
		);
		await guest.reload();
		await expect(guest.getByTestId("table")).toHaveAttribute(
			"data-phase",
			"auction",
			{ timeout: CONNECT_MS },
		);
		await guest.getByRole("button", { name: "Settings", exact: true }).click();
		await expect(
			guest
				.getByTestId("settings-dialog")
				.getByLabel("BRL RL/FSP", { exact: true }),
		).toBeChecked();
		await guest
			.getByTestId("settings-dialog")
			.getByRole("button", { name: "Cancel", exact: true })
			.click();
		await contexts[0]?.close();
		await expect
			.poll(
				async () =>
					hostRows(guest)
						.getAttribute("data-seat")
						.catch(() => ""),
				{ timeout: 120_000 },
			)
			.toMatch(/^[NE]$/);
		const newHostSeat = await hostRows(guest).getAttribute("data-seat");
		const newHost = newHostSeat === "N" ? guest : witness;
		await expect(newHost.getByTestId("bot-status")).toContainText("rl-fsp", {
			timeout: CONNECT_MS,
		});
	} finally {
		await Promise.all(contexts.map((context) => context.close()));
	}
});

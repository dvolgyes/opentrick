import { expect, type Page, test } from "@playwright/test";
import { mockBotBidding } from "./bot-mock";
import { createRoom, makeCall } from "./room";

async function settings(page: Page) {
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	return page.getByTestId("settings-dialog");
}

test("all four timing controls validate, save, and survive reload", async ({
	page,
}) => {
	// Check the production default, not the shorter search budget used by other E2E cases.
	await page.addInitScript(() => {
		if (sessionStorage.getItem("timing-default-checked") !== "1")
			localStorage.removeItem("opentrick.settings.play-time-ms");
	});
	await page.goto("/");
	await createRoom(page);
	let dialog = await settings(page);
	await expect(dialog.getByLabel("Minimum card time (seconds)")).toHaveValue(
		"1",
	);
	await expect(dialog.getByLabel("Minimum bid time (seconds)")).toHaveValue(
		"3",
	);
	await expect(dialog.getByLabel("Pause after auction (seconds)")).toHaveValue(
		"3",
	);
	await expect(dialog.getByLabel("Card thinking budget (seconds)")).toHaveValue(
		"5",
	);
	await dialog.getByLabel("Minimum card time (seconds)").fill("0.5");
	await dialog.getByRole("button", { name: "Save settings" }).click();
	await expect(dialog).toBeVisible();
	expect(
		await dialog
			.getByLabel("Minimum card time (seconds)")
			.evaluate((input) => (input as HTMLInputElement).validity.rangeUnderflow),
	).toBe(true);
	await dialog.getByLabel("Minimum card time (seconds)").fill("1.5");
	await dialog.getByLabel("Minimum bid time (seconds)").fill("4");
	await dialog.getByLabel("Pause after auction (seconds)").fill("5");
	await dialog.getByLabel("Card thinking budget (seconds)").fill("7");
	await dialog.getByRole("button", { name: "Save settings" }).click();
	await expect(dialog).toBeHidden();
	await page.evaluate(() =>
		sessionStorage.setItem("timing-default-checked", "1"),
	);
	await page.reload();
	dialog = await settings(page);
	await expect(dialog.getByLabel("Minimum card time (seconds)")).toHaveValue(
		"1.5",
	);
	await expect(dialog.getByLabel("Minimum bid time (seconds)")).toHaveValue(
		"4",
	);
	await expect(dialog.getByLabel("Pause after auction (seconds)")).toHaveValue(
		"5",
	);
	await expect(dialog.getByLabel("Card thinking budget (seconds)")).toHaveValue(
		"7",
	);
});

interface Moment {
	at: number;
	phase: string;
	ms: number;
}

test("fast bots honor configured bid, card and final-auction delays and pass the edited budget to the worker", async ({
	page,
}) => {
	await page.addInitScript(() => {
		const moments: Moment[] = [];
		Object.defineProperty(window, "__botMoments", { value: moments });
		new MutationObserver(() => {
			const table = document.querySelector<HTMLElement>(
				'[data-testid="table"]',
			);
			if (table?.dataset.board !== "1") return;
			const at = Number(table.dataset.at);
			const phase = table.dataset.phase ?? "";
			if (moments.at(-1)?.at === at && moments.at(-1)?.phase === phase) return;
			moments.push({ at, phase, ms: performance.now() });
		}).observe(document, { subtree: true, childList: true, attributes: true });
	});
	await mockBotBidding(
		page,
		(position) => (position.calls.length === 0 ? "1NT" : "P"),
		0,
	);
	const budgets: number[] = [];
	let playWorkerRequests = 0;
	await page.route("**/__test_play__", async (route) => {
		const request = route.request().postDataJSON() as {
			timeMs: number;
			position: { legal: string[] };
		};
		budgets.push(request.timeMs);
		await route.fulfill({ json: { card: request.position.legal[0] } });
	});
	await page.route(/\/play-worker-[^/]+\.js$/, (route) => {
		playWorkerRequests++;
		return route.fulfill({
			contentType: "text/javascript",
			body: `self.onmessage = async ({data}) => {
		const response = await fetch(new URL("/__test_play__", self.location.href), { method: "POST", body: JSON.stringify(data) });
		const {card} = await response.json();
		const analysis = {card, samples: 1, effectiveSamples: 1, elapsedMs: 0, evaluations: []};
		self.postMessage({ok: true, partial: true, analysis});
		setTimeout(() => self.postMessage({ok: true, analysis}), data.timeMs + 100);
	};`,
		});
	});
	await page.goto("/");
	await createRoom(page, ["N", "E", "S"]);
	const dialog = await settings(page);
	await dialog.getByLabel("Minimum card time (seconds)").fill("1.25");
	await dialog.getByLabel("Minimum bid time (seconds)").fill("3.25");
	await dialog.getByLabel("Pause after auction (seconds)").fill("3.5");
	await dialog.getByLabel("Card thinking budget (seconds)").fill("1.4");
	await dialog.getByRole("button", { name: "Save settings" }).click();
	const table = page.getByTestId("table");
	await expect(table).toHaveAttribute("data-at", "3");
	await makeCall(page, "P");
	await expect(table).toHaveAttribute("data-at", "4");
	await expect(table).toHaveAttribute("data-phase", "auction");
	await expect(page.getByTestId("table-prompt")).toHaveText(
		/Play starts in \d seconds\./,
	);
	await expect(table.locator("button.card:enabled")).toHaveCount(0);
	await expect(table).toHaveAttribute("data-at", "6");
	const moments = await page.evaluate(
		() => (window as unknown as { __botMoments: Moment[] }).__botMoments,
	);
	const at = (step: number) => {
		const moment = moments.find((entry) => entry.at === step);
		if (!moment) throw new Error(`missing step ${step}`);
		return moment.ms;
	};
	// Rendering can lag the commit slightly. Unit checks enforce the exact deadline; these check visible pacing.
	for (const step of [1, 2, 3])
		expect(at(step) - at(step - 1)).toBeGreaterThanOrEqual(3200);
	expect(at(5) - at(4)).toBeGreaterThanOrEqual(3450);
	expect(at(6) - at(5)).toBeGreaterThanOrEqual(1200);
	expect(budgets).toEqual([1400, 1400]);
	expect(playWorkerRequests).toBe(1);
});

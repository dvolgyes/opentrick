import { describe, expect, it, vi } from "vitest";
import { BrowserOpenRouterStrategy } from "../../src/bot/browser-openrouter";
import { NODE_PROMPT_TEMPLATES } from "../../src/bot/node-prompts";
import {
	actionPositionKey,
	matchesActionPosition,
} from "../../src/bot/position";
import {
	BOT_FALLBACK_MODEL,
	chooseWithSchemaRetry,
	decisionFormat,
	decisionOutputTokenLimit,
	parseDecision,
	preferredReasoningEffort,
	reasoningSettings,
	renderBidPrompt,
	renderPlayPrompt,
	responseText,
} from "../../src/bot/strategy";
import { createBoard, legalActions } from "../../src/bridge/engine";
import { bidding, DEAL, playing } from "./bridge-fixtures";

describe("bot decisions", () => {
	it("recognizes the board position carried by a pending action key", () => {
		const board = createBoard(1, DEAL);
		const key = actionPositionKey(board);
		expect(matchesActionPosition(board, key)).toBe(true);
		expect(matchesActionPosition(board, `${key}:stale`)).toBe(false);
	});

	it("accepts only one action from the engine's legal set", () => {
		const board = createBoard(1, DEAL);
		const legal = legalActions(board, board.dealer);
		const choice = legal.find((action) => action.type === "call");
		expect(choice?.type).toBe("call");
		if (choice?.type !== "call") throw new Error("test needs a call");
		expect(
			parseDecision(JSON.stringify({ call: choice.call }), "call", legal),
		).toEqual(choice);
		expect(() =>
			parseDecision(JSON.stringify({ call: "0S" }), "call", legal),
		).toThrow("not legal");
		expect(() =>
			parseDecision(
				JSON.stringify({ call: choice.call, extra: true }),
				"call",
				legal,
			),
		).toThrow("only call");
	});

	it("extracts only assistant JSON text from an OpenResponses result", () => {
		expect(
			responseText({
				output: [
					{ type: "reasoning", summary: "ignored" },
					{
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: '{"call":"P"}' }],
					},
				],
			}),
		).toBe('{"call":"P"}');
	});

	it("trims surrounding whitespace from the key sent to OpenRouter", async () => {
		const board = createBoard(1, DEAL);
		const legal = legalActions(board, board.dealer);
		const choice = legal.find((action) => action.type === "call");
		if (choice?.type !== "call") throw new Error("test needs a legal call");
		let authorization: string | null = null;
		vi.stubGlobal("window", {
			setTimeout: globalThis.setTimeout,
			clearTimeout: globalThis.clearTimeout,
		});
		vi.stubGlobal(
			"fetch",
			async (_input: string | URL | Request, init?: RequestInit) => {
				authorization = new Headers(init?.headers).get("Authorization");
				return new Response(
					JSON.stringify({
						output: [
							{
								type: "message",
								role: "assistant",
								content: [
									{
										type: "output_text",
										text: JSON.stringify({ call: choice.call }),
									},
								],
							},
						],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			},
		);
		try {
			const strategy = new BrowserOpenRouterStrategy(
				"  test-api-key \n",
				{
					model: BOT_FALLBACK_MODEL,
					fallbackModel: BOT_FALLBACK_MODEL,
					modelOrder: [BOT_FALLBACK_MODEL],
					retries: 0,
					retryDelayMs: 0,
				},
				new AbortController().signal,
			);
			await strategy.choose("call", "prompt", legal);
			expect(authorization).toBe("Bearer test-api-key");
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("reports a reasoning-only response so the strategy can retry", () => {
		expect(() => responseText({ output: [{ type: "reasoning" }] })).toThrow(
			"response items: reasoning",
		);
	});

	it("retries reasoning-only output up to three times with reasoning disabled", async () => {
		const board = createBoard(1, DEAL);
		const legal = legalActions(board, board.dealer);
		const firstLegalCall = legal.find((action) => action.type === "call");
		if (firstLegalCall?.type !== "call")
			throw new Error("test needs a legal call");
		const efforts: string[] = [];
		const decision = await chooseWithSchemaRetry(
			async (effort) => {
				efforts.push(effort);
				return efforts.length < 4
					? { output: [{ type: "reasoning" }] }
					: {
							output: [
								{
									type: "message",
									role: "assistant",
									content: [
										{
											type: "output_text",
											text: JSON.stringify({ call: firstLegalCall.call }),
										},
									],
								},
							],
						};
			},
			"call",
			legal,
		);
		expect(efforts).toEqual(["low", "none", "none", "none"]);
		expect(decision).toEqual(firstLegalCall);
	});

	it("starts Mercury-3 without reasoning and keeps its output budget compact", async () => {
		const board = createBoard(1, DEAL);
		const legal = legalActions(board, board.dealer);
		const firstLegalCall = legal.find((action) => action.type === "call");
		if (firstLegalCall?.type !== "call")
			throw new Error("test needs a legal call");
		const efforts: string[] = [];
		await chooseWithSchemaRetry(
			async (effort) => {
				efforts.push(effort);
				return {
					output: [
						{
							type: "message",
							role: "assistant",
							content: [
								{
									type: "output_text",
									text: JSON.stringify({ call: firstLegalCall.call }),
								},
							],
						},
					],
				};
			},
			"call",
			legal,
			preferredReasoningEffort("inception/mercury-3"),
		);
		expect(efforts).toEqual(["none"]);
		expect(decisionOutputTokenLimit("inception/mercury-3")).toBe(4096);
		expect(reasoningSettings("inception/mercury-3", "none")).toEqual({
			enabled: false,
		});
		expect(preferredReasoningEffort("openai/gpt-6-luna")).toBe("low");
		expect(decisionOutputTokenLimit("openai/gpt-6-luna")).toBe(512);
		expect(reasoningSettings("openai/gpt-6-luna", "low")).toEqual({
			effort: "low",
		});
	});

	it("stops after three retries when no decision text is returned", async () => {
		const board = createBoard(1, DEAL);
		const legal = legalActions(board, board.dealer);
		const efforts: string[] = [];
		await expect(
			chooseWithSchemaRetry(
				async (effort) => {
					efforts.push(effort);
					return { output: [{ type: "reasoning" }] };
				},
				"call",
				legal,
			),
		).rejects.toThrow("response items: reasoning");
		expect(efforts).toEqual(["low", "none", "none", "none"]);
	});

	it("forces a strict schema containing only legal choices", () => {
		const board = createBoard(1, DEAL);
		const legal = legalActions(board, board.dealer);
		const format = decisionFormat("call", legal);
		expect(format.type).toBe("json_schema");
		expect(format.strict).toBe(true);
		expect(format.schema.properties.call?.enum).toEqual(
			legal
				.filter((action) => action.type === "call")
				.map((action) => action.call),
		);
		expect(format.schema.additionalProperties).toBe(false);
	});

	it("renders bidding state with its hand, auction, and legal choices", () => {
		const board = createBoard(1, DEAL);
		const legal = legalActions(board, board.dealer);
		const prompt = renderBidPrompt(
			board,
			board.dealer,
			legal,
			NODE_PROMPT_TEMPLATES,
			{},
		);
		expect(prompt).toContain("Standard American Yellow Card");
		expect(prompt).toContain("Legal bids:");
		expect(prompt).toContain("ordinary mistakes in bidding and play");
		expect(prompt).toContain("do not overthink unlikely lines");
		expect(prompt).toContain("♠");
		expect(prompt).not.toContain("♠ 765  ♥ JT987  ♦ QJT  ♣ KQ");
	});

	it("gives the bidder the high-card points of its own hand", () => {
		const board = createBoard(1, DEAL);
		const east = renderBidPrompt(
			board,
			"E",
			legalActions(board, board.dealer),
			NODE_PROMPT_TEMPLATES,
			{},
		);
		const west = renderBidPrompt(
			board,
			"W",
			legalActions(board, board.dealer),
			NODE_PROMPT_TEMPLATES,
			{},
		);
		expect(east).toContain("Your high-card points: 9");
		expect(west).toContain("Your high-card points: 0");
	});

	it("gives the SAYC summary in the bidding prompt and only names SAYC in play", () => {
		const summary = NODE_PROMPT_TEMPLATES.sayc.trim();
		const auction = createBoard(1, DEAL);
		const bid = renderBidPrompt(
			auction,
			auction.dealer,
			legalActions(auction, auction.dealer),
			NODE_PROMPT_TEMPLATES,
			{},
		);
		const board = bidding(createBoard(1, DEAL), "1S P 4S P P P");
		const play = renderPlayPrompt(
			board,
			"E",
			legalActions(board, "E"),
			NODE_PROMPT_TEMPLATES,
		);
		expect(summary).toContain("Jacoby");
		expect(bid).toContain(summary);
		const order = [
			"You are an expert contract bridge player",
			summary,
			"Your hand:",
			"Your high-card points:",
			"Board:",
			"Vulnerability:",
			"Auction:",
			"Legal bids:",
		].map((text) => bid.indexOf(text));
		expect(order).toEqual(order.toSorted((a, b) => a - b));
		expect(order).not.toContain(-1);
		expect(play).toContain("Standard American Yellow Card");
		expect(play).not.toContain("Jacoby");
	});

	it("decodes each earlier call by its caller's system and lists the bot's own guide calls", () => {
		const board = bidding(createBoard(1, DEAL), "2C P");
		const legal = legalActions(board, "S");
		const prompt = renderBidPrompt(board, "S", legal, NODE_PROMPT_TEMPLATES, {
			N: "vienna",
			E: "hcp",
		});
		expect(prompt).toContain("### WHAT THE CALLS MEAN");
		expect(prompt).toContain(
			[
				"North - Vienna bidding: 2♣ -> 35+ Vienna points, artificial and forcing",
				"East - HCP bidding: Pass -> not described by the guide",
				"Your bids according to HCP likely could be 2♦ (0–7 HCP, waiting).",
			].join("\n"),
		);
		const unknown = renderBidPrompt(board, "S", legal, NODE_PROMPT_TEMPLATES, {
			N: "other",
		});
		expect(unknown).toContain("North - other system: 2♣ -> meaning unknown");
		expect(unknown).toContain("East - unknown system: Pass -> meaning unknown");

		// North opens with 30 HCP, unbalanced: only 2♣. After the answer the guide has only a balanced 22–24 [2NT] rebid.
		const opening = createBoard(1, DEAL);
		expect(
			renderBidPrompt(
				opening,
				"N",
				legalActions(opening, "N"),
				NODE_PROMPT_TEMPLATES,
				{},
			),
		).toContain(
			"No calls yet.\nYour bids according to HCP likely could be 2♣ (22+ HCP, artificial and forcing).",
		);
		const rebid = bidding(createBoard(1, DEAL), "2C P 2D P");
		expect(
			renderBidPrompt(
				rebid,
				"N",
				legalActions(rebid, "N"),
				NODE_PROMPT_TEMPLATES,
				{},
			),
		).toContain("The guide has no suggestion here; use SAYC.");
	});

	it("gives the same bid prompt whatever the other hands hold", () => {
		const board = bidding(createBoard(1, DEAL), "2C P");
		const swapped = {
			...board,
			deal: {
				...board.deal,
				N: board.deal.W,
				E: board.deal.N,
				W: board.deal.E,
			},
		} satisfies typeof board;
		const legal = legalActions(board, "S");
		const systems = { N: "vienna", E: "hcp" } as const;
		expect(
			renderBidPrompt(swapped, "S", legal, NODE_PROMPT_TEMPLATES, systems),
		).toBe(renderBidPrompt(board, "S", legal, NODE_PROMPT_TEMPLATES, systems));
	});

	it("shows only the player's hand and dummy during play", () => {
		const board = bidding(createBoard(1, DEAL), "1S P 4S P P P");
		const legal = legalActions(board, "E");
		const prompt = renderPlayPrompt(board, "E", legal, NODE_PROMPT_TEMPLATES);
		expect(prompt).toContain("Your hand (East):");
		expect(prompt).toContain("Dummy (South):");
		expect(prompt).toContain("ordinary mistakes in bidding and play");
		expect(prompt).toContain("do not overthink unlikely lines");
		expect(prompt).not.toContain("♠ AKQJT98  ♥ AKQ  ♦ K  ♣ A");
		expect(prompt).not.toContain("♠ —  ♥ 32  ♦ 5432  ♣ 8765432");
	});

	it("summarizes the auction and the tricks in short lines, and counts the hidden cards", () => {
		// North declares 4♠, East leads. West shows out of spades in trick 2, and North leads ♠K to trick 3.
		const board = playing(
			bidding(createBoard(1, DEAL), "1S P 4S P P P"),
			"HJ H4 H3 HA SA S7 S2 D2 SK",
		);
		const prompt = renderPlayPrompt(
			board,
			"E",
			legalActions(board, "E"),
			NODE_PROMPT_TEMPLATES,
		);
		expect(prompt).toContain("Auction: N 1♠ · E P · S 4♠ · all pass");
		expect(prompt).toContain(
			"T1 E♥J S♥4 W♥3 N♥A → N\nT2 N♠A E♠7 S♠2 W♦2 → N\nT3 N♠K (in progress)",
		);
		// East sees 8 spades, 10 hearts, 8 diamonds and 5 clubs; West has no spade, so North holds the other 5.
		expect(prompt).toContain("### CARD COUNT");
		expect(prompt).toContain(
			[
				"Unaccounted (North+West): ♠ QJT98 (5) · ♥ KQ2 (3) · ♦ AK543 (5) · ♣ A8765432 (8)",
				"North: 10 left; ♠ 5, ♣ 0–5; holds ♠QJT98",
				"West: 11 left; void ♠ (T2); ♣ 3–8",
			].join("\n"),
		);
		expect(prompt).not.toContain("Trick 1:");

		// Before the opening lead nothing limits the three hidden hands, so their lines give only the count.
		const lead = bidding(createBoard(1, DEAL), "1S P 4S P P P");
		const first = renderPlayPrompt(
			lead,
			"E",
			legalActions(lead, "E"),
			NODE_PROMPT_TEMPLATES,
		);
		expect(first).toContain("T1: E leads");
		expect(first).toContain(
			"(North+South+West): ♠ AKQJT98432 (10) · ♥ AKQ65432 (8) · ♦ AK98765432 (10) · ♣ AJT98765432 (11)\nNorth: 13 left\nSouth: 13 left\nWest: 13 left\n",
		);
	});

	it("gives the same play prompt whatever the hidden hands hold", () => {
		const board = playing(
			bidding(createBoard(1, DEAL), "1S P 4S P P P"),
			"HJ H4 H3 HA SA S7 S2 D2 SK",
		);
		// North and West both still hold diamonds: swap one, keeping every played card legal.
		const swapped = {
			...board,
			deal: {
				...board.deal,
				N: board.deal.N.map((card) => (card === "DA" ? "D5" : card)),
				W: board.deal.W.map((card) => (card === "D5" ? "DA" : card)),
			},
		} satisfies typeof board;
		const legal = legalActions(board, "E");
		expect(renderPlayPrompt(swapped, "E", legal, NODE_PROMPT_TEMPLATES)).toBe(
			renderPlayPrompt(board, "E", legal, NODE_PROMPT_TEMPLATES),
		);
	});
});

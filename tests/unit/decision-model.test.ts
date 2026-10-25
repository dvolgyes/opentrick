import { describe, expect, it } from "vitest";
import {
	decisionsRequestBody,
	parseDecisionsResponse,
} from "../../src/bot/decision-model";
import { NODE_PROMPT_TEMPLATES } from "../../src/bot/node-prompts";
import { decisionState } from "../../src/bot/strategy";
import {
	applyAction,
	boardStatus,
	createBoard,
	legalActions,
} from "../../src/bridge/engine";
import { botModelType, DECISION_BOT_MODELS } from "../../src/protocol";
import { bidding, DEAL, playing } from "./bridge-fixtures";

describe("OpenRouter decision models", () => {
	it("looks up decision API type by model ID", () => {
		for (const model of DECISION_BOT_MODELS)
			expect(botModelType(model)).toBe("decisions");
		expect(botModelType("typesafe/jev-1.14")).toBe("decisions");
		expect(botModelType("inception/mercury-3")).toBe("responses");
	});

	it("builds one bounded choice from the engine legal actions", () => {
		const board = createBoard(1, DEAL);
		const legal = legalActions(board, board.dealer);
		const state = decisionState(
			board,
			board.dealer,
			"call",
			NODE_PROMPT_TEMPLATES,
			{},
		);
		const request = decisionsRequestBody(
			DECISION_BOT_MODELS[0],
			"call",
			state,
			legal,
		) as {
			questions: Record<
				string,
				{ type: string; criteria: Record<string, string> }
			>;
		};
		const question = request.questions.bridge_action;
		if (!question) throw new Error("test request needs its choice question");
		expect(question.type).toBe("choice");
		expect(Object.keys(question.criteria)).toEqual(
			legal.map((action) =>
				action.type === "call" ? action.call : action.card,
			),
		);
		expect(JSON.stringify(state)).not.toContain("H3");
	});

	it("sends the SAYC summary when bidding and only names SAYC in play", () => {
		const summary = NODE_PROMPT_TEMPLATES.sayc.trim();
		const auction = createBoard(1, DEAL);
		const bid = JSON.stringify(
			decisionsRequestBody(
				DECISION_BOT_MODELS[0],
				"call",
				decisionState(
					auction,
					auction.dealer,
					"call",
					NODE_PROMPT_TEMPLATES,
					{},
				),
				legalActions(auction, auction.dealer),
			),
		);
		const board = bidding(createBoard(1, DEAL), "1S P 4S P P P");
		const play = JSON.stringify(
			decisionsRequestBody(
				DECISION_BOT_MODELS[0],
				"play",
				decisionState(board, "E", "play", NODE_PROMPT_TEMPLATES, {}),
				legalActions(board, "E"),
			),
		);
		expect(summary).toContain("Jacoby");
		expect(bid).toContain(JSON.stringify(summary));
		expect(play).toContain("Standard American Yellow Card");
		expect(play).not.toContain("Jacoby");
	});

	it("lists the bidding state as system, own hand and points, then the board", () => {
		const board = createBoard(1, DEAL);
		const state = decisionState(board, "E", "call", NODE_PROMPT_TEMPLATES, {});
		expect(Object.keys(state).slice(0, 4)).toEqual([
			"bidding_system",
			"hand",
			"high_card_points",
			"suit_shape_longest_first",
		]);
		expect(state.high_card_points).toBe(9);
	});

	it("gives each earlier call the meaning of its caller's system, and the bot's own guide calls", () => {
		const board = bidding(createBoard(1, DEAL), "2C P");
		const state = decisionState(board, "S", "call", NODE_PROMPT_TEMPLATES, {
			N: "vienna",
			E: "hcp",
		});
		expect(state.auction).toEqual([
			{
				seat: "N",
				call: "2♣",
				system: "vienna",
				meaning: "35+ Vienna points, artificial and forcing",
			},
			{ seat: "E", call: "Pass", system: "hcp", meaning: null },
		]);
		expect(state.guide_system).toBe("hcp");
		expect(state.guide_calls).toEqual([
			{ call: "2♦", meaning: "0–7 HCP, waiting" },
		]);
		// After the first response the guide is silent.
		expect(
			decisionState(
				bidding(createBoard(1, DEAL), "2C P 2D P"),
				"N",
				"call",
				NODE_PROMPT_TEMPLATES,
				{},
			).guide_calls,
		).toBe(null);
	});

	it("accepts a typed choice only when it matches a legal action", () => {
		const board = createBoard(1, DEAL);
		const legal = legalActions(board, board.dealer);
		const chosen = legal[0];
		if (chosen?.type !== "call")
			throw new Error("test needs a legal opening call");
		expect(
			parseDecisionsResponse(
				{
					answers: {
						bridge_action: { type: "choice", choice: chosen.call },
					},
				},
				legal,
			),
		).toEqual(chosen);
		expect(() =>
			parseDecisionsResponse(
				{
					answers: {
						bridge_action: { type: "noul", choice: chosen.call },
					},
				},
				legal,
			),
		).toThrow("invalid choice answer");
		expect(() =>
			parseDecisionsResponse(
				{
					answers: {
						bridge_action: { type: "choice", choice: "0S" },
					},
				},
				legal,
			),
		).toThrow("not legal");
	});

	it("includes play state only for the acting hand and visible dummy", () => {
		let board = bidding(createBoard(1, DEAL), "1NT P P P");
		const leader = "E";
		expect(
			decisionState(board, leader, "play", NODE_PROMPT_TEMPLATES, {})
				.dummy_hand,
		).toBe(null);
		const openingLead = legalActions(board, leader)[0];
		if (openingLead?.type !== "play")
			throw new Error("test needs a legal opening lead");
		const result = applyAction(board, leader, openingLead);
		if (!result.ok) throw new Error("test opening lead was rejected");
		board = result.board;
		const actor = boardStatus(board).actor;
		if (actor === undefined) throw new Error("test needs a play actor");
		const state = decisionState(
			board,
			actor,
			"play",
			NODE_PROMPT_TEMPLATES,
			{},
		);
		const serialized = JSON.stringify(state);
		expect(serialized).toContain('"dummy_hand":');
		expect(serialized).not.toContain("H3");
	});

	it("gives the play state the card count of the hidden hands", () => {
		// West shows out of spades in trick 2, so North holds the five spades that East cannot see.
		const board = playing(
			bidding(createBoard(1, DEAL), "1S P 4S P P P"),
			"HJ H4 H3 HA SA S7 S2 D2 SK",
		);
		expect(
			decisionState(board, "E", "play", NODE_PROMPT_TEMPLATES, {})
				.card_knowledge,
		).toMatchObject({
			unaccounted: { S: "QJT98", H: "KQ2", D: "AK543", C: "A8765432" },
			hands: [
				{
					seat: "N",
					remaining: 10,
					voids: [],
					lengths: { S: { min: 5, max: 5 }, C: { min: 0, max: 5 } },
					known: ["♠Q", "♠J", "♠10", "♠9", "♠8"],
				},
				{ seat: "W", remaining: 11, voids: [{ suit: "S", trick: 2 }] },
			],
		});
	});
});

import {
	type CardKnowledge,
	cardKnowledge,
	visiblePlay,
} from "../bridge/card-knowledge";
import {
	type Card,
	rankOf,
	SUIT_SYMBOLS,
	SUITS,
	suitOf,
} from "../bridge/cards";
import type { PointRange } from "../bridge/convention-rules";
import {
	type CallMeaning,
	callMeaning,
	conventionCalls,
	hasRules,
	type Shape,
} from "../bridge/conventions";
import {
	type Action,
	type Board,
	boardStatus,
	type CompletedTrick,
} from "../bridge/engine";
import type { PointSystem } from "../bridge/hand-points";
import type { Call, Contract } from "../bridge/rules";
import { BOT_SYSTEM } from "../game/bridge";
import { SEAT_NAMES, type Seat, seatAfter } from "../protocol";

export const BOT_MODEL = "openai/gpt-6-luna";
export const BOT_FALLBACK_MODEL = "inception/mercury-3";

export type ReasoningEffort = "low" | "medium" | "none";

export function preferredReasoningEffort(model: string): ReasoningEffort {
	if (model.toLowerCase().startsWith("~openai/gpt-sol-latest")) return "medium";
	return model.toLowerCase().startsWith("inception/mercury-3") ? "none" : "low";
}

export function decisionOutputTokenLimit(model: string): number {
	if (model.toLowerCase().startsWith("~openai/gpt-sol-latest")) return 16_384;
	return model.toLowerCase().startsWith("inception/mercury-3") ? 4096 : 512;
}

export function reasoningSettings(
	model: string,
	effort: ReasoningEffort,
):
	| { readonly enabled: false }
	| { readonly effort: "low" | "medium" | "none" } {
	const normalizedModel = model.toLowerCase();
	if (normalizedModel.startsWith("inception/mercury-3"))
		return { enabled: false };
	return {
		effort: normalizedModel.startsWith("~openai/gpt-sol-latest")
			? "medium"
			: effort,
	};
}

export interface PromptTemplates {
	readonly bidding: string;
	readonly play: string;
	/** The SAYC summary that every bot gets when it bids, whatever its model type. */
	readonly sayc: string;
}

export type Decision =
	| { readonly type: "call"; readonly call: string }
	| { readonly type: "play"; readonly card: Card };

export type BridgeDecisionState = Record<string, unknown>;

class MissingDecisionTextError extends Error {
	constructor(shape: readonly string[]) {
		super(
			`OpenRouter returned no usable decision text (response items: ${shape.join("; ") || "none"})`,
		);
		this.name = "MissingDecisionTextError";
	}
}

const VULNERABILITY: Readonly<Record<Board["vulnerability"], string>> = {
	none: "None",
	NS: "North-South vulnerable",
	EW: "East-West vulnerable",
	both: "Both vulnerable",
};

function renderTemplate(
	template: string,
	values: Readonly<Record<string, string>>,
): string {
	const rendered = template.replace(
		/\{\{([A-Z_]+)\}\}/g,
		(_placeholder, key: string) => {
			const value = values[key];
			if (value === undefined)
				throw new Error(`missing prompt template value: ${key}`);
			return value;
		},
	);
	if (/\{\{[A-Z_]+\}\}/.test(rendered))
		throw new Error("prompt template contains an unknown placeholder");
	return rendered;
}

function handText(cards: readonly Card[]): string {
	return SUITS.map((suit) => {
		const ranks = cards
			.filter((card) => suitOf(card) === suit)
			.map(rankOf)
			.join("");
		return `${SUIT_SYMBOLS[suit]} ${ranks || "—"}`;
	}).join("  ");
}

/** Milton Work points: A 4, K 3, Q 2, J 1. */
function highCardPoints(cards: readonly Card[]): number {
	return cards.reduce((points, card) => {
		const rank = rankOf(card);
		return (
			points +
			(rank === "A"
				? 4
				: rank === "K"
					? 3
					: rank === "Q"
						? 2
						: rank === "J"
							? 1
							: 0)
		);
	}, 0);
}

function callLabel(call: Call): string {
	if (call === "P") return "Pass";
	if (call === "X") return "Double";
	if (call === "XX") return "Redouble";
	return `${call[0]}${call.slice(1) === "NT" ? "NT" : SUIT_SYMBOLS[call.slice(1) as keyof typeof SUIT_SYMBOLS]}`;
}

/** The English names of the point scales, for the prompt only; the players see translated names. */
const SCALE_NAMES: Readonly<Record<PointSystem, string>> = {
	hcp: "HCP",
	"hcp-corrected": "corrected HCP",
	vienna: "Vienna points",
	reith: "Reith points",
	"four-aces": "Four Aces points",
	other: "points",
};

const SYSTEM_NAMES: Readonly<Record<PointSystem, string>> = {
	hcp: "HCP bidding",
	"hcp-corrected": "corrected HCP bidding",
	vienna: "Vienna bidding",
	reith: "Reith bidding",
	"four-aces": "Four Aces bidding",
	other: "other system",
};

/** Half points as in the guides: 7.5 is "7½". */
function pointsText(points: number): string {
	return Number.isInteger(points) ? String(points) : `${Math.floor(points)}½`;
}

function rangeText(range: PointRange, system: PointSystem): string {
	const points =
		range.max === undefined
			? `${pointsText(range.min)}+`
			: `${pointsText(range.min)}–${pointsText(range.max)}`;
	return `${points} ${SCALE_NAMES[system]}`;
}

function shapeText(shape: Shape, system: PointSystem): string {
	switch (shape.kind) {
		case "none":
			return "";
		case "balanced":
			return "balanced";
		case "artificial":
			return "artificial and forcing";
		case "cards":
			return `${shape.min}+ ${SUIT_SYMBOLS[shape.suit]}`;
		case "support":
			return `${shape.min}+ ${SUIT_SYMBOLS[shape.suit]} support`;
		case "weak-two":
			return `weak two, a good ${shape.length}-card ${SUIT_SYMBOLS[shape.suit]} suit`;
		case "preempt":
			return `preempt, a good ${shape.length}-card ${SUIT_SYMBOLS[shape.suit]} suit`;
		case "transfer":
			return `transfer, ${shape.min}+ ${SUIT_SYMBOLS[shape.suit]}`;
		case "stayman":
			return `Stayman, a ${shape.min}-card major`;
		case "weak-minor":
			return `weak, a ${shape.min}+ card minor`;
		case "game-try":
			return `game try, invites game, ${shape.min}+ ${SUIT_SYMBOLS[shape.suit]}`;
		case "competitive":
			return `competitive, no game invitation, ${shape.min}+ ${SUIT_SYMBOLS[shape.suit]}`;
		case "waiting":
			return "waiting";
		case "rest":
			return "no other guide call fits";
		case "good-suit":
			return `a good ${shape.min}+ card ${SUIT_SYMBOLS[shape.suit]} suit`;
		case "no-major":
			return `no ${shape.min}-card major`;
		case "accept":
			return `completes the transfer to ${SUIT_SYMBOLS[shape.suit]}`;
		case "relay":
			return "forced, any hand";
		case "ask":
			return "asks opener to describe the hand";
		case "stopper":
			return `balanced, a ${SUIT_SYMBOLS[shape.suit]} stopper`;
		case "takeout":
			return `takeout, short in ${SUIT_SYMBOLS[shape.suit]}, or ${rangeText(shape.strong, system)}`;
		case "blackwood":
			return `Blackwood, asks for aces: a small slam needs about ${rangeText(shape.small, system)} together, a grand slam about ${rangeText(shape.grand, system)}`;
		case "aces":
			return `aces: ${shape.counts.join("/")}`;
	}
}

/** For example "15–17 HCP, balanced". */
function meaningText(meaning: CallMeaning, system: PointSystem): string {
	return [
		meaning.range === undefined ? "" : rangeText(meaning.range, system),
		shapeText(meaning.shape, system),
	]
		.filter((text) => text !== "")
		.join(", ");
}

/** The guide meaning of each call in the auction, by the system of its caller; null when the guide does not say. */
function auctionMeanings(
	board: Board,
	systems: Partial<Record<Seat, PointSystem>>,
): {
	seat: Seat;
	call: string;
	system: PointSystem | null;
	meaning: string | null;
}[] {
	return board.calls.map((call, index) => {
		const seat = seatAfter(board.dealer, index);
		const system = systems[seat];
		const meaning =
			system === undefined
				? undefined
				: callMeaning(system, board.calls, index);
		return {
			seat,
			call: callLabel(call),
			system: system ?? null,
			meaning:
				system === undefined || meaning === undefined
					? null
					: meaningText(meaning, system),
		};
	});
}

/** For example "East - HCP bidding: 1NT -> 15–17 HCP, balanced", one line for each call. */
function auctionMeaningsText(
	board: Board,
	systems: Partial<Record<Seat, PointSystem>>,
): string {
	if (board.calls.length === 0) return "No calls yet.";
	return auctionMeanings(board, systems)
		.map(({ seat, call, system, meaning }) => {
			const caller = SEAT_NAMES[seat];
			if (system === null || !hasRules(system))
				return `${caller} - ${system === null ? "unknown system" : SYSTEM_NAMES[system]}: ${call} -> meaning unknown`;
			return `${caller} - ${SYSTEM_NAMES[system]}: ${call} -> ${meaning ?? "not described by the guide"}`;
		})
		.join("\n");
}

function guideCalls(
	board: Board,
	seat: Seat,
): { call: string; meaning: string }[] | null {
	const calls = conventionCalls(BOT_SYSTEM, board.deal[seat], board.calls);
	return calls === undefined || calls.length === 0
		? null
		: calls.map((guide) => ({
				call: callLabel(guide.call),
				meaning: meaningText(guide.meaning, BOT_SYSTEM),
			}));
}

/** For example "Your bids according to HCP likely could be 1NT (15–17 HCP, balanced) or Pass (0–11 HCP)." */
function guideCallsText(board: Board, seat: Seat): string {
	const calls = guideCalls(board, seat);
	if (calls === null) return "The guide has no suggestion here; use SAYC.";
	const options = calls.map(({ call, meaning }) =>
		meaning === "" ? call : `${call} (${meaning})`,
	);
	const list =
		options.length > 1
			? `${options.slice(0, -1).join(", ")} or ${options.at(-1)}`
			: (options[0] ?? "");
	return `Your bids according to ${SCALE_NAMES[BOT_SYSTEM]} likely could be ${list}.`;
}

function contractLabel(contract: Contract): string {
	const strain =
		contract.strain === "NT" ? "NT" : SUIT_SYMBOLS[contract.strain];
	return `${contract.level}${strain}${contract.doubling}`;
}

function cardLabel(card: Card): string {
	const rank = rankOf(card) === "T" ? "10" : rankOf(card);
	return `${SUIT_SYMBOLS[suitOf(card)]}${rank}`;
}

function callsText(board: Board): string {
	if (board.calls.length === 0) return "No calls yet";
	return board.calls
		.map((call, index) => {
			const seat = seatAfter(board.dealer, index);
			return `${SEAT_NAMES[seat]}: ${callLabel(call)}`;
		})
		.join(" · ");
}

/** The auction in one line of seat letters, for example "N 1♠ · E P · S 4♠ · all pass". */
function shortCallsText(board: Board): string {
	const last = board.calls.findLastIndex((call) => call !== "P");
	const calls = board.calls.map(
		(call, index) =>
			`${seatAfter(board.dealer, index)} ${call === "P" || call === "X" || call === "XX" ? call : callLabel(call)}`,
	);
	if (last === -1) return calls.length ? "all pass" : "No calls yet";
	return [
		...calls.slice(0, last + 1),
		...(last < calls.length - 1 ? ["all pass"] : []),
	].join(" · ");
}

/** One trick per line, for example "T1 W♦K E♦2 N♦A S♦3 → N"; the last line is the current trick. */
function shortTricksText(
	tricks: readonly CompletedTrick[],
	current: Pick<CompletedTrick, "leader" | "cards">,
): string {
	const plays = (trick: Pick<CompletedTrick, "leader" | "cards">) =>
		trick.cards
			.map(
				(card, index) => `${seatAfter(trick.leader, index)}${cardLabel(card)}`,
			)
			.join(" ");
	const number = tricks.length + 1;
	return [
		...tricks.map(
			(trick, index) => `T${index + 1} ${plays(trick)} → ${trick.winner}`,
		),
		current.cards.length
			? `T${number} ${plays(current)} (in progress)`
			: `T${number}: ${current.leader} leads`,
	].join("\n");
}

function playKnowledge(board: Board, seat: Seat): CardKnowledge {
	const view = visiblePlay(board, seat);
	if (view === undefined) throw new Error("the board is not in play");
	return cardKnowledge(view);
}

function suitRanks(cards: readonly Card[]): string {
	return cards.map(rankOf).join("");
}

/** The card count for the play prompt: the unaccounted cards, then one line for each hidden hand. */
function cardKnowledgeText(knowledge: CardKnowledge): string {
	const hidden = knowledge.hidden.map((hand) => SEAT_NAMES[hand.seat]);
	const unaccounted = SUITS.map((suit) => {
		const cards = knowledge.unaccounted[suit];
		return `${SUIT_SYMBOLS[suit]} ${cards.length ? `${suitRanks(cards)} (${cards.length})` : "none"}`;
	}).join(" · ");
	const hands = knowledge.hidden.map((hand) => {
		const voids = hand.voids.map(
			(known) => `void ${SUIT_SYMBOLS[known.suit]} (T${known.trick})`,
		);
		// Only the ranges that the count limits: 0 to the unaccounted cards of the suit says nothing.
		const lengths = SUITS.filter((suit) => {
			const { min, max } = hand.lengths[suit];
			const open = Math.min(knowledge.unaccounted[suit].length, hand.remaining);
			return (
				!hand.voids.some((known) => known.suit === suit) &&
				(min > 0 || max < open)
			);
		}).map((suit) => {
			const { min, max } = hand.lengths[suit];
			return `${SUIT_SYMBOLS[suit]} ${min === max ? min : `${min}–${max}`}`;
		});
		const holds = SUITS.map((suit) => {
			const cards = hand.known.filter((card) => suitOf(card) === suit);
			return cards.length ? `${SUIT_SYMBOLS[suit]}${suitRanks(cards)}` : "";
		}).filter(Boolean);
		return [
			`${SEAT_NAMES[hand.seat]}: ${hand.remaining} left`,
			...(voids.length ? [voids.join(", ")] : []),
			...(lengths.length ? [lengths.join(", ")] : []),
			...(holds.length ? [`holds ${holds.join(" ")}`] : []),
		].join("; ");
	});
	return [`Unaccounted (${hidden.join("+")}): ${unaccounted}`, ...hands].join(
		"\n",
	);
}

function legalChoices(actions: readonly Action[]): string[] {
	return actions.map((action) =>
		action.type === "call" ? action.call : action.card,
	);
}

export function decisionFormat(
	kind: "call" | "play",
	legal: readonly Action[],
) {
	const field = kind === "call" ? "call" : "card";
	return {
		type: "json_schema" as const,
		name: `bridge_${kind}`,
		strict: true,
		schema: {
			type: "object",
			properties: {
				[field]: {
					type: "string",
					enum: legalChoices(legal),
				},
			},
			required: [field],
			additionalProperties: false,
		},
	};
}

export function renderBidPrompt(
	board: Board,
	seat: Seat,
	legal: readonly Action[],
	templates: PromptTemplates,
	systems: Partial<Record<Seat, PointSystem>>,
): string {
	return renderTemplate(templates.bidding, {
		BOARD: String(board.number),
		DEALER: `${SEAT_NAMES[board.dealer]} (${board.dealer})`,
		SEAT: `${SEAT_NAMES[seat]} (${seat})`,
		VULNERABILITY: VULNERABILITY[board.vulnerability],
		HAND: handText(board.deal[seat]),
		HCP: String(highCardPoints(board.deal[seat])),
		SAYC_SUMMARY: templates.sayc.trim(),
		AUCTION: callsText(board),
		LEGAL_BIDS: legalChoices(legal).join(", "),
		AUCTION_MEANINGS: auctionMeaningsText(board, systems),
		YOUR_GUIDE_CALLS: guideCallsText(board, seat),
	});
}

export function renderPlayPrompt(
	board: Board,
	seat: Seat,
	legal: readonly Action[],
	templates: PromptTemplates,
): string {
	const status = boardStatus(board);
	if (status.phase !== "play") throw new Error("the board is not in play");
	const dummy = status.dummy;
	const dummyExposed = board.cards.length > 0;
	const knownHands = [
		`Your hand (${SEAT_NAMES[seat]}): ${handText(status.remaining[seat])}`,
		...(dummy === undefined
			? []
			: [
					dummyExposed
						? `Dummy (${SEAT_NAMES[dummy]}): ${handText(status.remaining[dummy])}`
						: `Dummy (${SEAT_NAMES[dummy]}): not exposed yet`,
				]),
	];
	const contract = status.contract;
	return renderTemplate(templates.play, {
		BOARD: String(board.number),
		VULNERABILITY: VULNERABILITY[board.vulnerability],
		AUCTION: shortCallsText(board),
		CONTRACT: contractLabel(contract),
		DECLARER: `${SEAT_NAMES[contract.declarer]} (${contract.declarer})`,
		DUMMY: dummy === undefined ? "unknown" : `${SEAT_NAMES[dummy]} (${dummy})`,
		KNOWN_HANDS: knownHands.join("\n"),
		TRICKS: shortTricksText(status.tricks, status.current),
		CARD_KNOWLEDGE: cardKnowledgeText(playKnowledge(board, seat)),
		SEAT: `${SEAT_NAMES[seat]} (${seat})`,
		TRICKS_NS: String(status.tricksNS),
		TRICKS_EW: String(status.tricksEW),
		LEGAL_CARDS: legalChoices(legal).join(", "),
	});
}

/** Builds only the board facts that this player is allowed to know. */
export function decisionState(
	board: Board,
	seat: Seat,
	kind: "call" | "play",
	templates: PromptTemplates,
	systems: Partial<Record<Seat, PointSystem>>,
): BridgeDecisionState {
	const auction = board.calls.map((call, index) => ({
		seat: seatAfter(board.dealer, index),
		call: callLabel(call),
	}));
	if (kind === "call") {
		const hand = board.deal[seat];
		const shape = SUITS.map(
			(suit) => hand.filter((card) => suitOf(card) === suit).length,
		).toSorted((a, b) => b - a);
		// The same order as the bidding prompt: the system, the bidder's own hand and points, then the board.
		return {
			bidding_system: {
				name: "Standard American Yellow Card",
				summary: templates.sayc.trim(),
			},
			hand: Object.fromEntries(
				SUITS.map((suit) => [
					suit,
					hand
						.filter((card) => suitOf(card) === suit)
						.map(rankOf)
						.join(""),
				]),
			),
			high_card_points: highCardPoints(hand),
			suit_shape_longest_first: shape,
			board: board.number,
			dealer: board.dealer,
			vulnerability: board.vulnerability,
			seat,
			auction: auctionMeanings(board, systems),
			guide_system: BOT_SYSTEM,
			guide_calls: guideCalls(board, seat),
		};
	}

	const status = boardStatus(board);
	if (status.phase !== "play") throw new Error("the board is not in play");
	const contract = status.contract;
	const dummy = status.dummy;
	const dummyVisible = board.cards.length > 0;
	const knowledge = playKnowledge(board, seat);
	const trickPlays = (trick: Pick<CompletedTrick, "leader" | "cards">) =>
		trick.cards.map((card, index) => ({
			seat: seatAfter(trick.leader, index),
			card: cardLabel(card),
		}));
	return {
		board: board.number,
		vulnerability: board.vulnerability,
		seat,
		contract: {
			level: contract.level,
			strain: contract.strain,
			doubling: contract.doubling,
			declarer: contract.declarer,
		},
		dummy,
		hand: status.remaining[seat].map(cardLabel),
		dummy_hand:
			dummy === undefined || !dummyVisible
				? null
				: status.remaining[dummy].map(cardLabel),
		auction,
		completed_tricks: status.tricks.map((trick) => ({
			plays: trickPlays(trick),
			winner: trick.winner,
		})),
		current_trick: {
			leader: status.current.leader,
			plays: trickPlays(status.current),
		},
		tricks_won: { NS: status.tricksNS, EW: status.tricksEW },
		card_knowledge: {
			unaccounted: Object.fromEntries(
				SUITS.map((suit) => [suit, suitRanks(knowledge.unaccounted[suit])]),
			),
			hands: knowledge.hidden.map((hand) => ({
				seat: hand.seat,
				remaining: hand.remaining,
				voids: hand.voids,
				lengths: hand.lengths,
				known: hand.known.map(cardLabel),
			})),
		},
	};
}

export function decisionActionValue(action: Action): string {
	return action.type === "call" ? action.call : action.card;
}

export function decisionActionLabel(action: Action): string {
	return action.type === "call"
		? callLabel(action.call)
		: `Play ${cardLabel(action.card)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads assistant text from the OpenResponses response without logging model reasoning or request content. */
export function responseText(response: unknown): string {
	if (!isRecord(response) || !Array.isArray(response.output))
		throw new Error("OpenRouter returned an invalid response");
	const parts: string[] = [];
	const shape: string[] = [];
	for (const item of response.output) {
		if (!isRecord(item)) {
			shape.push("unknown-item");
			continue;
		}
		if (!Array.isArray(item.content)) {
			shape.push(String(item.type ?? "unknown-item"));
			continue;
		}
		shape.push(
			`${String(item.type ?? "unknown-item")}[${item.content
				.map((content) =>
					isRecord(content)
						? String(content.type ?? "unknown-content")
						: "unknown-content",
				)
				.join(",")}]`,
		);
		if (item.type !== "message" || item.role !== "assistant") continue;
		for (const content of item.content) {
			if (
				isRecord(content) &&
				content.type === "output_text" &&
				typeof content.text === "string"
			)
				parts.push(content.text);
		}
	}
	const text = parts.join("").trim();
	if (text.length === 0 || text.length > 512)
		throw new MissingDecisionTextError(shape);
	return text;
}

/** Accept only a single JSON field whose value is one of the locally computed legal actions. */
export function parseDecision(
	text: string,
	kind: "call" | "play",
	legal: readonly Action[],
): Decision {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error("OpenRouter returned invalid JSON");
	}
	if (!isRecord(parsed))
		throw new Error("OpenRouter decision must be an object");
	const field = kind === "call" ? "call" : "card";
	if (Object.keys(parsed).length !== 1 || typeof parsed[field] !== "string")
		throw new Error(`OpenRouter decision must contain only ${field}`);
	const value = parsed[field];
	const candidate = legal.find(
		(action) =>
			(kind === "call" && action.type === "call" && action.call === value) ||
			(kind === "play" && action.type === "play" && action.card === value),
	);
	if (!candidate)
		throw new Error("OpenRouter chose an action that is not legal now");
	return candidate.type === "call"
		? { type: "call", call: candidate.call }
		: { type: "play", card: candidate.card };
}

export async function chooseWithSchemaRetry(
	request: (effort: ReasoningEffort) => Promise<unknown>,
	kind: "call" | "play",
	legal: readonly Action[],
	preferredEffort: ReasoningEffort = "low",
): Promise<Decision> {
	for (let attempt = 0; attempt < 4; attempt++) {
		try {
			const effort = attempt === 0 ? preferredEffort : "none";
			return parseDecision(responseText(await request(effort)), kind, legal);
		} catch (error) {
			if (!(error instanceof MissingDecisionTextError) || attempt === 3)
				throw error;
		}
	}
	throw new Error("OpenRouter decision attempts were exhausted");
}

export function randomDecision(legal: readonly Action[]): Decision {
	if (legal.length === 0) throw new Error("no legal actions were provided");
	const index = Math.floor(Math.random() * legal.length);
	const action = legal[index];
	if (!action) throw new Error("could not select a legal action");
	return action.type === "call"
		? { type: "call", call: action.call }
		: { type: "play", card: action.card };
}

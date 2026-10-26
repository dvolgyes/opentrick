import { type VisiblePlay, visiblePlay } from "../bridge/card-knowledge";
import type { Card } from "../bridge/cards";
import { type CallMeaning, callMeaning } from "../bridge/conventions";
import {
	type Board,
	boardStatus,
	type CurrentTrick,
	legalActions,
} from "../bridge/engine";
import type { PointSystem } from "../bridge/hand-points";
import type { Contract, Vulnerability } from "../bridge/rules";
import { type Seat, seatAfter } from "../protocol";

/** The complete search input, deliberately without the board or any hidden hand. */
export interface PlayPosition {
	readonly view: VisiblePlay;
	readonly turn: Seat;
	readonly current: CurrentTrick;
	readonly contract: Contract;
	readonly vulnerability: Vulnerability;
	readonly declarerTricks: number;
	readonly legal: readonly Card[];
	readonly hints: readonly {
		readonly seat: Seat;
		readonly meaning: CallMeaning;
		readonly system: PointSystem;
	}[];
}

export function playPosition(
	board: Board,
	seat: Seat,
	systems: Partial<Record<Seat, PointSystem>> = {},
): PlayPosition {
	const status = boardStatus(board);
	if (status.phase !== "play" || status.actor !== seat)
		throw new Error("card engine requires the acting player's turn");
	const view = visiblePlay(board, seat);
	if (!view) throw new Error("card engine requires a visible play position");
	const hints: PlayPosition["hints"][number][] = [];
	for (let index = 0; index < board.calls.length; index++) {
		const caller = seatAfter(board.dealer, index);
		const system = systems[caller];
		const meaning =
			system === undefined
				? undefined
				: callMeaning(system, board.calls, index);
		if (meaning && system) hints.push({ seat: caller, meaning, system });
	}
	return {
		view,
		turn: status.turn,
		current: status.current,
		contract: status.contract,
		vulnerability: board.vulnerability,
		declarerTricks:
			status.contract.declarer === "N" || status.contract.declarer === "S"
				? status.tricksNS
				: status.tricksEW,
		legal: legalActions(board, seat).flatMap((action) =>
			action.type === "play" ? [action.card] : [],
		),
		hints,
	};
}

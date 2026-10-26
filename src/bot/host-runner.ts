import { type Action, legalActions } from "../bridge/engine";
import {
	actionPayload,
	type BridgeState,
	claimVotePayload,
	parseBridgeState,
	resetVotePayload,
	seatSystems,
	undoVotePayload,
} from "../game/bridge";
import type { TableController } from "../p2p/table";
import {
	type JsonObject,
	type RoomConfig,
	SEATS,
	type Seat,
} from "../protocol";
import type { LocalBidder } from "./bid-network";
import { bidPosition } from "./bid-position";
import { type BidChooser, BrowserBidder } from "./browser-bidder";
import { BrowserPlayEngine, type PlayChooser } from "./browser-play";
import { BotRequestAbortedError } from "./errors";
import { playTimeMs } from "./play-budget";
import { playPosition } from "./play-position";
import { actionPositionKey } from "./position";

export interface HostBotSettings {
	readonly bidder: LocalBidder;
	readonly playTimeMs?: number;
}

export function configuredBotSeats(config: RoomConfig): Seat[] {
	return SEATS.filter((seat) => config.botSetup?.seats.includes(seat) === true);
}

/** Runs host-managed bot decisions in the page that currently owns the host. */
export class HostBotRunner {
	readonly #controller: TableController;
	#settings: HostBotSettings;
	readonly #onError: () => void;
	readonly #playEngine: PlayChooser;
	readonly #bidEngine: BidChooser;
	#requestAbort = new AbortController();
	readonly #processed = new Set<string>();
	#unsubscribe: (() => void) | undefined;
	#running = false;
	#rerun = false;
	#stopped = false;
	#paused = false;
	readonly #seatOverrides = new Map<Seat, boolean>();

	constructor(
		controller: TableController,
		settings: HostBotSettings,
		onError: () => void = () => {},
		playEngine: PlayChooser = new BrowserPlayEngine(),
		bidEngine: BidChooser = new BrowserBidder(),
	) {
		this.#controller = controller;
		this.#settings = {
			...settings,
			playTimeMs: playTimeMs(settings.playTimeMs),
		};
		this.#onError = onError;
		this.#playEngine = playEngine;
		this.#bidEngine = bidEngine;
	}

	async start(requiredSeats: readonly Seat[] = []): Promise<boolean> {
		const view = this.#controller.view();
		const config = view.table?.config;
		if (!view.hosting || !view.ready || !config) return false;
		for (const seat of requiredSeats) this.#seatOverrides.set(seat, true);
		const seats = this.#activeSeats(
			view.roster?.bots ?? configuredBotSeats(config),
		).filter((seat) => seat !== view.seat && !requiredSeats.includes(seat));
		if (!(await this.#controller.activateBots(seats))) return false;
		this.#unsubscribe = this.#controller.onChange(() => this.#schedule());
		this.#schedule();
		return true;
	}

	stop(): void {
		if (this.#stopped) return;
		this.#stopped = true;
		this.#requestAbort.abort();
		this.#playEngine.stop();
		this.#bidEngine.stop();
		this.#unsubscribe?.();
	}

	pause(): void {
		this.#paused = true;
		this.#requestAbort.abort();
	}

	resume(): void {
		if (this.#stopped || !this.#paused) return;
		this.#paused = false;
		this.#requestAbort = new AbortController();
		this.#schedule();
	}

	updateSettings(settings: HostBotSettings): void {
		const budget = playTimeMs(settings.playTimeMs);
		if (settings.bidder !== this.#settings.bidder) this.#bidEngine.stop();
		if (budget !== this.#settings.playTimeMs) this.#playEngine.stop();
		this.#settings = { ...settings, playTimeMs: budget };
		this.#schedule();
	}

	setSeatEnabled(seat: Seat, enabled: boolean): void {
		this.#seatOverrides.set(seat, enabled);
		this.#schedule();
	}

	#activeSeats(seats: readonly Seat[]): Seat[] {
		const active = new Set(seats);
		for (const [seat, enabled] of this.#seatOverrides) {
			if (enabled) active.add(seat);
			else active.delete(seat);
		}
		return [...active];
	}

	#schedule(): void {
		if (this.#stopped || this.#paused) return;
		if (this.#running) {
			this.#rerun = true;
			return;
		}
		void this.#drive();
	}

	async #drive(): Promise<void> {
		this.#running = true;
		try {
			do {
				this.#rerun = false;
				await this.#step();
			} while (this.#rerun && !this.#stopped && !this.#paused);
		} catch (error) {
			// Engine failures stop affected bots; the room remains playable and the host can retry.
			if (this.#stopped) return;
			if (error instanceof BotRequestAbortedError) {
				this.#rerun = true;
				return;
			}
			this.stop();
			this.#onError();
		} finally {
			this.#running = false;
			if (this.#rerun && !this.#stopped && !this.#paused) this.#schedule();
		}
	}

	async #step(): Promise<void> {
		const view = this.#controller.view();
		if (
			this.#stopped ||
			this.#paused ||
			!view.hosting ||
			!view.ready ||
			!view.table
		)
			return;
		const config = view.table.config;
		const bots = view.roster?.bots ?? configuredBotSeats(config);
		const seats = this.#activeSeats(bots);
		const state = parseBridgeState(view.table.state, this.#controller.tableId);
		if (!state) return;
		const systems = seatSystems(state.systems, bots, "other");
		for (const seat of seats) {
			const voteKey =
				state.claim?.required.includes(seat) &&
				!state.claim.approved.includes(seat)
					? `claim:${state.claim.id}:${seat}`
					: state.undo?.required.includes(seat) &&
							!state.undo.approved.includes(seat)
						? `undo:${state.undo.id}:${seat}`
						: state.reset?.required.includes(seat) &&
								!state.reset.approved.includes(seat)
							? `reset:${state.reset.id}:${seat}`
							: undefined;
			if (voteKey && !this.#processed.has(voteKey)) {
				this.#processed.add(voteKey);
				// A bot rejects every claim, so the board is played out, and accepts every undo and reset, so that
				// only the human players decide them.
				const payload = state.claim
					? claimVotePayload(this.#controller.tableId, state.claim.id, false)
					: state.undo
						? undoVotePayload(this.#controller.tableId, state.undo.id, true)
						: resetVotePayload(
								this.#controller.tableId,
								state.reset?.id ?? "",
								true,
							);
				await this.#send(seat, payload, view.seat);
				return;
			}
		}
		if (state.claim || state.undo || state.reset || !state.board) return;
		for (const seat of seats) {
			// legalActions assigns dummy's turn to declarer, so only declarer can choose a dummy card.
			const actions = legalActions(state.board, seat);
			if (actions.length === 0) continue;
			const key = `${state.board.number}:${actionPositionKey(state.board)}:${seat}`;
			if (this.#processed.has(key)) continue;
			this.#processed.add(key);
			const kind = actions[0]?.type;
			if (!kind) return;
			let decision: Action;
			try {
				if (kind === "play") {
					const analysis = await this.#playEngine.choose(
						playPosition(state.board, seat, systems),
						this.#requestAbort.signal,
						this.#settings.playTimeMs,
					);
					decision = { type: "play", card: analysis.card };
				} else {
					const analysis = await this.#bidEngine.choose(
						bidPosition(state.board, seat),
						this.#settings.bidder,
						this.#requestAbort.signal,
					);
					decision = { type: "call", call: analysis.call };
				}
			} catch (error) {
				this.#processed.delete(key);
				throw error;
			}
			if (this.#stopped || this.#paused || this.#requestAbort.signal.aborted) {
				this.#processed.delete(key);
				return;
			}
			const current = this.#controller.view();
			const currentBots = current.roster?.bots ?? configuredBotSeats(config);
			if (!this.#activeSeats(currentBots).includes(seat)) {
				this.#processed.delete(key);
				return;
			}
			const currentState = current.table
				? parseBridgeState(current.table.state, this.#controller.tableId)
				: undefined;
			if (
				!currentState?.board ||
				actionPositionKey(currentState.board) !== actionPositionKey(state.board)
			)
				return;
			const action = actions.find((item) =>
				decision.type === "call"
					? item.type === "call" && item.call === decision.call
					: item.type === "play" && item.card === decision.card,
			);
			if (!action) return;
			// A player can ask for an undo, a claim or a reset while the bot waits for its model, and the host then
			// refuses the bot's action. The bot answers that request first and then chooses again at this position.
			const held =
				requestWaiting(currentState) ||
				!(
					await this.#deliver(
						seat,
						actionPayload(this.#controller.tableId, state.board, action),
						view.seat,
					)
				).ok;
			if (held) {
				if (!requestWaiting(this.#currentState()))
					throw new Error("host rejected local bot action");
				this.#processed.delete(key);
			}
			this.#rerun = true;
			return;
		}
	}

	#currentState(): BridgeState | undefined {
		const table = this.#controller.view().table;
		return table
			? parseBridgeState(table.state, this.#controller.tableId)
			: undefined;
	}

	async #send(
		seat: Seat,
		payload:
			| ReturnType<typeof actionPayload>
			| ReturnType<typeof undoVotePayload>
			| ReturnType<typeof claimVotePayload>
			| ReturnType<typeof resetVotePayload>,
		hostSeat: Seat | null,
	): Promise<void> {
		const result = await this.#deliver(seat, payload, hostSeat);
		if (!result.ok) throw new Error("host rejected local bot action");
		this.#rerun = true;
	}

	#deliver(
		seat: Seat,
		payload: JsonObject,
		hostSeat: Seat | null,
	): Promise<{ readonly ok: boolean }> {
		return seat === hostSeat
			? this.#controller.send(payload)
			: this.#controller.sendBot(seat, payload);
	}
}

/** True while an undo, a claim or a reset waits for answers; the host refuses calls and cards until then. */
function requestWaiting(state: BridgeState | undefined): boolean {
	return Boolean(state?.claim || state?.undo || state?.reset);
}

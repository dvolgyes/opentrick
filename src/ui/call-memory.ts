import type { CallController } from "../call/call";
import type { Switches } from "../call/policy";
import {
	type CallRecords,
	callRecordFor,
	callRecordPayload,
	callRestore,
	ownCallRecord,
	pendingCallRecords,
} from "../call/record";
import type { JsonObject, Seat } from "../protocol";

/** Restores the holder's media choices, never capture or call membership. */

export interface CallMemoryDeps {
	readonly call: CallController;
	readonly tableId: string;
	readonly seat: Seat;
	/** This browser's holder; only a record of this holder is restored. */
	readonly holder: string;
	/** Stores an own command for sending; true when the outbox has it. */
	readonly send: (payload: JsonObject) => Promise<boolean>;
	/** The rejoin offer changed. */
	readonly changed: () => void;
}

/** What the memory reads from the table. */
export interface CallTable {
	/** Undefined while the table state is not known. */
	readonly records: CallRecords | undefined;
	/** The payloads of this page's own commands that are not in the log yet. */
	readonly outbox: readonly JsonObject[];
}

export class CallMemory {
	readonly #deps: CallMemoryDeps;
	#table: CallTable = { records: undefined, outbox: [] };
	/** An explicit action changed the call, and the change is not stored yet. */
	#dirty = false;
	/** A record is on its way into the outbox. */
	#storing = false;
	/** The restore ran, or the user acted first. */
	#decided = false;
	#rejoin: Switches | undefined;
	#stopped = false;

	constructor(deps: CallMemoryDeps) {
		this.#deps = deps;
	}

	/** The switches that "Rejoin the call" joins with; undefined when the page does not offer it. */
	get rejoin(): Switches | undefined {
		return this.#rejoin;
	}

	/** Call after the user joined, left or changed a switch, once the call controller has the new status. */
	acted(): void {
		this.#decided = true;
		this.#dirty = true;
		if (this.#rejoin !== undefined) {
			this.#rejoin = undefined;
			this.#deps.changed();
		}
		this.#store();
	}

	/**
	 * A bot that the host chose played the seat, so the call ended, and the seat is back. The page stays outside
	 * the call and stores that as an action, because the seat refused the page's commands while the bot played.
	 * A reload then does not join again either.
	 */
	seatReturned(): void {
		this.#decided = true;
		this.#dirty = true;
		if (this.#rejoin !== undefined) {
			this.#rejoin = undefined;
			this.#deps.changed();
		}
		this.#store();
	}

	/** The table changed. */
	update(table: CallTable): void {
		this.#table = table;
		this.#store();
		this.#restore();
	}

	stop(): void {
		this.#stopped = true;
	}

	#store(): void {
		const { records, outbox } = this.#table;
		if (!this.#dirty || this.#storing || records === undefined) return;
		const pending = pendingCallRecords(outbox);
		if (pending.length > 0) return;
		this.#dirty = false;
		const { requested, form } = this.#deps.call.view;
		const record = callRecordFor(
			records[this.#deps.seat],
			this.#deps.holder,
			pending,
			requested,
			form,
		);
		if (record === undefined) return;
		this.#storing = true;
		// A record that could not be stored is not retried: the next action stores the status again.
		void this.#deps
			.send(callRecordPayload(this.#deps.tableId, record))
			.then(() => {
				this.#storing = false;
				if (!this.#stopped) this.#store();
			});
	}

	#restore(): void {
		const { call } = this.#deps;
		const { records, outbox } = this.#table;
		if (this.#decided || records === undefined || !call.view.canJoin) return;
		// The page holds its seat, so its replica has every entry up to its own seat claim.
		this.#decided = true;
		const own = ownCallRecord(
			records[this.#deps.seat],
			this.#deps.holder,
			pendingCallRecords(outbox),
		);
		if (own === undefined) return;
		this.#rejoin = callRestore(own, call.view.form);
		call.restoreSwitches(own.prefs);
		if (own.prefs.inCall) {
			this.#dirty = true;
			this.#store();
		}
		if (this.#rejoin !== undefined) this.#deps.changed();
	}
}

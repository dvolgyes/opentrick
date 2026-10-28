import type { BuildInfo } from "../build";
import type { GetUserMedia } from "../call/media";
import type { Medium } from "../call/policy";
import type { Discovery } from "../community/discovery";
import type { OpenCommunity } from "../community/transport";
import type { Locale, Translate } from "../i18n";
import type { MeshHandlers } from "../p2p/mesh";
import type { Clock } from "../p2p/ports";
import type { TableStorage } from "../p2p/storage";
import type { TableMesh } from "../p2p/table";
import type { Seat } from "../protocol";
import type { MaybeStorage, SeatLocks, SeatMemory } from "../session";
import type { CameraDevices } from "./camera-setup";

/** The browser's call media, or the reason why this browser cannot make calls. */
export type CallSupport =
	| {
			readonly available: true;
			readonly getUserMedia: GetUserMedia;
			readonly cameras: CameraDevices;
			readonly createConnection: () => RTCPeerConnection;
			readonly newSession: () => string;
			/**
			 * The browser already allows this page to capture the medium, so a capture starts without a question.
			 * False when the browser would ask, refuses, or cannot tell.
			 */
			readonly granted: (medium: Medium) => Promise<boolean>;
	  }
	| { readonly available: false; readonly reason: string };

/** Everything the screens need from the browser. Only main.ts builds it. */
export interface AppDeps {
	/** The commit of this page, shown next to the language selector. */
	readonly build: BuildInfo;
	/** Browser-specific display language; never shared with the table. */
	readonly locale: Locale;
	/** Language selected by browser preference, used when the user chooses automatic language selection. */
	readonly detectedLocale: Locale;
	/** Explicit browser-local choice, if one is saved. */
	readonly savedLocale: Locale | undefined;
	readonly t: Translate;
	/** IndexedDB, or a memory store (not persistent) when this browser cannot store data. */
	readonly storage: TableStorage;
	/** Why `storage` is a memory store; undefined when it is IndexedDB. */
	readonly storageProblem: string | undefined;
	readonly locks: SeatLocks;
	readonly memory: SeatMemory;
	/** localStorage, for the per-browser client id of each table. */
	readonly browser: MaybeStorage;
	readonly clock: Clock;
	/** The page's one connection to the other pages of a table: the trackers, then direct links. */
	readonly openMesh: (
		tableId: string,
		key: string,
		community?: boolean,
	) => (handlers: MeshHandlers) => TableMesh;
	readonly openCommunity?: OpenCommunity;
	readonly discovery?: Discovery;
	readonly call: CallSupport;
	/** The current page URL, for building shareable links. */
	readonly pageUrl: () => string;
	/** Asks once that the browser keeps the stored tables; true when it will. Later calls return the same answer. */
	readonly persist: () => Promise<boolean>;
}

export interface Navigation {
	/** Loads the create screen at the site root from the server. Never reuses the current table or its setup query. */
	createNew(): void;
	/**
	 * Loads this page again from the server, so a new version of the site takes effect. It takes no argument, so a
	 * button can call it with its click event.
	 */
	reload(): void;
	/** Loads this page with the update query for the build of `targetDate`, so a cached older build is skipped. */
	update(targetDate: string): void;
	/** Stores the seat choice in this page's URL without navigating. */
	rememberSeat(seat: Seat): void;
	/** Removes the seat (`pl`) from this page's URL without navigating, so a reload opens the seat page. */
	forgetSeat(): void;
}

/** Stops a screen: timers, subscriptions and listeners. */
export type Dispose = () => void;

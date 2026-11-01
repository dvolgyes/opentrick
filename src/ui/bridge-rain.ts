/**
 * Bridge Rain: a decorative rain of game symbols behind floating bridge cards, for the tile of a bot.
 *
 * One requestAnimationFrame loop owns all movement, and its clocks advance only while frames are allowed: while the
 * owner plays it, the document is visible, the element has a size and the browser does not ask for reduced motion. A
 * frozen scene keeps its exact positions and resumes from them with no jump. The owner owns the turn sequencing; this
 * module knows no game state. The styles are in bridge-rain.css, and its symbol font is the bundled subset of Noto Sans
 * Symbols 2 (public/licenses/components.json).
 */

const FONT_FAMILY = "BridgeRainSymbols";
const FONT_SAMPLE = "🂡🀀🀱♔🨀⚀";
// One font-loading promise per document.
const fontReady = new WeakMap<Document, Promise<void>>();

/** Idle freezes the scene; acting moves faster than thinking. */
export type BridgeRainMode = "idle" | "thinking" | "acting";

export interface BridgeRainOptions {
	/** Foreground cards, clamped to 0–64. Zero leaves only the symbol rain. */
	readonly density?: number;
	/** Base visual speed, clamped to 0.25–2. */
	readonly speed?: number;
	/** CSS pixels between the columns of each of the two planes, clamped to 8–48. */
	readonly columnSpacing?: number;
	/** The extra speed of the acting mode, clamped to 1–4. */
	readonly actionMultiplier?: number;
	/** The cap of the canvas resolution, clamped to 1–3. */
	readonly maxPixelRatio?: number;
	/** The seed of the foreground cards. */
	readonly seed?: number;
	/** Freeze while the browser asks for reduced motion. */
	readonly respectReducedMotion?: boolean;
}

export type BridgeRainPause =
	| "suspended"
	| "reduced-motion"
	| "hidden"
	| "empty-container"
	| "destroyed";

export interface BridgeRainState {
	readonly mode: BridgeRainMode;
	/** The owner asks for movement. */
	readonly playing: boolean;
	/** Frames advance now: playing, and nothing in `pauseReason` stops them. */
	readonly running: boolean;
	readonly pauseReason: BridgeRainPause | null;
	/** Active seconds; they stop during pauses. */
	readonly time: number;
	readonly destroyed: boolean;
}

interface RainCard {
	readonly element: HTMLElement;
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly fall: number;
	readonly tilt: number;
	readonly yaw: number;
	readonly phase: number;
}

interface Stream {
	readonly x: number;
	readonly seed: number;
	readonly offset: number;
	readonly speed: number;
	readonly length: number;
	readonly rowHeight: number;
	readonly size: number;
	readonly maxWidth: number;
	readonly intensity: number;
}

/** Numbers are checked once, at the boundary, outside the frame loop. */
function bounded(
	value: number,
	min: number,
	max: number,
	name: string,
): number {
	if (!Number.isFinite(value))
		throw new TypeError(`${name} must be a finite number.`);
	return Math.max(min, Math.min(max, value));
}

/** Stateless noise: the same input always rebuilds the same frame. */
function noise(value: number): number {
	const n = Math.sin(value * 127.1 + 311.7) * 43758.5453;
	return n - Math.floor(n);
}

/**
 * The symbol families as whole code points, so a supplementary-plane symbol never splits into surrogates. Separate
 * families keep the six dice as common as the hundred dominoes.
 */
function glyphFamilies(): readonly (readonly string[])[] {
	const range = (first: number, last: number): string[] =>
		Array.from({ length: last - first + 1 }, (_, offset) =>
			String.fromCodePoint(first + offset),
		);
	return [
		// Playing cards
		[
			...range(0x1f0a0, 0x1f0ae),
			...range(0x1f0b1, 0x1f0bf),
			...range(0x1f0c1, 0x1f0cf),
			...range(0x1f0d1, 0x1f0f5),
		],
		// Mahjong tiles
		range(0x1f000, 0x1f02b),
		// Domino tiles
		range(0x1f030, 0x1f093),
		// Classic chess
		range(0x2654, 0x265f),
		// Extended chess
		[...range(0x1fa00, 0x1fa53), ...range(0x1fa60, 0x1fa6d)],
		// Dice
		range(0x2680, 0x2685),
	];
}

/** The first draw waits for the font, so a frozen scene shows symbols and not boxes; a missing style fails clearly. */
async function loadSymbolFont(doc: Document): Promise<void> {
	let pending = fontReady.get(doc);
	if (pending === undefined) {
		pending = doc.fonts
			.load(`16px "${FONT_FAMILY}"`, FONT_SAMPLE)
			.then((faces) => {
				if (faces.length === 0)
					throw new Error("The bridge rain needs bridge-rain.css.");
			})
			.catch((error: unknown) => {
				// A later attempt can load the font.
				fontReady.delete(doc);
				throw error;
			});
		fontReady.set(doc, pending);
	}
	await pending;
}

export class BridgeRain {
	/** Mounts the effect at the end of `container`, frozen. The container needs a definite height. */
	static async create(
		container: HTMLElement,
		options: BridgeRainOptions = {},
	): Promise<BridgeRain> {
		if (container.ownerDocument.defaultView === null)
			throw new TypeError("The bridge rain needs an element of a window.");
		await loadSymbolFont(container.ownerDocument);
		return new BridgeRain(container, options);
	}

	readonly #doc: Document;
	readonly #win: Window;
	readonly #speed: number;
	readonly #columnSpacing: number;
	readonly #actionMultiplier: number;
	readonly #maxPixelRatio: number;
	readonly #respectReducedMotion: boolean;
	readonly #motionPreference: MediaQueryList;
	readonly #families = glyphFamilies();
	readonly #root: HTMLElement;
	readonly #canvas: HTMLCanvasElement;
	readonly #ctx: CanvasRenderingContext2D;
	readonly #cardSpace: HTMLElement;
	readonly #observer: ResizeObserver;
	#seed: number;
	#mode: BridgeRainMode = "idle";
	// The owner's intent; the environment can still hold the frames.
	#playing = false;
	#destroyed = false;
	// Active seconds, independent of the speed.
	#time = 0;
	// The scene starts populated, not empty.
	#motionTime = 17.3;
	#lastStamp: number | null = null;
	#frameId: number | null = null;
	#width = 0;
	#height = 0;
	#cards: RainCard[] = [];
	#streams: Stream[] = [];

	private constructor(container: HTMLElement, options: BridgeRainOptions) {
		// The options are checked before any element or listener exists.
		const density = Math.round(
			bounded(options.density ?? 40, 0, 64, "density"),
		);
		this.#speed = bounded(options.speed ?? 1, 0.25, 2, "speed");
		this.#columnSpacing = bounded(
			options.columnSpacing ?? 16,
			8,
			48,
			"columnSpacing",
		);
		this.#actionMultiplier = bounded(
			options.actionMultiplier ?? 2.25,
			1,
			4,
			"actionMultiplier",
		);
		this.#maxPixelRatio = bounded(
			options.maxPixelRatio ?? 2,
			1,
			3,
			"maxPixelRatio",
		);
		this.#seed = bounded(options.seed ?? 87431, 0, 0xffffffff, "seed") >>> 0;
		this.#respectReducedMotion = options.respectReducedMotion ?? true;
		this.#doc = container.ownerDocument;
		const win = this.#doc.defaultView;
		if (win === null)
			throw new TypeError("The bridge rain needs an element of a window.");
		this.#win = win;
		this.#motionPreference = win.matchMedia("(prefers-reduced-motion: reduce)");

		this.#root = this.#doc.createElement("div");
		this.#root.className = "bridge-rain";
		this.#root.setAttribute("aria-hidden", "true");
		this.#canvas = this.#doc.createElement("canvas");
		this.#canvas.className = "bridge-rain-canvas";
		const ctx = this.#canvas.getContext("2d");
		if (ctx === null)
			throw new Error("The bridge rain could not get a 2D canvas.");
		this.#ctx = ctx;
		this.#cardSpace = this.#doc.createElement("div");
		this.#cardSpace.className = "bridge-rain-cards";
		this.#root.append(this.#canvas, this.#cardSpace);
		container.append(this.#root);

		this.#doc.addEventListener("visibilitychange", this.#environmentChanged);
		this.#motionPreference.addEventListener("change", this.#environmentChanged);
		this.#win.addEventListener("resize", this.#windowResized);
		this.#observer = new ResizeObserver(() => this.resize());
		this.#observer.observe(this.#root);

		while (this.#cards.length < density) this.#cards.push(this.#createCard());
		this.resize();
	}

	/** Thinking and acting move the scene; idle freezes it at once. */
	setMode(mode: BridgeRainMode): void {
		if (this.#destroyed) return;
		this.#mode = mode;
		if (mode === "idle") this.suspend();
		else this.play();
	}

	/** Resumes from the frozen positions; an idle scene starts thinking. Reduced motion still holds it. */
	play(): void {
		if (this.#destroyed || this.#playing) return;
		if (this.#mode === "idle") this.#mode = "thinking";
		this.#playing = true;
		this.#lastStamp = null;
		this.#schedule();
	}

	/** Freezes both clocks and every position, and keeps the mode. */
	suspend(): void {
		if (this.#destroyed) return;
		this.#playing = false;
		this.#cancelFrame();
	}

	/** Measures and draws again without advancing time; a ResizeObserver calls it. */
	resize(): void {
		if (this.#destroyed) return;
		this.#cancelFrame();
		const rect = this.#root.getBoundingClientRect();
		this.#width = Math.max(0, rect.width);
		this.#height = Math.max(0, rect.height);
		const ratio = Math.min(
			this.#win.devicePixelRatio || 1,
			this.#maxPixelRatio,
		);
		this.#canvas.width = Math.max(1, Math.round(this.#width * ratio));
		this.#canvas.height = Math.max(1, Math.round(this.#height * ratio));
		this.#ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
		this.#buildStreams();
		this.#render();
		this.#schedule();
	}

	getState(): BridgeRainState {
		const pauseReason: BridgeRainPause | null = this.#destroyed
			? "destroyed"
			: !this.#playing
				? "suspended"
				: this.#reducedMotion()
					? "reduced-motion"
					: this.#doc.hidden
						? "hidden"
						: this.#width === 0 || this.#height === 0
							? "empty-container"
							: null;
		return {
			mode: this.#mode,
			playing: this.#playing,
			running: pauseReason === null,
			pauseReason,
			time: this.#time,
			destroyed: this.#destroyed,
		};
	}

	/** Removes the effect's elements and listeners; a second call does nothing. */
	destroy(): void {
		if (this.#destroyed) return;
		this.#playing = false;
		this.#cancelFrame();
		this.#destroyed = true;
		this.#observer.disconnect();
		this.#doc.removeEventListener("visibilitychange", this.#environmentChanged);
		this.#motionPreference.removeEventListener(
			"change",
			this.#environmentChanged,
		);
		this.#win.removeEventListener("resize", this.#windowResized);
		this.#root.remove();
		this.#cards = [];
		this.#streams = [];
		// The bitmap is released even while an owner keeps this object.
		this.#canvas.width = 1;
		this.#canvas.height = 1;
	}

	// The time spent hidden or with reduced motion is not caught up.
	readonly #environmentChanged = (): void => {
		this.#cancelFrame();
		this.#schedule();
	};

	readonly #windowResized = (): void => this.resize();

	#reducedMotion(): boolean {
		return this.#respectReducedMotion && this.#motionPreference.matches;
	}

	#canAnimate(): boolean {
		return (
			!this.#destroyed &&
			this.#playing &&
			!this.#doc.hidden &&
			this.#width > 0 &&
			this.#height > 0 &&
			!this.#reducedMotion()
		);
	}

	#schedule(): void {
		if (this.#canAnimate() && this.#frameId === null)
			this.#frameId = this.#win.requestAnimationFrame(this.#tick);
	}

	#cancelFrame(): void {
		if (this.#frameId !== null) this.#win.cancelAnimationFrame(this.#frameId);
		this.#frameId = null;
		this.#lastStamp = null;
	}

	readonly #tick = (stamp: number): void => {
		this.#frameId = null;
		if (!this.#canAnimate()) return;
		// The first frame after a pause has no time step, and a stall moves at most 50 ms.
		const dt =
			this.#lastStamp === null
				? 0
				: Math.min((stamp - this.#lastStamp) / 1000, 0.05);
		this.#lastStamp = stamp;
		this.#time += dt;
		this.#motionTime +=
			dt * this.#speed * (this.#mode === "acting" ? this.#actionMultiplier : 1);
		this.#render();
		this.#schedule();
	};

	#random(): number {
		this.#seed = (Math.imul(1664525, this.#seed) + 1013904223) >>> 0;
		return this.#seed / 4294967296;
	}

	/** A decorative card: no player, host or deal supplies its rank or suit. */
	#createCard(): RainCard {
		const ranks = [
			"A",
			"K",
			"Q",
			"J",
			"10",
			"9",
			"8",
			"7",
			"6",
			"5",
			"4",
			"3",
			"2",
		];
		const suits = ["♠", "♥", "♦", "♣"];
		const rank = ranks[Math.floor(this.#random() * ranks.length)] ?? "A";
		const suit = suits[Math.floor(this.#random() * suits.length)] ?? "♠";
		const element = this.#doc.createElement("div");
		element.className = "bridge-rain-card";
		element.dataset.ace = String(rank === "A");
		for (const bottom of [false, true]) {
			const corner = this.#doc.createElement("span");
			corner.className = bottom
				? "bridge-rain-corner bridge-rain-corner-bottom"
				: "bridge-rain-corner";
			corner.textContent = rank;
			const small = this.#doc.createElement("small");
			small.textContent = suit;
			corner.append(small);
			element.append(corner);
		}
		const pip = this.#doc.createElement("span");
		pip.className = "bridge-rain-pip";
		pip.textContent = suit;
		element.append(pip);
		const z = -750 + this.#random() * 920;
		element.style.opacity = String(0.28 + ((z + 750) / 920) * 0.65);
		this.#cardSpace.append(element);
		return {
			element,
			x: this.#random(),
			y: this.#random(),
			z,
			fall: 25 + this.#random() * 34,
			tilt: (this.#random() - 0.5) * 48,
			yaw: (this.#random() - 0.5) * 76,
			phase: this.#random() * Math.PI * 2,
		};
	}

	#buildStreams(): void {
		const spacing = this.#columnSpacing;
		this.#streams = [0, 1].flatMap((layer) =>
			Array.from({ length: Math.ceil(this.#width / spacing) }, (_, i) => {
				const seed = i * 31 + layer * 1709 + 7;
				return {
					// The back columns sit halfway between the front columns.
					x: (i + (layer ? 0.25 : 0.75)) * spacing,
					seed,
					offset: noise(seed + 1) * 2200,
					speed: (layer ? 27 : 14) + noise(seed + 18) * (layer ? 42 : 24),
					length: (layer ? 28 : 22) + Math.floor(noise(seed + 80) * 24),
					rowHeight: layer ? 19 : 16,
					size: layer ? 16 : 11,
					maxWidth: Math.min(layer ? 14 : 9, spacing - 2),
					intensity: layer
						? 0.29 + noise(seed + 41) * 0.24
						: 0.1 + noise(seed + 41) * 0.13,
				};
			}),
		);
	}

	#render(): void {
		if (this.#width === 0 || this.#height === 0 || this.#destroyed) return;
		const ctx = this.#ctx;
		const w = this.#width;
		const h = this.#height;
		const t = this.#motionTime;
		ctx.clearRect(0, 0, w, h);
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";

		// Each trail is rebuilt from the clock, not faded in a buffer, so the same time draws the same frame.
		for (const stream of this.#streams) {
			ctx.font = `${stream.size}px "${FONT_FAMILY}"`;
			const cycle = h + stream.length * stream.rowHeight + 45;
			const head = ((stream.offset + t * stream.speed) % cycle) - 24;
			const tick = Math.floor(t * (1.2 + noise(stream.seed) * 1.4));
			for (let j = 0; j < stream.length; j++) {
				const y = head - j * stream.rowHeight;
				// Rows outside the element are not drawn.
				if (y < -20 || y > h + 20) continue;
				const family =
					this.#families[
						Math.floor(
							noise(stream.seed + j * 13 + tick) * this.#families.length,
						)
					] ?? [];
				const symbol =
					family[
						Math.floor(noise(stream.seed + j * 17 + tick + 311) * family.length)
					] ?? "";
				const alpha = (1 - j / stream.length) ** 0.8 * stream.intensity;
				ctx.fillStyle =
					j === 0
						? `rgba(199,255,184,${Math.min(1, alpha + 0.28)})`
						: `rgba(101,225,120,${alpha})`;
				ctx.fillText(symbol, stream.x, y, stream.maxWidth);
			}
		}

		// A CSS perspective projects the card field; position and rotation follow the clock of the rain.
		const span = h * 2.2 + 380;
		const camera = Math.sin(t * 0.12) * 12;
		for (const card of this.#cards) {
			const x =
				(card.x - 0.5) * (w + 420) +
				Math.sin(t * 0.22 + card.phase) * 25 +
				camera;
			const y = ((card.y * span + t * card.fall) % span) - span / 2;
			const rx = 15 + Math.sin(t * 0.31 + card.phase) * 15;
			const ry = card.yaw + Math.sin(t * 0.27 + card.phase) * 21;
			const rz = card.tilt + Math.sin(t * 0.18 + card.phase) * 10;
			card.element.style.transform = `translate(-50%,-50%) translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,${card.z.toFixed(2)}px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg)`;
		}
	}
}

import { DdsSolver } from "./dds-solver";
import { analyzePlay } from "./play-engine";
import type { PlayPosition } from "./play-position";

interface PlayRequest {
	readonly position: PlayPosition;
	readonly timeMs: number;
}

interface WorkerScope {
	onmessage: ((event: MessageEvent<PlayRequest>) => void) | null;
	postMessage(message: unknown): void;
}

function start(scope: WorkerScope): void {
	// A single solver owns its transposition memory for the lifetime of this worker.
	const solver = DdsSolver.create();
	scope.onmessage = (event) => {
		void solver
			.then((dds) => {
				const analysis = analyzePlay(event.data.position, dds, {
					timeMs: event.data.timeMs,
					onProgress: (partial) =>
						scope.postMessage({ ok: true, partial: true, analysis: partial }),
				});
				scope.postMessage({ ok: true, analysis });
			})
			.catch(() => {
				// Never forward arbitrary native errors, input cards, or browser state to room diagnostics.
				scope.postMessage({ ok: false });
			});
	};
}

start(self as unknown as WorkerScope);

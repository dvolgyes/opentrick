import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import "../../src/ui/style.css";
import { LocalMedia } from "../../src/call/media";
import { englishTranslator } from "../../src/i18n";
import { cameraSetup } from "../../src/ui/camera-setup";
import { playView, renderView } from "./table-mobile-play-fixtures";

afterEach(() => document.body.replaceChildren());

it("requests native camera frames in both preview and direct capture", async () => {
	const getUserMedia = navigator.mediaDevices.getUserMedia.bind(
		navigator.mediaDevices,
	);
	const media = new LocalMedia(getUserMedia, () => {});
	const setup = cameraSetup({
		devices: { enumerate: async () => [], subscribe: () => () => {} },
		getUserMedia,
		t: englishTranslator,
	});
	document.body.append(setup.element);
	try {
		void setup.open();
		media.set("video", true);
		await expect.poll(() => media.state("video")).toBe("on");
		const preview = videoAt(setup.element, "camera-preview");
		await expect.poll(() => preview.videoWidth).toBeGreaterThan(0);
		const source = preview.srcObject;
		if (!(source instanceof MediaStream)) throw new Error("No preview stream");
		expect(media.track("video")?.getSettings()).toMatchObject({
			resizeMode: "none",
		});
		expect(source.getVideoTracks()[0]?.getSettings()).toMatchObject({
			resizeMode: "none",
		});
	} finally {
		setup.dispose();
		media.stop();
	}
});

function videoAt(root: HTMLElement, id: string): HTMLVideoElement {
	const video = root.querySelector<HTMLVideoElement>(`[data-testid='${id}']`);
	if (video === null) throw new Error(`Missing video: ${id}`);
	return video;
}

async function expectFrameEdges(video: HTMLVideoElement): Promise<void> {
	const box = video.getBoundingClientRect();
	const scale = Math.min(
		1,
		box.width / video.videoWidth,
		box.height / video.videoHeight,
	);
	const frameWidth = video.videoWidth * scale;
	const frameHeight = video.videoHeight * scale;
	const image = new Image();
	image.src = `data:image/png;base64,${await page.screenshot({ element: video, save: false })}`;
	await image.decode();
	const screenshot = document.createElement("canvas");
	screenshot.width = image.naturalWidth;
	screenshot.height = image.naturalHeight;
	const pixels = screenshot.getContext("2d");
	if (pixels === null) throw new Error("No screenshot context");
	pixels.drawImage(image, 0, 0);
	for (const [side, dx, dy, red, green] of [
		["left", -0.44, 0, true, false],
		["right", 0.44, 0, true, false],
		["top", 0, -0.44, false, true],
		["bottom", 0, 0.44, false, true],
	] as const) {
		const x = Math.round(
			screenshot.width * (0.5 + (dx * frameWidth) / box.width),
		);
		const y = Math.round(
			screenshot.height * (0.5 + (dy * frameHeight) / box.height),
		);
		const [r = 0, g = 0, b = 0] = pixels.getImageData(x, y, 1, 1).data;
		expect(
			[r > 180, g > 180, b > 180],
			`${video.dataset.testid}: ${side} frame edge`,
		).toEqual([red, green, true]);
	}
}

const SOURCES = [
	[720, 300],
	[300, 720],
	[120, 80],
] as const;

it.each(SOURCES)(
	"keeps all frame edges for a %i × %i source",
	async (width, height) => {
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const paint = canvas.getContext("2d");
		if (paint === null) throw new Error("No canvas context");
		await page.viewport(1280, 900);
		const stream = canvas.captureStream(0);
		const [track] = stream.getVideoTracks();
		if (!(track instanceof CanvasCaptureMediaStreamTrack))
			throw new Error("No canvas video track");
		const { root, section } = renderView(playView(), "desktop");
		const setup = cameraSetup({
			devices: {
				enumerate: async () => [{ deviceId: "canvas", label: "Test camera" }],
				subscribe: () => () => {},
			},
			getUserMedia: async () => stream,
			t: englishTranslator,
		});
		document.body.append(setup.element);
		try {
			const opening = setup.open();
			section.renderCall({
				available: true,
				view: {
					status: "subscribed",
					canJoin: false,
					form: "desktop",
					media: { send: ["audio", "video"], receive: ["audio", "video"] },
					requested: {
						inCall: true,
						send: { audio: false, video: true },
						receive: { audio: false, video: true },
					},
					mic: "off",
					camera: "on",
					localVideo: track,
					problem: undefined,
					remotes: [
						{
							seat: "E",
							status: "connected",
							audio: undefined,
							video: track,
							peerSendsAudio: false,
							peerReceivesAudio: false,
							peerSendsVideo: true,
							fault: undefined,
						},
					],
				},
			});
			const preview = videoAt(setup.element, "camera-preview");
			const own = videoAt(root, "video-self");
			const remote = videoAt(root, "video-E");
			await expect.poll(() => preview.srcObject).toBe(stream);
			const check = async (video: HTMLVideoElement): Promise<void> => {
				await expect
					.poll(() => {
						paint.fillStyle = "#008000";
						paint.fillRect(0, 0, width, height);
						paint.fillStyle = "#ff00ff";
						paint.fillRect(0, 0, width * 0.12, height);
						paint.fillRect(width * 0.88, 0, width * 0.12, height);
						paint.fillStyle = "#00ffff";
						paint.fillRect(0, 0, width, height * 0.12);
						paint.fillRect(0, height * 0.88, width, height * 0.12);
						track.requestFrame();
						return [video.videoWidth, video.videoHeight, video.readyState >= 2];
					})
					.toEqual([width, height, true]);
				await expectFrameEdges(video);
			};
			await check(preview);
			const confirm = setup.element.querySelector<HTMLButtonElement>(
				"[data-testid='camera-preview-confirm']",
			);
			if (confirm === null) throw new Error("Missing preview confirmation");
			expect(confirm.disabled).toBe(false);
			confirm.click();
			const selected = await opening;
			if (selected === undefined || selected === "cancelled")
				throw new Error("The preview was not confirmed");
			expect(selected.track).toBe(track);
			await check(own);
			await check(remote);
			for (const [video, tileSelector] of [
				[own, ".call-panel"],
				[remote, ".tile"],
			] as const) {
				const caption = video
					.closest(tileSelector)
					?.querySelector(".tile-caption");
				if (caption === undefined || caption === null)
					throw new Error(`Missing caption: ${tileSelector}`);
				expect(
					Math.abs(
						video.getBoundingClientRect().bottom -
							caption.getBoundingClientRect().top,
					),
				).toBeLessThanOrEqual(1);
			}
		} finally {
			setup.dispose();
			track.stop();
		}
	},
);

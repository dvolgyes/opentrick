import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";

/**
 * The Node bot must exit on SIGTERM also while a relay socket is open: Trystero keeps the relay sockets after the
 * room is left, so they alone keep the process alive. The relay is a local wss: server with a self-signed
 * certificate that the bot trusts through NODE_EXTRA_CA_CERTS.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function certificate(): { key: string; cert: string; certPath: string } {
	const dir = mkdtempSync(join(tmpdir(), "opentrick-cli-exit-"));
	cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
	const keyPath = join(dir, "key.pem");
	const certPath = join(dir, "cert.pem");
	execFileSync(
		"openssl",
		[
			"req",
			"-x509",
			"-newkey",
			"ec",
			"-pkeyopt",
			"ec_paramgen_curve:prime256v1",
			"-nodes",
			"-days",
			"1",
			"-subj",
			"/CN=127.0.0.1",
			"-addext",
			"subjectAltName=IP:127.0.0.1",
			"-keyout",
			keyPath,
			"-out",
			certPath,
		],
		{ stdio: "ignore" },
	);
	return {
		key: readFileSync(keyPath, "utf8"),
		cert: readFileSync(certPath, "utf8"),
		certPath,
	};
}

async function relay(
	key: string,
	cert: string,
): Promise<{ url: string; connected: Promise<void> }> {
	const server: Server = createServer({ key, cert });
	const sockets = new WebSocketServer({ server });
	const connected = new Promise<void>((resolve) =>
		sockets.once("connection", () => resolve()),
	);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	cleanups.push(() => {
		for (const client of sockets.clients) client.terminate();
		sockets.close();
		server.close();
	});
	const { port } = server.address() as AddressInfo;
	return { url: `wss://127.0.0.1:${port}/`, connected };
}

function exited(child: ChildProcess): Promise<number | string> {
	return new Promise((resolve) =>
		child.once("exit", (code, signal) => resolve(code ?? signal ?? "")),
	);
}

describe("the Node bot command", () => {
	it("exits on SIGTERM while its relay socket is open", async () => {
		const { key, cert, certPath } = certificate();
		const { url, connected } = await relay(key, cert);
		const link = `http://localhost:4173/?n=cli+north&e=cli+east&s=cli+south&w=host+west&h=W#k=${randomBytes(16).toString("base64url")}`;
		const child = spawn(
			process.execPath,
			[
				"--import",
				"tsx",
				"src/bot/cli.ts",
				link,
				"--user",
				"cli north",
				"--random",
			],
			{
				env: {
					...process.env,
					OPENROUTER_API_KEY: "",
					NODE_EXTRA_CA_CERTS: certPath,
					VITE_TRACKER_URLS: "none",
					VITE_MQTT_BROKER_URLS: "none",
					VITE_NOSTR_RELAY_URLS: url,
				},
				stdio: "ignore",
			},
		);
		const exit = exited(child);
		cleanups.push(() => child.kill("SIGKILL"));
		await connected;
		child.kill("SIGTERM");
		const result = await Promise.race([
			exit,
			new Promise((resolve) => setTimeout(() => resolve("alive"), 5_000)),
		]);
		expect(result, "the bot after SIGTERM").toBe(130);
	}, 30_000);
});

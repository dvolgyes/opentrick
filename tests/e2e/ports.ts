/**
 * The ports of the e2e servers: the built app and the P2P harness (tests/e2e/harness). `E2E_PORT` and
 * `E2E_HARNESS_PORT` move them, for example when another checkout's run holds the defaults.
 */
function port(name: string, fallback: number): number {
	const text = process.env[name];
	if (text === undefined || text === "") return fallback;
	const value = Number(text);
	if (!Number.isInteger(value) || value < 1 || value > 65_535)
		throw new Error(`${name} must be a port number from 1 to 65535: ${text}`);
	return value;
}

export const PORT = port("E2E_PORT", 4173);
export const HARNESS_PORT = port("E2E_HARNESS_PORT", 4174);
export const HARNESS_URL = `http://localhost:${HARNESS_PORT}/`;

import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("builds without the Vite config and Node module compatibility warnings", () => {
	const build = spawnSync("npm", ["run", "build"], {
		encoding: "utf8",
		timeout: 60_000,
	});
	expect(build.error).toBeUndefined();
	expect(build.status, build.stderr).toBe(0);
	const output = build.stdout + build.stderr;
	expect(output).not.toContain("configLoader: 'native'");
	expect(output).not.toContain("externalized for browser compatibility");
	expect(output).not.toContain("SOURCEMAP_BROKEN");
}, 70_000);

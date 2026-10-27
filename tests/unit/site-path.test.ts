import { expect, it } from "vitest";
import { siteLocation, sitePath } from "../../src/ui/site-path";

it.each(["/", "/opentrick/"])(
	"keeps entry and home links inside %s",
	(root) => {
		for (const page of ["create", "solo", "join"] as const) {
			for (const suffix of ["", "/", "/index.html"]) {
				const path = `${root}${page}${suffix}`;
				expect(siteLocation(path)).toEqual({ root, page });
				expect(sitePath(path, "home")).toBe(root);
				expect(sitePath(path, "create")).toBe(`${root}create`);
			}
		}
		expect(siteLocation(`${root}index.html`)).toEqual({ root, page: "home" });
	},
);

it("does not interpret lookalike path components as automatic game actions", () => {
	for (const path of ["/solo-other/", "/rejoin/", "/join/extra/", "/%73olo/"])
		expect(siteLocation(path).page).toBe("home");
});

it("never turns malformed paths into links to another host", () => {
	for (const path of [
		"//elsewhere.example/join",
		"/\\elsewhere.example/solo",
		"https://elsewhere.example/create",
	]) {
		expect(siteLocation(path)).toEqual({ root: "/", page: "home" });
		expect(sitePath(path, "create")).toBe("/create");
	}
});

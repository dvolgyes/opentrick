import { describe, expect, it } from "vitest";
import { type Locale, translator } from "../../src/i18n";
import { pageTitle } from "../../src/ui/page-title";

describe("page title", () => {
	it.each<[Locale, string, string, string, string]>([
		[
			"en",
			"Bridge",
			"Bridge: Anna (W)",
			"TURN - Bridge: Anna (W)",
			"Bridge: Anna (W, host)",
		],
		[
			"de",
			"Bridge",
			"Bridge: Anna (W)",
			"AM ZUG - Bridge: Anna (W)",
			"Bridge: Anna (W, Host)",
		],
		[
			"hu",
			"Bridzs",
			"Bridzs: Anna (Ny)",
			"TE JÖSSZ - Bridzs: Anna (Ny)",
			"Bridzs: Anna (Ny, host)",
		],
		[
			"no",
			"Bridge",
			"Bridge: Anna (V)",
			"DIN TUR - Bridge: Anna (V)",
			"Bridge: Anna (V, vert)",
		],
		[
			"es",
			"Bridge",
			"Bridge: Anna (O)",
			"TU TURNO - Bridge: Anna (O)",
			"Bridge: Anna (O, host)",
		],
		[
			"pt",
			"Bridge",
			"Bridge: Anna (O)",
			"A SUA VEZ - Bridge: Anna (O)",
			"Bridge: Anna (O, host)",
		],
		[
			"fr",
			"Bridge",
			"Bridge : Anna (O)",
			"À VOUS - Bridge : Anna (O)",
			"Bridge : Anna (O, hôte)",
		],
		[
			"it",
			"Bridge",
			"Bridge: Anna (O)",
			"TOCCA A TE - Bridge: Anna (O)",
			"Bridge: Anna (O, host)",
		],
		[
			"nl",
			"Bridge",
			"Bridge: Anna (W)",
			"JOUW BEURT - Bridge: Anna (W)",
			"Bridge: Anna (W, host)",
		],
	])(
		"names the game, the seat, the host, and the turn in %s",
		(locale, bare, seated, turn, host) => {
			const t = translator(locale);
			expect([
				pageTitle(t),
				pageTitle(t, { name: "Anna", seat: "W", turn: false }),
				pageTitle(t, { name: "Anna", seat: "W", turn: true }),
				pageTitle(t, { name: "Anna", seat: "W", turn: false, host: true }),
			]).toEqual([bare, seated, turn, host]);
		},
	);

	it("names a seat that a bot plays bot, also for the host and on its turn", () => {
		const t = translator("en");
		expect(
			pageTitle(t, { name: "Anna", seat: "S", turn: true, bot: true }),
		).toBe("TURN - Bridge: bot (S)");
		expect(
			pageTitle(t, {
				name: "Anna",
				seat: "S",
				turn: false,
				host: true,
				bot: true,
			}),
		).toBe("Bridge: bot (S, host)");
	});
});

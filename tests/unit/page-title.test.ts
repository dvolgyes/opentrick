import { describe, expect, it } from "vitest";
import { type Locale, translator } from "../../src/i18n";
import { pageTitle } from "../../src/ui/page-title";

describe("page title", () => {
	it.each<[Locale, string, string, string]>([
		["en", "Bridge", "Bridge: Anna (W)", "TURN - Bridge: Anna (W)"],
		["de", "Bridge", "Bridge: Anna (W)", "AM ZUG - Bridge: Anna (W)"],
		["hu", "Bridzs", "Bridzs: Anna (Ny)", "TE JÖSSZ - Bridzs: Anna (Ny)"],
		["no", "Bridge", "Bridge: Anna (V)", "DIN TUR - Bridge: Anna (V)"],
		["es", "Bridge", "Bridge: Anna (O)", "TU TURNO - Bridge: Anna (O)"],
		["pt", "Bridge", "Bridge: Anna (O)", "A SUA VEZ - Bridge: Anna (O)"],
		["fr", "Bridge", "Bridge : Anna (O)", "À VOUS - Bridge : Anna (O)"],
		["it", "Bridge", "Bridge: Anna (O)", "TOCCA A TE - Bridge: Anna (O)"],
		["nl", "Bridge", "Bridge: Anna (W)", "JOUW BEURT - Bridge: Anna (W)"],
	])(
		"names the game, the seat, and the turn in %s",
		(locale, bare, seated, turn) => {
			const t = translator(locale);
			expect([
				pageTitle(t),
				pageTitle(t, { name: "Anna", seat: "W", turn: false }),
				pageTitle(t, { name: "Anna", seat: "W", turn: true }),
			]).toEqual([bare, seated, turn]);
		},
	);
});

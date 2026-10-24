import type { Translate } from "../i18n";
import type { Seat } from "../protocol";

/** The browser tab's title: the game, then the viewer's name and seat once seated, marked while it is their turn. */
export function pageTitle(
	t: Translate,
	seated?: { name: string; seat: Seat; turn: boolean },
): string {
	const game = t("Bridge");
	if (seated === undefined) return game;
	const title = t("{game}: {name} ({seat})", {
		game,
		name: seated.name,
		seat: t(seated.seat),
	});
	return seated.turn ? t("TURN - {title}", { title }) : title;
}

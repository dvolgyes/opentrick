import type { Translate } from "../i18n";
import type { Seat } from "../protocol";

/**
 * The browser tab's title: the game, then the viewer's name and seat once seated, marked while it is their turn.
 * The host's page says host after the seat. Autoplay does not change the player's name.
 */
export function pageTitle(
	t: Translate,
	seated?: {
		name: string;
		seat: Seat;
		turn: boolean;
		host?: boolean;
		bot?: boolean;
	},
): string {
	const game = t("Bridge");
	if (seated === undefined) return game;
	const title = t(
		seated.host ? "{game}: {name} ({seat}, host)" : "{game}: {name} ({seat})",
		{
			game,
			name: seated.name,
			seat: t(seated.seat),
		},
	);
	return seated.turn ? t("TURN - {title}", { title }) : title;
}

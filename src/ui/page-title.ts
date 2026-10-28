import type { Translate } from "../i18n";
import type { Seat } from "../protocol";
import { BOT_NAME } from "./model";

/**
 * The browser tab's title: the game, then the viewer's name and seat once seated, marked while it is their turn.
 * The host's page says host after the seat; a seat that a bot plays shows bot in place of the name.
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
			name: seated.bot ? BOT_NAME : seated.name,
			seat: t(seated.seat),
		},
	);
	return seated.turn ? t("TURN - {title}", { title }) : title;
}

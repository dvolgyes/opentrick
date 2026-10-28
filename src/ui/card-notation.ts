import { el } from "./dom";

/** Marks suit/rank notation in prose without changing its text or interpreting HTML. */
export function cardNotation(text: string): (string | HTMLElement)[] {
	const parts: (string | HTMLElement)[] = [];
	let at = 0;
	for (const match of text.matchAll(
		/[1-7](?:NT|[♠♥♦♣])(?:XX|X)?|(?:10|[2-9TJQKA])[♠♥♦♣]|[♠♥♦♣](?:10|[2-9TJQKA])?|\bNT\b/gu,
	)) {
		if (match.index > at) parts.push(text.slice(at, match.index));
		const suit = /[♣♦♥♠]/u.exec(match[0])?.[0];
		const strain =
			suit === "♣"
				? "C"
				: suit === "♦"
					? "D"
					: suit === "♥"
						? "H"
						: suit === "♠"
							? "S"
							: undefined;
		parts.push(
			el(
				"span",
				{ className: `card-notation${strain ? ` strain-${strain}` : ""}` },
				match[0],
			),
		);
		at = match.index + match[0].length;
	}
	if (at < text.length) parts.push(text.slice(at));
	return parts;
}

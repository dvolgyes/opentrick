/**
 * Stroke icons from constant path data. An icon is decoration: the button that holds it carries the
 * accessible name, so every icon is hidden from assistive technology.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

export type IconName =
	| "phone"
	| "mic"
	| "speaker"
	| "camera"
	| "display"
	| "mirror"
	| "flag"
	| "undo"
	| "reload"
	| "share"
	| "exit";

const PATHS: Readonly<Record<IconName, readonly string[]>> = {
	phone: [
		"M6.6 3.5h3l1.6 4.2-2 1.4a12 12 0 0 0 5.7 5.7l1.4-2 4.2 1.6v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z",
	],
	mic: [
		"M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z",
		"M5.5 11a6.5 6.5 0 0 0 13 0",
		"M12 17.5V21",
	],
	speaker: [
		"M4 9.5h3.5L12 5.5v13l-4.5-4H4z",
		"M15.5 9a4 4 0 0 1 0 6",
		"M18 6.5a7.5 7.5 0 0 1 0 11",
	],
	camera: ["M3.5 7.5h11v9h-11z", "M14.5 10.5l6-3v9l-6-3"],
	display: ["M3.5 4.5h17v11h-17z", "M12 15.5V20", "M8 20h8"],
	mirror: ["M12 3v18", "M9 7L3.5 17H9z", "M15 7l5.5 10H15z"],
	flag: ["M5.5 21V4", "M5.5 4.5h11l-2.5 4 2.5 4h-11"],
	undo: ["M9 14.5L4 9.5l5-5", "M4 9.5h10.5a5.5 5.5 0 0 1 0 11H11"],
	reload: ["M19.5 12a7.5 7.5 0 1 1-2.2-5.3", "M19.5 3.5v4h-4"],
	share: ["M12 14.5v-11", "M8 7.5l4-4 4 4", "M5.5 11.5v8h13v-8"],
	exit: ["M13.5 4.5h-8v15h8", "M10 12h10.5", "M17 8.5l3.5 3.5-3.5 3.5"],
};

function path(d: string, className?: string): SVGPathElement {
	const node = document.createElementNS(SVG_NS, "path");
	node.setAttribute("d", d);
	if (className) node.setAttribute("class", className);
	return node;
}

/** With `off`, a slash is a separate element, so "off" differs in shape and not only in colour. */
export function icon(name: IconName, off = false): SVGSVGElement {
	const svg = document.createElementNS(SVG_NS, "svg");
	svg.setAttribute("class", "icon");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("aria-hidden", "true");
	svg.setAttribute("focusable", "false");
	svg.append(...PATHS[name].map((d) => path(d)));
	if (off) svg.append(path("M3 3l18 18", "icon-slash"));
	return svg;
}

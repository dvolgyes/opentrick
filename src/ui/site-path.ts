export const ENTRY_PAGES = ["create", "solo", "join"] as const;
export type EntryPage = (typeof ENTRY_PAGES)[number];

/** Keep entry links inside the deployment directory, including GitHub Pages project sites. */
export function siteLocation(pathname: string): {
	root: string;
	page: EntryPage | "home";
} {
	if (
		!pathname.startsWith("/") ||
		pathname.startsWith("//") ||
		pathname.includes("\\")
	)
		return { root: "/", page: "home" };
	const entry = /^(.*\/)(create|solo|join)(?:\/(?:index\.html)?)?$/.exec(
		pathname,
	);
	if (entry) return { root: entry[1] as string, page: entry[2] as EntryPage };
	const root = pathname.replace(/index\.html$/, "");
	return { root: root.endsWith("/") ? root : `${root}/`, page: "home" };
}

export function sitePath(pathname: string, page: EntryPage | "home"): string {
	return siteLocation(pathname).root + (page === "home" ? "" : page);
}

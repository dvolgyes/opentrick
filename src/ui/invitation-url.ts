import { parseCommunityRoute } from "../community/link";
import { parseRoute } from "../p2p/link";
import { siteLocation } from "./site-path";

/** Accept only complete invitation URLs for this deployment, without changing their query or fragment. */
export function invitationUrl(
	text: string,
	pageUrl: string,
): string | undefined {
	const input = text.trim();
	if (input.length > 8192 || !URL.canParse(input) || !URL.canParse(pageUrl))
		return undefined;
	const url = new URL(input);
	const page = new URL(pageUrl);
	if (
		url.origin !== page.origin ||
		url.username !== "" ||
		url.password !== "" ||
		siteLocation(url.pathname).root !== siteLocation(page.pathname).root
	)
		return undefined;
	const community = parseCommunityRoute(url.hash);
	if (
		community
			? community.kind !== "party" && community.kind !== "game"
			: parseRoute(url.hash).kind !== "table"
	)
		return undefined;
	return url.href;
}

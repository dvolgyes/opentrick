import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
	BID_MODEL_BYTES,
	BidNetwork,
	LOCAL_BIDDERS,
} from "../src/bot/bid-network";

// The model data is Apache-2.0, independently checked against the original BRL tensors.
// No code from the model converter's hosting application is incorporated.
const revision = "92a81b5e81cb7aac2eabc147e82f18e0040b512e";
await mkdir("public/bot-models", { recursive: true });
for (const policy of LOCAL_BIDDERS) {
	const path = `public/bot-models/brl-${policy}.f32`;
	if (existsSync(path)) {
		const bytes = await readFile(path);
		new BidNetwork(
			bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
			policy,
		);
		continue;
	}
	console.error(`Downloading the ${policy} local bidding weights (14.7 MB).`);
	const url = `https://raw.githubusercontent.com/brannondorsey/nickel-bridge/${revision}/packages/ai/models/${policy}.bin`;
	const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
	if (!response.ok || !response.body)
		throw new Error(
			`could not download ${policy} bidding model: HTTP ${response.status}`,
		);
	const data = new Uint8Array(BID_MODEL_BYTES);
	let offset = 0;
	for await (const chunk of response.body) {
		if (offset + chunk.length > data.length)
			throw new Error("bidding model exceeds the expected size");
		data.set(chunk, offset);
		offset += chunk.length;
	}
	if (offset !== data.length)
		throw new Error("bidding model download is incomplete");
	new BidNetwork(data.buffer, policy);
	await writeFile(path, data);
}

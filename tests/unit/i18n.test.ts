import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	detectLocale,
	type Locale,
	missingMessageKeys,
	translatedMessageKeys,
	translator,
} from "../../src/i18n";
import { additionalCatalogs } from "../../src/i18n-translations";
import { BIDDER_NAMES } from "../../src/ui/model";

const newLocales = [
	"es",
	"pt",
	"fr",
	"it",
	"nl",
] as const satisfies readonly Locale[];

/** Each text that the source gives a translator as a string literal, such as t("Pass") or deps.t("Pass"). */
function translatedSourceTexts(): string[] {
	const src = new URL("../../src/", import.meta.url);
	const texts = new Set<string>();
	for (const file of readdirSync(src, { recursive: true, encoding: "utf8" })) {
		if (!file.endsWith(".ts")) continue;
		const code = readFileSync(new URL(file, src), "utf8");
		for (const [, literal] of code.matchAll(/\bt\(\s*("(?:[^"\\]|\\.)*")/g))
			texts.add(JSON.parse(literal ?? ""));
	}
	return [...texts].sort();
}

describe("localization", () => {
	it("has a catalog key for each text that the source translates", () => {
		const texts = translatedSourceTexts();
		expect(texts.length).toBeGreaterThan(250);
		const keys = new Set(translatedMessageKeys);
		expect(texts.filter((text) => !keys.has(text))).toEqual([]);
	});

	it.each(["de", "hu", "no", ...newLocales] as const)(
		"has every key in the %s catalog",
		(locale) => {
			expect(missingMessageKeys(locale)).toEqual([]);
		},
	);

	it("detects each supported language from regional browser preferences", () => {
		const cases = [
			["es-MX", "es"],
			["pt-BR", "pt"],
			["fr-CA", "fr"],
			["it-IT", "it"],
			["nl-NL", "nl"],
		] as const;

		for (const [preference, locale] of cases) {
			expect(detectLocale([preference], undefined)).toBe(locale);
		}
	});

	it("provides every existing translation key in each new catalog", () => {
		const expected = [...translatedMessageKeys].sort();
		expect(new Set(expected).size).toBe(expected.length);

		for (const locale of newLocales) {
			expect(Object.keys(additionalCatalogs[locale]).sort()).toEqual(expected);
		}
	});

	it("translates bridge terms and substitutes message values", () => {
		const cases = [
			["es", "Palo de triunfo", "Contrato: faltan 2 / 13"],
			["pt", "Naipe de trunfo", "Contrato: faltam 2 / 13"],
			["fr", "Couleur d'atout", "Contrat : 2 / 13 nécessaires"],
			["it", "Colore d'atout", "Contratto: servono 2 / 13"],
			["nl", "Troefkleur", "Contract: 2 / 13 nodig"],
		] as const satisfies readonly (readonly [Locale, string, string])[];

		for (const [locale, trump, contract] of cases) {
			const t = translator(locale);
			expect(t("Trump suit")).toBe(trump);
			expect(
				t("Contract needs {needed} / {remaining}", {
					needed: 2,
					remaining: 13,
				}),
			).toBe(contract);
		}
	});

	it("names the link button for the other players in every supported language", () => {
		const cases = [
			["en", "Send link to players"],
			["de", "Link an die Spieler senden"],
			["hu", "Link küldése"],
			["no", "Send lenke til spillerne"],
			["es", "Enviar enlace a los jugadores"],
			["pt", "Enviar ligação aos jogadores"],
			["fr", "Envoyer le lien aux joueurs"],
			["it", "Invia il link ai giocatori"],
			["nl", "Link naar spelers sturen"],
		] as const satisfies readonly (readonly [Locale, string])[];

		for (const [locale, text] of cases)
			expect(translator(locale)("Send link to players")).toBe(text);
	});

	it("translates declarer and dummy in every supported language", () => {
		const roles = [
			["de", "Alleinspieler", "Tisch"],
			["hu", "Felvevő", "Asztal"],
			["no", "Spillefører", "Blindemann"],
			["es", "Declarante", "Muerto"],
			["pt", "Declarante", "Morto"],
			["fr", "Déclarant", "Mort"],
			["it", "Dichiarante", "Morto"],
			["nl", "Leider", "Blinde"],
		] as const satisfies readonly (readonly [Locale, string, string])[];

		for (const [locale, declarer, dummy] of roles) {
			const t = translator(locale);
			expect(t("Declarer")).toBe(declarer);
			expect(t("Dummy")).toBe(dummy);
		}
	});

	it("labels autoplay as a bot option in every supported language", () => {
		const labels = {
			en: "Enable autoplay (bot)",
			de: "Autoplay (Bot) aktivieren",
			hu: "Automatikus játék (bot) bekapcsolása",
			no: "Slå på automatisk spilling (bot)",
			es: "Activar juego automático (bot)",
			pt: "Ativar jogo automático (bot)",
			fr: "Activer le jeu automatique (bot)",
			it: "Attiva il gioco automatico (bot)",
			nl: "Automatisch spelen (bot) aanzetten",
		} as const satisfies Record<Locale, string>;

		for (const [locale, label] of Object.entries(labels) as [
			Locale,
			string,
		][]) {
			expect(translator(locale)("Enable autoplay (bot)")).toBe(label);
		}
	});

	it("names both bidding bots as BRL policies and says in every supported language that SL imitates WBridge5", () => {
		const labels = {
			en: "BRL SL (WBridge5 imitation)",
			de: "BRL SL (WBridge5-Nachahmung)",
			hu: "BRL SL (WBridge5-utánzat)",
			no: "BRL SL (WBridge5-etterligning)",
			es: "BRL SL (imitación de WBridge5)",
			pt: "BRL SL (imitação do WBridge5)",
			fr: "BRL SL (imitation de WBridge5)",
			it: "BRL SL (imitazione di WBridge5)",
			nl: "BRL SL (WBridge5-imitatie)",
		} as const satisfies Record<Locale, string>;

		for (const [locale, label] of Object.entries(labels) as [
			Locale,
			string,
		][]) {
			const t = translator(locale);
			expect(t(BIDDER_NAMES.sl)).toBe(label);
			expect(t(BIDDER_NAMES["rl-fsp"])).toBe("BRL RL/FSP");
		}
	});

	it("translates the trick panel, the call presence, the bid box and the expired game in every supported language", () => {
		const texts = [
			"Current trick",
			"Trick count",
			"In call",
			"Your call",
			"Bidding history",
			"The game has expired or is no longer available",
		];
		for (const locale of ["de", "hu", "no", ...newLocales] as const)
			for (const text of texts)
				expect(translator(locale)(text), `${locale}: ${text}`).not.toBe(text);
		// A call in the auction is a bid, not a phone call.
		expect(newLocales.map((locale) => translator(locale)("Your call"))).toEqual(
			[
				"Tu voz",
				"A sua voz",
				"Votre enchère",
				"La tua dichiarazione",
				"Jouw bod",
			],
		);
	});
});

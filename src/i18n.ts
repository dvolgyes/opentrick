import { communityCatalogs } from "./i18n-community";
import { playerCatalogs } from "./i18n-players";
import { additionalCatalogs } from "./i18n-translations";

export type Locale =
	| "en"
	| "de"
	| "hu"
	| "no"
	| "es"
	| "pt"
	| "fr"
	| "it"
	| "nl";

export type Translate = (
	message: string,
	values?: Readonly<Record<string, string | number>>,
) => string;

type Catalog = Readonly<Record<string, string>>;

export const englishTranslator: Translate = (message, values = {}) =>
	message.replace(/\{([a-zA-Z0-9_]+)\}/g, (placeholder, key: string) =>
		String(values[key] ?? placeholder),
	);

const baseCatalogs: Readonly<Record<Exclude<Locale, "en">, Catalog>> = {
	de: {
		Language: "Sprache",
		Automatic: "Automatisch",
		North: "Norden",
		East: "Osten",
		South: "Süden",
		West: "Westen",
		N: "N",
		E: "O",
		S: "S",
		W: "W",
		and: "und",
		"ROOM CONNECTION": "RAUMVERBINDUNG",
		"Room lobby": "Raumlobby",
		"Network: measuring…": "Netzwerk: wird gemessen…",
		"Network: excellent": "Netzwerk: ausgezeichnet",
		"Network: good": "Netzwerk: gut",
		"Network: average": "Netzwerk: mittel",
		"Network: poor": "Netzwerk: schlecht",
		"Network: breaking up": "Netzwerk: Verbindung bricht ab",
		"Roundtrip: {seconds}sec": "Umlaufzeit: {seconds} s",
		"Roundtrip: >{seconds}sec": "Umlaufzeit: >{seconds} s",
		"Roundtrip times [s] (Row sender, column responder)":
			"Umlaufzeiten [s] (Zeile Sender, Spalte Antwortender)",
		"No measurement": "Keine Messung",
		"Bot timing": "Bot-Zeiten",
		"Minimum card time (seconds)": "Mindestzeit pro Karte (Sekunden)",
		"Minimum bid time (seconds)": "Mindestzeit pro Gebot (Sekunden)",
		"Pause after auction (seconds)": "Pause nach dem Reizen (Sekunden)",
		"Card thinking budget (seconds)": "Denkzeitbudget für Karten (Sekunden)",
		"Thinking time counts toward the minimum delay. Bot settings apply when this browser runs the bots.":
			"Die Denkzeit zählt zur Mindestwartezeit. Bot-Einstellungen gelten, wenn dieser Browser die Bots ausführt.",
		"Play starts in {seconds} seconds.":
			"Das Spiel beginnt in {seconds} Sekunden.",
		"Waiting for {players} to come back":
			"Warten auf die Rückkehr von {players}",
		"The first board is dealt now.": "Das erste Board wird jetzt gegeben.",
		WAITING: "WARTEN",
		"CONNECTING TO HOST": "VERBINDUNG ZUM HOST",
		"Enable autoplay (bot)": "Autoplay (Bot) aktivieren",
		"Enable bot": "Bot aktivieren",
		"No other human players are present.":
			"Es sind keine anderen menschlichen Spieler anwesend.",
		"Disable bot": "Bot deaktivieren",
		"Temporarily replace player with a bot":
			"Spieler vorübergehend durch einen Bot ersetzen",

		"Disable autoplay": "Autoplay deaktivieren",
		"Stop autoplay": "Autoplay stoppen",
		"Sending autoplay request…": "Autoplay-Anfrage wird gesendet…",
		"The host is playing your seat.": "Der Host spielt auf deinem Platz.",
		"Autoplay stopped.": "Autoplay gestoppt.",
		"Autoplay is unavailable on this host.":
			"Autoplay ist bei diesem Host nicht verfügbar.",
		"Autoplay request failed.": "Die Autoplay-Anfrage ist fehlgeschlagen.",
		"Autoplay stopped by the host.": "Der Host hat Autoplay gestoppt.",
		"Switch to bot": "Zu Bot wechseln",
		"Switch to player": "Zu Spieler wechseln",
		"Open this page over HTTPS.": "Öffne diese Seite über HTTPS.",
		"This browser cannot make calls.":
			"Dieser Browser kann keine Anrufe tätigen.",
		Connecting: "Verbindung wird hergestellt",
		"Choose your seat": "Wähle deinen Platz",
		"Create new game": "Neues Spiel erstellen",
		"Restart this game": "Dieses Spiel neu starten",
		"Creating…": "Wird erstellt…",
		"Check the bidding engine.": "Prüfe das Bietprogramm.",
		"Autoplay uses the local bridge engine.":
			"Autoplay verwendet das lokale Bridgeprogramm.",
		"The local bot failed. Resume bots to try again.":
			"Der lokale Bot ist fehlgeschlagen. Setze die Bots fort, um es erneut zu versuchen.",
		"Three-card support is not required.":
			"Drei Karten zur Unterstützung sind nicht erforderlich.",
		"at most {max} {suit} after the transfer was doubled":
			"Das lokale Bietprogramm läuft im Browser. Erlernte Konventionen können von SAYC abweichen.",
		"Optional automated players": "Optionale automatisierte Spieler",

		Seat: "Platz",
		Name: "Name",
		You: "Du",
		Bot: "Bot",
		"This is me": "Das bin ich",
		Scoring: "Wertung",
		Duplicate: "Duplikat",
		"Chicago (later)": "Chicago (später)",
		"Rubber (later)": "Rubber (später)",

		"This link is not valid. Check that you copied all of it.":
			"Dieser Link ist ungültig. Prüfe, ob du ihn vollständig kopiert hast.",
		"All seats are taken.": "Alle Plätze sind belegt.",
		"{seat} (host)": "{seat} (Host)",
		"{seat} (bot)": "{seat} (Bot)",
		"{seat} (taken)": "{seat} (belegt)",
		"{seat} (in another tab)": "{seat} (in einem anderen Tab)",
		"{seat} (waiting for the host)": "{seat} (wartet auf den Host)",
		"The game has expired or is no longer available":
			"Dieses Spiel ist abgelaufen oder nicht mehr verfügbar.",
		"Make me the host": "Mich zum Host machen",
		"Try seat again": "Platz erneut versuchen",
		Reload: "Neu laden",
		Network: "Netzwerk",
		"Copy link": "Link kopieren",
		Players: "Spieler",
		Messages: "Nachrichten",
		"Approve undo": "Rückgängigmachen bestätigen",
		"Reject undo": "Rückgängigmachen ablehnen",
		"Cancel undo": "Rückgängigmachen abbrechen",
		"Confirm claim": "Beanspruchen bestätigen",
		"Go back": "Zurück",
		"Previous game statistics": "Statistik der vorherigen Spiele",

		"Bots paused.": "Bots pausiert.",
		"Running {count} bot seat(s) with {engine}.":
			"{count} Bot-Platz/-Plätze aktiv mit {engine}.",
		Online: "Online",
		Offline: "Offline",
		Free: "Frei",
		Sending: "Wird gesendet",
		"Waiting for the host": "Warte auf den Host",
		"Not accepted": "Nicht angenommen",
		"Undone after a host change": "Nach einem Hostwechsel rückgängig gemacht",
		"Deal board {board}": "Board {board} geben",
		"Call {call}": "Gebot {call}",
		"Play {card}": "Spiele {card}",
		"No bot seats are active.": "Keine Bot-Plätze aktiv.",
		Primary: "Primär",
		Fallback: "Ausweichmodell",
		Backup: "Reserve",

		"Join call": "Anruf beitreten",
		"Leave call": "Anruf verlassen",
		"Rejoin the call": "Anruf erneut beitreten",
		Optional: "Optional",
		"room call": "Raumanruf",
		"Game actions": "Spielaktionen",
		"Send mic audio": "Mikrofonton senden",
		"Hear others: receive audio": "Andere hören: Ton empfangen",
		"Send camera": "Kamera senden",
		"Send camera video": "Kameravideo senden",
		"Camera preview": "Kameravorschau",
		"Choose camera": "Kamera auswählen",
		"The camera preview is no longer available.":
			"Die Kameravorschau ist nicht mehr verfügbar.",
		"Starting camera preview…": "Kameravorschau wird gestartet…",
		"No camera is available.": "Keine Kamera verfügbar.",
		"Camera access was denied.": "Der Kamerazugriff wurde verweigert.",
		"The camera is in use or unavailable.":
			"Die Kamera wird verwendet oder ist nicht verfügbar.",
		"The camera could not be started.":
			"Die Kamera konnte nicht gestartet werden.",
		"Camera {number}": "Kamera {number}",
		Mirror: "Spiegel",
		"Mirror my camera": "Spiegel: eigene Kamera zeigen",
		"VIDEO IN PROGRESS": "VIDEO LÄUFT",
		"The host started a room call.": "Der Host hat einen Raumanruf gestartet.",
		"Don't join": "Nicht beitreten",
		"See cameras: receive video": "Kameras ansehen: Video empfangen",
		"Undo request is being sent.": "Die Rückgängig-Anfrage wird gesendet.",
		"Claim request is being sent.":
			"Die Anfrage zum Beanspruchen wird gesendet.",
		"Another tab changed the table at the same time. Reload the page.":
			"Ein anderer Tab hat den Tisch gleichzeitig geändert. Lade die Seite neu.",
		"This browser could not save the table.":
			"Dieser Browser konnte den Tisch nicht speichern.",
		"This browser does not store data ({problem}). You can play, but you cannot become the host, and a reload loses this copy of the table.":
			"Dieser Browser speichert keine Daten ({problem}). Du kannst spielen, aber nicht Host werden. Beim Neuladen geht diese Tischkopie verloren.",
		"Too many messages are waiting. Wait until the host is connected.":
			"Zu viele Nachrichten warten. Warte, bis der Host verbunden ist.",
		"Another player took this seat. Choose another one.":
			"Ein anderer Spieler hat diesen Platz genommen. Wähle einen anderen.",
		"This seat cannot be taken.": "Dieser Platz kann nicht genommen werden.",
		"The host could not save the table. Try again.":
			"Der Host konnte den Tisch nicht speichern. Versuche es erneut.",
		"The host changed. Try again.":
			"Der Host hat gewechselt. Versuche es erneut.",
		"The player is online again.": "Der Spieler ist wieder online.",
		"Only a seated player can release a seat.":
			"Nur ein Spieler mit Platz kann einen Platz freigeben.",
		"This seat cannot be released.":
			"Dieser Platz kann nicht freigegeben werden.",
		"The host could not save the table.":
			"Der Host konnte den Tisch nicht speichern.",
		"The request did not reach the host. Try again.":
			"Die Anfrage hat den Host nicht erreicht. Versuche es erneut.",
		"This page already holds a seat.": "Diese Seite hält bereits einen Platz.",
		"Another tab of this browser holds this seat.":
			"Ein anderer Tab dieses Browsers hält diesen Platz.",
		"The table is closed. Reload the page.":
			"Der Tisch ist geschlossen. Lade die Seite neu.",
		"Another tab of this browser is taking this seat. Try again.":
			"Ein anderer Tab dieses Browsers nimmt gerade diesen Platz. Versuche es erneut.",
		"The other players use another version of the app. Reload the page.":
			"Die anderen Spieler verwenden eine andere App-Version. Lade die Seite neu.",
		"This table has too many open pages":
			"Für diesen Tisch sind zu viele Seiten geöffnet.",
		"The host is online, but this device cannot reach it":
			"Der Host ist online, aber dieses Gerät kann ihn nicht erreichen.",
		"Becoming host…": "Host wird gewählt…",
		"A new host is taking over…": "Ein neuer Host übernimmt…",
		"Waiting for the host ({seconds} s)": "Warte auf den Host ({seconds} s)",
		"Nobody is at this table right now": "Niemand ist gerade am Tisch",
		"Direct connections": "Direktverbindungen",
		"Players checked": "Spieler geprüft",
		"Pages not reachable directly": "Seiten nicht direkt erreichbar",
		"Link repair rooms": "Verbindungsreparaturen",
		"Rejoins with no links": "Wiederbeitritte ohne Links",
		"Public address found": "Öffentliche Adresse gefunden",
		"Ignored wrong-key attempts": "Versuche mit falschem Schlüssel ignoriert",
		"not started": "nicht gestartet",
		none: "keine",
		yes: "ja",
		no: "nein",
		"after connecting": "nach dem Verbinden",
		"Tracker {host}": "Tracker {host}",
		"Nostr relay {host}": "Nostr-Relay {host}",
		"MQTT broker {host}": "MQTT-Broker {host}",
		"STUN {host}": "STUN {host}",
		closed: "geschlossen",
		"heard {seconds} s ago": "vor {seconds} s gehört",
		"nothing heard yet": "noch nichts gehört",
		checking: "wird geprüft",
		answered: "geantwortet",
		"no answer": "keine Antwort",
		"WebRTC in this browser": "WebRTC in diesem Browser",
		missing: "fehlt",
		"Local candidates": "Lokale Kandidaten",
		works: "funktioniert",
		"This browser has WebRTC turned off, so this page cannot reach the other players. On an iPhone or iPad, Lockdown Mode turns WebRTC off: turn it off for this website in the website settings of Safari, or use another device.":
			"Dieser Browser hat WebRTC ausgeschaltet, daher kann diese Seite die anderen Spieler nicht erreichen. Auf einem iPhone oder iPad schaltet der Blockierungsmodus WebRTC aus: Schalte ihn in den Website-Einstellungen von Safari für diese Website aus, oder nutze ein anderes Gerät.",
		open: "offen",
		repaired: "repariert",
		"timed out": "Zeitüberschreitung",
		"memory only: a reload loses this copy":
			"nur im Speicher: Neuladen löscht diese Kopie",
		"kept by the browser": "vom Browser behalten",
		"stored; the browser may clear it":
			"gespeichert; der Browser kann es löschen",
		"stored in this browser": "in diesem Browser gespeichert",
		"Your hand": "Deine Hand",
		"Game board": "Spielfeld",
		"Other players": "Andere Spieler",
		"Share URL": "URL teilen",
		"Share action completed.": "Teilen abgeschlossen.",
		"Could not share the board URL.":
			"Die Tisch-URL konnte nicht geteilt werden.",
		"Deals won": "Gewonnene Boards",
		"Deals lost": "Verlorene Boards",
		"Total score": "Gesamtpunktzahl",
		Round: "Runde",
		"{points}p": "{points}P",
		HCP: "HCP",
		"corrected HCP": "korrigierte HCP",
		Vienna: "Wien",
		Reith: "Reith",
		"Four Aces": "Four Aces",
		Other: "Andere",
		"Milton/HCP (4-3-2-1)": "Milton/HCP (4-3-2-1)",
		"Corrected Milton HCP": "Korrigierte Milton-HCP",
		"Vienna (7-5-3-1)": "Wien (7-5-3-1)",
		"Reith (6-4-3-2-1)": "Reith (6-4-3-2-1)",
		"Four Aces (3-2-1-½)": "Four Aces (3-2-1-½)",
		Light: "Hell",
		Dark: "Dunkel",
		Appearance: "Darstellung",
		Theme: "Design",
		"Suit and rank font size": "Schriftgröße für Kartenfarben und Werte",
		"Suit colours": "Farben der Kartensymbole",
		"Board texture": "Tischtextur",
		"Texture strength": "Texturstärke",
		"Card texture": "Kartentextur",
		"Side panel texture": "Textur der Seitenleiste",
		"Paper texture in the light appearance":
			"Papiertextur in der hellen Darstellung",
		Shadows: "Schatten",
		"Shadow intensity and distance": "Schattenstärke und Abstand",
		Off: "Aus",
		Mild: "Schwach",
		Medium: "Mittel",
		Strong: "Stark",
		"Set {number}": "Satz {number}",
		"Set {number}: clubs {clubs}, diamonds {diamonds}, hearts {hearts}, spades {spades}":
			"Satz {number}: Kreuz {clubs}, Karo {diamonds}, Herz {hearts}, Pik {spades}",
		Black: "Schwarz",
		Red: "Rot",
		Green: "Grün",
		Blue: "Blau",
		Purple: "Violett",
		Yellow: "Gelb",
		Orange: "Orange",
		Pink: "Pink",
		Cyan: "Türkis",
		Normal: "Normal",
		Solarized: "Solarized",
		Selenized: "Selenized",
		Gruvbox: "Gruvbox",
		"Bidding system": "Reizsystem",
		"corr. HCP": "korr. HCP",
		"Show the points next to the cards": "Punkte neben den Karten zeigen",
		"Frame the player whose turn it is to bid":
			"Rahmen um den Spieler, der bieten muss",
		"Frame the player whose turn it is to play":
			"Rahmen um den Spieler, der spielen muss",
		"Show as text whose turn it is to bid": "Als Text zeigen, wer bieten muss",
		"Show as text whose turn it is to play":
			"Als Text zeigen, wer spielen muss",
		"Show the network quality": "Netzwerkqualität zeigen",
		"Show the voice box for a player without video":
			"Sprachanzeige für Spieler ohne Video zeigen",
		"Screen orientation": "Bildschirmausrichtung",
		"On a phone or tablet in landscape, show the desktop view":
			"Auf einem Smartphone oder Tablet im Querformat die Desktop-Ansicht zeigen",
		"On a computer with a portrait window, show the mobile view":
			"Auf einem Computer mit einem Fenster im Hochformat die mobile Ansicht zeigen",

		"Save settings": "Einstellungen speichern",
		Settings: "Einstellungen",
		"Turn and network display": "Anzeige von Zug und Netzwerk",
		Connection: "Verbindung",
		"Check the connection more often": "Die Verbindung öfter prüfen",
		"Turn this on if your network connection is unstable, for example on a train, on weak mobile data or on Wi-Fi that drops. The page then finds a lost connection sooner, and it sends a few more messages to the public relays.":
			"Schalte dies ein, wenn deine Netzwerkverbindung instabil ist, zum Beispiel im Zug, bei schwachen mobilen Daten oder bei WLAN mit Aussetzern. Die Seite erkennt dann eine verlorene Verbindung früher und sendet etwas mehr Nachrichten an die öffentlichen Relays.",
		Bots: "Bots",

		"This browser could not store the settings.":
			"Dieser Browser konnte die Einstellungen nicht speichern.",
		Target: "Ziel",
		Confirm: "Bestätigen",
		"Next board {board} in {seconds} second":
			"Nächstes Board {board} in {seconds} Sekunde",
		"Next board {board} in {seconds} seconds":
			"Nächstes Board {board} in {seconds} Sekunden",
		"Connected: {players}": "Verbunden: {players}",
		None: "Niemand",
		Host: "Host",
		Release: "Freigeben",
		"Confirm release": "Freigabe bestätigen",
		"Received by {receivedBy} of {of}": "Von {receivedBy} von {of} empfangen",
		"Pending — waiting for the host": "Ausstehend — wartet auf den Host",
		"Not sent: {reason}": "Nicht gesendet: {reason}",
		"Not sent: {reason}.": "Nicht gesendet: {reason}.",
		"Undo not sent: {reason}": "Rückgängigmachen nicht gesendet: {reason}",
		"Undo vote not sent: {reason}":
			"Abstimmung zum Rückgängigmachen nicht gesendet: {reason}",
		"Undo cancellation not sent: {reason}":
			"Abbruch des Rückgängigmachens nicht gesendet: {reason}",
		"Claim not sent: {reason}": "Beanspruchung nicht gesendet: {reason}",
		"Claim decision not sent: {reason}":
			"Entscheidung zur Beanspruchung nicht gesendet: {reason}",
		"Reset not sent: {reason}": "Zurücksetzen nicht gesendet: {reason}",
		"Reset approval not sent: {reason}":
			"Bestätigung zum Zurücksetzen nicht gesendet: {reason}",
		"Reset decision not sent: {reason}":
			"Entscheidung zum Zurücksetzen nicht gesendet: {reason}",
		"Reset cancellation not sent: {reason}":
			"Abbruch des Zurücksetzens nicht gesendet: {reason}",
		"Release failed: {reason}": "Freigabe fehlgeschlagen: {reason}",
		"Release failed: no host is connected. Try again later.":
			"Freigabe fehlgeschlagen: Kein Host verbunden. Versuche es später erneut.",
		"This browser does not allow storing data, so it cannot create a table.":
			"Dieser Browser erlaubt keine Datenspeicherung und kann daher keinen Tisch erstellen.",
		"This tab was superseded": "Dieser Tab wurde ersetzt",
		"another tab of this browser holds this seat now":
			"ein anderer Tab dieses Browsers hält diesen Platz jetzt",
		"another device holds this seat now":
			"ein anderes Gerät hält diesen Platz jetzt",
		"Connection failed: the other players were found, but no direct connection works. Try another network.":
			"Verbindung fehlgeschlagen: Die anderen Spieler wurden gefunden, aber keine Direktverbindung funktioniert. Versuche ein anderes Netzwerk.",
		Send: "Senden",
		"Stored; sent when a host is connected":
			"Gespeichert; wird gesendet, sobald ein Host verbunden ist",
		"Another player must be online to confirm":
			"Ein anderer Spieler muss online sein, um zu bestätigen",
		"Only a seated player can become the host":
			"Nur ein Spieler mit Platz kann Host werden",
		"If no host comes, the table starts again from the link":
			"Kommt kein Host, startet der Tisch über den Link neu",
		"This page has no copy of the table yet":
			"Diese Seite hat noch keine Kopie des Tisches",
		"This client cannot host the table":
			"Dieser Client kann den Tisch nicht hosten",
		"This browser cannot store the table":
			"Dieser Browser kann den Tisch nicht speichern",
		"This table cannot change its host again":
			"Der Host dieses Tisches kann nicht erneut wechseln",
		"{seat}: enter a name.": "{seat}: gib einen Namen ein.",
		"{seat}: use at most {max} characters.":
			"{seat}: höchstens {max} Zeichen verwenden.",
		"Choose your seat.": "Wähle deinen Platz.",
		"Could not create the game": "Das Spiel konnte nicht erstellt werden",
		"No direct connection to {names}.": "Keine Direktverbindung zu {names}.",
		"Connecting to {names}.": "Verbindung zu {names} wird hergestellt.",
		"Connected to {names}.": "Mit {names} verbunden.",
		"In the call; waiting for others to join.":
			"Im Anruf; warte darauf, dass andere beitreten.",
		"Joining the call…": "Anruf wird verbunden…",
		"Call messages are interrupted; reconnecting…":
			"Anrufnachrichten unterbrochen; Verbindung wird wiederhergestellt…",
		Waiting: "Wartend",
		"Not in call": "Nicht im Anruf",
		"In call": "Im Anruf",
		Reconnecting: "Verbindung wird wiederhergestellt",
		"Direct connection unavailable": "Direktverbindung nicht verfügbar",
		"Audio reception off": "Audioempfang aus",
		"Mic off": "Mikrofon aus",
		"Audio + video": "Audio + Video",
		"Audio only": "Nur Audio",
		"Video reception off": "Videoempfang aus",
		"Video reception off; {audio}": "Videoempfang aus; {audio}",
		"No working microphone: others cannot hear you.":
			"Kein funktionierendes Mikrofon: Andere können dich nicht hören.",
		"The browser blocks the microphone: others cannot hear you.":
			"Der Browser blockiert das Mikrofon: Andere können dich nicht hören.",
		"Asking for the microphone…": "Mikrofonzugriff wird angefragt…",
		"No working camera: others cannot see you.":
			"Keine funktionierende Kamera: Andere können dich nicht sehen.",
		"The browser blocks the camera: others cannot see you.":
			"Der Browser blockiert die Kamera: Andere können dich nicht sehen.",
		"Asking for the camera…": "Kamerazugriff wird angefragt…",
		"Video is not available on this device.":
			"Video ist auf diesem Gerät nicht verfügbar.",
		Retry: "Erneut versuchen",
		"Retry {name}": "{name} erneut versuchen",
		"Retry call connection to {name}":
			"Anrufverbindung zu {name} erneut versuchen",
		"Waiting for {players} to approve the reset.":
			"Warte auf die Zustimmung von {players} zum Zurücksetzen.",
		"Clipboard access is unavailable.":
			"Zugriff auf die Zwischenablage ist nicht verfügbar.",
		"Copied.": "Kopiert.",
		"Could not copy the link. Allow clipboard access and try again.":
			"Der Link konnte nicht kopiert werden. Erlaube den Zugriff auf die Zwischenablage und versuche es erneut.",
		"Room call": "Raumanruf",
		Storage: "Speicher",
		failed: "fehlgeschlagen",
		"Send this link to the three other players. Each one opens it and takes a seat.":
			"Sende diesen Link an die drei anderen Spieler. Jeder öffnet ihn und wählt einen Platz.",
		"At most {count} tracker URLs are allowed (VITE_TRACKER_URLS).":
			"Es sind höchstens {count} Tracker-URLs erlaubt (VITE_TRACKER_URLS).",
		"Not a valid wss: tracker URL in VITE_TRACKER_URLS: {url}":
			"Ungültige wss:-Tracker-URL in VITE_TRACKER_URLS: {url}",
		"At most {count} STUN URLs are allowed (VITE_STUN_URLS).":
			"Es sind höchstens {count} STUN-URLs erlaubt (VITE_STUN_URLS).",
		"Not a valid stun: or stuns: URL in VITE_STUN_URLS: {url}":
			"Ungültige stun:- oder stuns:-URL in VITE_STUN_URLS: {url}",
		"TURN URLs are not supported; VITE_STUN_URLS takes stun: and stuns: URLs only.":
			"TURN-URLs werden nicht unterstützt. VITE_STUN_URLS akzeptiert nur stun:- und stuns:-URLs.",
		"You ask to undo your {action}. Your cancellation is being sent.":
			"Du möchtest dein {action} rückgängig machen. Der Abbruch wird gesendet.",
		"You ask to undo your {action}. {waiting}":
			"Du möchtest dein {action} rückgängig machen. {waiting}",
		"{requester} asks to undo their {action}. Your vote is being sent.":
			"{requester} möchte sein {action} rückgängig machen. Deine Stimme wird gesendet.",
		"{requester} asks to undo their {action}. Your approval is recorded. {waiting}":
			"{requester} möchte sein {action} rückgängig machen. Deine Zustimmung wurde erfasst. {waiting}",
		"{requester} asks to undo their {action}. {waiting}":
			"{requester} möchte sein {action} rückgängig machen. {waiting}",
		"Your claim for {count} {tricks} is waiting. {waiting}":
			"Deine Beanspruchung von {count} {tricks} wartet. {waiting}",
		"{requester} claims {count} {tricks}. Your decision is being sent.":
			"{requester} beansprucht {count} {tricks}. Deine Entscheidung wird gesendet.",
		"{requester} claims {count} {tricks}. You accepted. {waiting}":
			"{requester} beansprucht {count} {tricks}. Du hast zugestimmt. {waiting}",
		"{requester} claims {count} {tricks}. {waiting}":
			"{requester} beansprucht {count} {tricks}. {waiting}",
		"{requester} claims {count} {tricks}. Do you accept the claim?":
			"{requester} beansprucht {count} {tricks}. Nimmst du die Beanspruchung an?",
		"{requester} asks to undo their {action}. Do you approve?":
			"{requester} möchte sein {action} rückgängig machen. Stimmst du zu?",
		"Waiting for {players} to approve.":
			"Warte auf die Zustimmung von {players}.",
		"Waiting for {players} to decide.":
			"Warte auf die Entscheidung von {players}.",
		"{requester} asks to reset the game.":
			"{requester} bittet darum, das Spiel zurückzusetzen.",
		"last played card": "zuletzt gespielte Karte",
		"last bid": "letztes bid",
		"Ask to undo your {action}?":
			"Möchtest du bitten, dein {action} rückgängig zu machen?",
		"Ask to undo": "Rückgängigmachen anfragen",
		"Claim tricks": "Tricks beanspruchen",
		"Claim all remaining tricks": "Alle verbleibenden Tricks beanspruchen",
		"Number of tricks to claim": "Anzahl der zu beanspruchenden Tricks",
		"Bidding history": "Gebotsverlauf",
		"Current trick": "Aktueller Stich",
		"Trick count": "Anzahl der Stiche",
		"Trump suit": "Trumpffarbe",
		"Our tricks": "Unsere Stiche",
		"Contract needs {needed} / {remaining}": "Kontrakt: {needed} / {remaining}",
		"Contract secured": "Kontrakt erfüllt",
		"Contract defeated": "Kontrakt gescheitert",
		"Board {number}": "Board {number}",
		"Dealer: {dealer}": "Geber: {dealer}",
		AUCTION: "REIZUNG",
		"N-S": "N-S",
		"E-W": "O-W",
		Declarer: "Alleinspieler",
		Dummy: "Tisch",
		"Tricks: N-S {ns} · E-W {ew}": "Stiche: N-S {ns} · O-W {ew}",
		"Made contract": "Kontrakt erfüllt",
		"Made +{margin}": "Überstiche: {margin}",
		"Made: {contract}": "Erfüllt: {contract}",
		"Made: {contract} + {margin}": "Erfüllt: {contract} + {margin}",
		"Opponents made: {contract}": "Gegner erfüllen: {contract}",
		"Opponents made: {contract} + {margin}":
			"Gegner erfüllen: {contract} + {margin}",
		"Down {margin}": "Unterstiche: {margin}",
		"Opponents made contract": "Gegner erfüllen den Kontrakt",
		"Opponents made +{margin}": "Gegner erfüllen mit {margin} Überstichen",
		"Opponents down {margin}": "Gegner fallen {margin} Stich(e)",
		by: "von",
		trick: "Stich",
		tricks: "Stiche",
		WON: "GEWONNEN",
		LOST: "VERLOREN",
		"PASSED OUT": "DURCHGEPASST",
		Contract: "Kontrakt",
		"N-S vulnerable": "N-S in Gefahr",
		"N-S not vulnerable": "N-S nicht in Gefahr",
		"E-W vulnerable": "O-W in Gefahr",
		"E-W not vulnerable": "O-W nicht in Gefahr",
		vulnerable: "in Gefahr",
		"not vulnerable": "nicht in Gefahr",
		"How many of the remaining {count} tricks will you take?":
			"Wie viele der verbleibenden {count} Stiche machst du?",
		"Confirm that you claim all {count} remaining tricks.":
			"Bestätige, dass du alle {count} verbleibenden Tricks beanspruchst.",
		Undo: "Rückgängig machen",
		"Undo request": "Anfrage zum Rückgängigmachen",
		"Claim …": "Beanspruchen …",
		"Claim all": "Alle beanspruchen",
		"Accept claim": "Beanspruchung annehmen",
		"Reject claim": "Beanspruchung ablehnen",
		"Opponents'": "Gegner",
		"Pause bots": "Bots pausieren",
		"Resume bots": "Bots fortsetzen",
		"All players connected": "Alle Spieler verbunden",

		"The host could not change that seat.":
			"Der Host konnte diesen Platz nicht ändern.",
		"The host could not restore the saved bot seats.":
			"Der Host konnte die gespeicherten Bot-Plätze nicht wiederherstellen.",
		"Only the current host can run bots in this browser.":
			"Nur der aktuelle Host kann Bots in diesem Browser ausführen.",

		"Bots could not start. Check that this page is the ready host.":
			"Die Bots konnten nicht starten. Prüfe, ob diese Seite der aktive Host ist.",
		"Host changed. Bots stopped.":
			"Der Host hat gewechselt. Bots wurden angehalten.",
		"Approve reset": "Zurücksetzen bestätigen",
		"Reject reset": "Zurücksetzen ablehnen",
		"Cancel reset": "Zurücksetzen abbrechen",
		Cancel: "Abbrechen",
		"Create game": "Spiel erstellen",
		Reset: "Zurücksetzen",
		"Copy table link": "Tischlink kopieren",

		Message: "Nachricht",
		"Your call": "Dein Gebot",
		"Trackers reachable": "Tracker erreichbar",
		"Nostr relays reachable": "Nostr-Relays erreichbar",
		"MQTT brokers reachable": "MQTT-Broker erreichbar",
		"{open} of {total}": "{open} von {total}",
		"At most {count} Nostr relay URLs are allowed (VITE_NOSTR_RELAY_URLS).":
			"Es sind höchstens {count} Nostr-Relay-URLs erlaubt (VITE_NOSTR_RELAY_URLS).",
		"Not a valid wss: Nostr relay URL in VITE_NOSTR_RELAY_URLS: {url}":
			"Ungültige wss:-Nostr-Relay-URL in VITE_NOSTR_RELAY_URLS: {url}",
		"A URL cannot be both a tracker and a Nostr relay: {url}":
			"Eine URL kann nicht zugleich Tracker und Nostr-Relay sein: {url}",
		"At most {count} MQTT broker URLs are allowed (VITE_MQTT_BROKER_URLS).":
			"Es sind höchstens {count} MQTT-Broker-URLs erlaubt (VITE_MQTT_BROKER_URLS).",
		"Not a valid wss: MQTT broker URL in VITE_MQTT_BROKER_URLS: {url}":
			"Ungültige wss:-MQTT-Broker-URL in VITE_MQTT_BROKER_URLS: {url}",
		"A URL cannot be both an MQTT broker and a tracker or Nostr relay: {url}":
			"Eine URL kann nicht zugleich MQTT-Broker und Tracker oder Nostr-Relay sein: {url}",

		"YOUR TURN TO BID": "DU BIST MIT BIETEN DRAN",
		"{seat} TO BID": "{seat} IST MIT BIETEN DRAN",
		"YOUR TURN TO PLAY": "DU BIST AM ZUG",
		"{seat} TO PLAY": "{seat} IST AM ZUG",
		Bridge: "Bridge",
		"{game}: {name} ({seat})": "{game}: {name} ({seat})",
		"{game}: {name} ({seat}, host)": "{game}: {name} ({seat}, Host)",
		"TURN - {title}": "AM ZUG - {title}",
		Debug: "Debug",
		"Reload players": "Spieler neu laden",
		"Host controls": "Gastgeber-Steuerung",
		"Collecting the players' reports…":
			"Berichte der Spieler werden gesammelt…",
		"Debug export copied.": "Debug-Export kopiert.",
		"Could not copy the debug export. Allow clipboard access and try again.":
			"Der Debug-Export konnte nicht kopiert werden. Erlaube den Zugriff auf die Zwischenablage und versuche es erneut.",
		"Asked {count} pages to reload.":
			"{count} Seiten zum Neuladen aufgefordert.",
		"no report": "kein Bericht",
		"singleton honour {cards}": "Single-Honneur {cards}",
		"unsupported honours {cards}": "ungestützte Honneurs {cards}",
		"good suit {cards}": "gute Farbe {cards}",
		"4333 shape": "4333-Verteilung",
		"all four aces": "alle vier Asse",
		"void {suit} ({shape})": "Chicane {suit} ({shape})",
		"singleton {suit} ({shape})": "Single {suit} ({shape})",
		"doubleton {suit} ({shape})": "Doubleton {suit} ({shape})",
		Guide: "Anleitung",
		"(Convention: {calls})": "(Konvention: {calls})",
		"(Unconventional)": "(Unkonventionell)",
		"Bidding guide": "Reizleitfaden",
		Close: "Schließen",
		OK: "OK",
		double: "Kontra",
		redouble: "Rekontra",
		pass: "Passe",
		"The bidding guide could not be loaded.":
			"Die Reizanleitung konnte nicht geladen werden.",
		"{seat} to bid": "{seat} ist mit Bieten dran",
		"Your turn to play.": "Du bist am Zug.",
		"Your turn: play a card from dummy.":
			"Du bist am Zug: Spiele eine Karte vom Tisch.",
		"Waiting for {seat} to play.": "Warten, bis {seat} spielt.",
		"Waiting for {seat} to play from dummy.":
			"Warten, bis {seat} vom Tisch spielt.",
		"{contract} by {declarer}": "{contract} von {declarer}",
		"Loading the table…": "Der Tisch wird geladen…",
		"This room has no bridge table.": "Dieser Raum hat keinen Bridgetisch.",
		Pass: "Passe",
		Double: "Kontra",
		Redouble: "Rekontra",
		PASS: "PASSE",
		"Level {level}": "Stufe {level}",
		Clubs: "Kreuz",
		Diamonds: "Karo",
		Hearts: "Herz",
		Spades: "Pik",
		"No trump": "Ohne Trumpf",
		"Asking {engine} for a bid (attempt {attempt} of {attempts}).":
			"{engine} wird nach einem Gebot gefragt (Versuch {attempt} von {attempts}).",
		"Asking {engine} for a card play (attempt {attempt} of {attempts}).":
			"{engine} wird nach einer Karte gefragt (Versuch {attempt} von {attempts}).",

		"Still waiting for {engine} to return a decision.":
			"Warte noch auf eine Entscheidung von {engine}.",

		"Vienna points": "Wiener Punkte",
		"Reith points": "Reith-Punkte",
		"Four Aces points": "Four-Aces-Punkte",
		points: "Punkte",
		"{min}+ {scale}": "{min}+ {scale}",
		"{min}–{max} {scale}": "{min}–{max} {scale}",
		balanced: "ausgeglichen",
		"artificial and forcing": "künstlich und forcierend",
		"{min}+ {suit} support": "Unterstützung mit {min}+ {suit}",
		"weak two, a good {length}-card {suit} suit":
			"schwache Zwei, eine gute {suit}-Farbe mit {length} Karten",
		"preempt, a good {length}-card {suit} suit":
			"Sperreröffnung, eine gute {suit}-Farbe mit {length} Karten",
		"transfer, {min}+ {suit}": "Transfer, {min}+ {suit}",
		"Stayman, a {min}-card major": "Stayman, eine Oberfarbe mit {min} Karten",
		"weak, a {min}+ card minor": "schwach, eine Unterfarbe mit {min}+ Karten",
		"game try, invites game, {min}+ {suit}":
			"Partieversuch, lädt zur Partie ein, {min}+ {suit}",
		"competitive, no game invitation, {min}+ {suit}":
			"kompetitiv, keine Partieeinladung, {min}+ {suit}",
		waiting: "Wartegebot",
		"no other guide call fits":
			"kein anderes Gebot aus dem Reizleitfaden passt",
		"a good {min}+ card {suit} suit":
			"eine gute {suit}-Farbe mit {min}+ Karten",
		"no {min}-card major": "keine Oberfarbe mit {min} Karten",
		"completes the transfer to {suit}": "vollzieht den Transfer nach {suit}",
		"forced, any hand": "erzwungen, jede Hand",
		"asks opener to describe the hand": "fragt den Eröffner nach seinem Blatt",
		"balanced, a {suit} stopper": "ausgeglichen, Stopper in {suit}",
		"takeout, short in {suit}, or {strong}":
			"Informationskontra, kurz in {suit}, oder {strong}",
		"Blackwood, asks for aces: a small slam needs about {small} together, a grand slam about {grand}":
			"Blackwood, fragt nach Assen: ein Kleinschlemm braucht zusammen etwa {small}, ein Großschlemm etwa {grand}",
		"Blackwood: {small}/{grand}": "Blackwood: {small}/{grand}",
		"Aces: {answers}": "Asse: {answers}",
		"aces: {counts}": "Asse: {counts}",
		"not in the guide": "nicht im Reizleitfaden",
	},
	hu: {
		Language: "Nyelv",
		Automatic: "Automatikus",
		North: "Észak",
		East: "Kelet",
		South: "Dél",
		West: "Nyugat",
		N: "É",
		E: "K",
		S: "D",
		W: "Ny",
		and: "és",
		"ROOM CONNECTION": "SZOBAKAPCSOLAT",
		"Room lobby": "Játékszoba várója",
		"Network: measuring…": "Hálózat: mérés…",
		"Network: excellent": "Hálózat: kiváló",
		"Network: good": "Hálózat: jó",
		"Network: average": "Hálózat: közepes",
		"Network: poor": "Hálózat: gyenge",
		"Network: breaking up": "Hálózat: akadozik",
		"Roundtrip: {seconds}sec": "Oda-vissza: {seconds} mp",
		"Roundtrip: >{seconds}sec": "Oda-vissza: >{seconds} mp",
		"Roundtrip times [s] (Row sender, column responder)":
			"Oda-vissza idők [s] (sor küldő, oszlop válaszoló)",
		"No measurement": "Nincs mérés",
		"Bot timing": "Botok időzítése",
		"Minimum card time (seconds)": "Kijátszás minimális ideje (másodperc)",
		"Minimum bid time (seconds)": "Licit minimális ideje (másodperc)",
		"Pause after auction (seconds)": "Szünet a licit után (másodperc)",
		"Card thinking budget (seconds)":
			"Kártyajáték gondolkodási kerete (másodperc)",
		"Thinking time counts toward the minimum delay. Bot settings apply when this browser runs the bots.":
			"A gondolkodási idő beleszámít a minimális várakozási időbe. A botbeállítások akkor érvényesek, amikor ez a böngésző futtatja a botokat.",
		"Play starts in {seconds} seconds.":
			"A játék {seconds} másodperc múlva kezdődik.",
		"Waiting for {players} to come back":
			"Várakozás, hogy visszatérjenek: {players}",
		"The first board is dealt now.": "Az első leosztás most következik.",
		WAITING: "VÁRAKOZÁS",
		"CONNECTING TO HOST": "KAPCSOLÓDÁS A HOSTHOZ",
		"Enable autoplay (bot)": "Automatikus játék (bot) bekapcsolása",
		"Enable bot": "Bot bekapcsolása",
		"No other human players are present.": "Nincs jelen másik emberi játékos.",
		"Disable bot": "Bot kikapcsolása",
		"Temporarily replace player with a bot":
			"A játékos ideiglenes helyettesítése bottal",

		"Disable autoplay": "Automatikus játék kikapcsolása",
		"Stop autoplay": "Automatikus játék leállítása",
		"Sending autoplay request…": "Automatikus játék kérése…",
		"The host is playing your seat.": "A házigazda a te helyedben játszik.",
		"Autoplay stopped.": "Automatikus játék leállítva.",
		"Autoplay is unavailable on this host.":
			"Az automatikus játék nem érhető el ennél a házigazdánál.",
		"Autoplay request failed.": "Az automatikus játék kérése nem sikerült.",
		"Autoplay stopped by the host.":
			"A házigazda leállította az automatikus játékot.",
		"Switch to bot": "Váltás botra",
		"Switch to player": "Váltás játékosra",
		"Open this page over HTTPS.": "Nyisd meg ezt az oldalt HTTPS-en keresztül.",
		"This browser cannot make calls.":
			"Ez a böngésző nem tud hívásokat indítani.",
		Connecting: "Kapcsolódás",
		"Choose your seat": "Válassz helyet",
		"Create new game": "Új játék létrehozása",
		"Restart this game": "Játék újraindítása",
		"Create game": "Játék létrehozása",
		"Creating…": "Létrehozás…",
		"Check the bidding engine.": "Ellenőrizd a licitáló motort.",
		"Autoplay uses the local bridge engine.":
			"Az automatikus játék a helyi bridzsmotort használja.",
		"The local bot failed. Resume bots to try again.":
			"A helyi bot hibát észlelt. Az újrapróbáláshoz folytasd a botokat.",
		"Three-card support is not required.":
			"Nem szükséges háromlapos támogatás.",
		"at most {max} {suit} after the transfer was doubled":
			"A helyi licitálás a böngészőben fut. A tanult konvenciók eltérhetnek a SAYC-től.",
		"Optional automated players": "Opcionális automatizált játékosok",

		Seat: "Hely",
		Name: "Név",
		You: "Te",
		Bot: "Bot",
		"This is me": "Én vagyok",
		Scoring: "Pontozás",
		Duplicate: "Duplikált",
		"Chicago (later)": "Chicago (később)",
		"Rubber (later)": "Gumi (később)",

		"This link is not valid. Check that you copied all of it.":
			"Ez a hivatkozás érvénytelen. Ellenőrizd, hogy teljes egészében másoltad-e.",
		"All seats are taken.": "Minden hely foglalt.",
		"{seat} (host)": "{seat} (host)",
		"{seat} (bot)": "{seat} (bot)",
		"{seat} (taken)": "{seat} (foglalt)",
		"{seat} (in another tab)": "{seat} (egy másik lapon)",
		"{seat} (waiting for the host)": "{seat} (várakozás a hostra)",
		"The game has expired or is no longer available":
			"Ez a játék lejárt, vagy már nem érhető el.",
		"Make me the host": "Legyek én a host",
		"Try seat again": "Hely újrapróbálása",
		Reload: "Újratöltés",
		Network: "Hálózat",
		"Copy link": "Hivatkozás másolása",
		"Pause bots": "Botok felfüggesztése",
		"Resume bots": "Botok folytatása",
		Reset: "Nullázás",
		Players: "Játékosok",
		Messages: "Üzenetek",
		"Claim …": "További ütések …",
		"Claim all": "Mindent visz",
		Undo: "Visszavétel",
		"Approve undo": "Visszavonás jóváhagyása",
		"Reject undo": "Visszavonás elutasítása",
		"Cancel undo": "Visszavonás megszakítása",
		"Undo request": "Visszavonási kérelem",
		"Number of tricks to claim": "Igényelt ütések száma",
		"Confirm claim": "Igénylés megerősítése",
		"Go back": "Vissza",
		"Accept claim": "Igénylés elfogadása",
		"Reject claim": "Igénylés elutasítása",
		"Claim tricks": "További ütések",
		"Claim all remaining tricks": "Mindent visz",
		"Previous game statistics": "Előző játékok statisztikája",
		Target: "Cél",

		"Bots paused.": "A botok szünetelnek.",
		"No bot seats are active.": "Nincs aktív bothely.",
		"Running {count} bot seat(s) with {engine}.":
			"{count} bothely fut ezzel: {engine}.",
		Online: "Online",
		Offline: "Offline",
		Free: "Szabad",
		Sending: "Küldés",
		"Waiting for the host": "Várakozás a hostra",
		"Not accepted": "Elutasítva",
		"Undone after a host change": "Hostváltás miatt visszavonva",
		"Deal board {board}": "Osztás: {board}",
		"Call {call}": "Licit: {call}",
		"Play {card}": "Kijátszás: {card}",
		"Connected: {players}": "Kapcsolódva: {players}",
		Primary: "Elsődleges",
		Fallback: "Tartalék",
		Backup: "Másodlagos tartalék",

		"Join call": "Hívás",
		"Leave call": "Lerak",
		"Rejoin the call": "Újracsatlakozás a híváshoz",
		Optional: "Opcionális",
		"room call": "szobahívás",
		"Game actions": "Játékműveletek",
		"Send mic audio": "Hang küldés",
		"Hear others: receive audio": "Hang fogadás",
		"Send camera": "Videó küldés",
		"Send camera video": "Videó küldés",
		"Camera preview": "Kamera előnézet",
		"Choose camera": "Kamera kiválasztása",
		"The camera preview is no longer available.":
			"A kamera előnézete már nem érhető el.",
		"Starting camera preview…": "Kamera előnézet indítása…",
		"No camera is available.": "Nincs elérhető kamera.",
		"Camera access was denied.": "A kamera hozzáférés megtagadva.",
		"The camera is in use or unavailable.":
			"A kamera használatban van vagy nem érhető el.",
		"The camera could not be started.": "A kamera nem indítható el.",
		"Camera {number}": "Kamera {number}",
		Mirror: "Tükör",
		"Mirror my camera": "Tükör: saját kamera mutatása",
		"VIDEO IN PROGRESS": "VIDEÓADÁS FOLYAMATBAN",
		"The host started a room call.": "A host szobahívást indított.",
		"Don't join": "Nem csatlakozom",
		"See cameras: receive video": "Videó fogadás",
		"Undo request is being sent.":
			"A visszavonási kérelem küldése folyamatban.",
		"Claim request is being sent.": "Az igénylés küldése folyamatban.",
		"Another tab changed the table at the same time. Reload the page.":
			"Egy másik lap közben módosította az asztalt. Töltsd újra az oldalt.",
		"This browser could not save the table.":
			"A böngésző nem tudta menteni az asztalt.",
		"This browser does not store data ({problem}). You can play, but you cannot become the host, and a reload loses this copy of the table.":
			"A böngésző nem tárol adatokat ({problem}). Játszhatsz, de nem lehetsz host; újratöltéskor ez a példány elvész.",
		"Too many messages are waiting. Wait until the host is connected.":
			"Túl sok üzenet várakozik. Várj, amíg a host csatlakozik.",
		"Another player took this seat. Choose another one.":
			"Ezt a helyet egy másik játékos foglalta el. Válassz másikat.",
		"This seat cannot be taken.": "Ez a hely nem foglalható el.",
		"The host could not save the table. Try again.":
			"A host nem tudta menteni az asztalt. Próbáld újra.",
		"The host changed. Try again.": "Megváltozott a host. Próbáld újra.",
		"The player is online again.": "A játékos ismét online van.",
		"Only a seated player can release a seat.":
			"Csak egy helyet foglaló játékos adhatja fel a helyét.",
		"This seat cannot be released.": "Ez a hely nem adható fel.",
		"The host could not save the table.":
			"A host nem tudta menteni az asztalt.",
		"The request did not reach the host. Try again.":
			"A kérés nem jutott el a hosthoz. Próbáld újra.",
		"This page already holds a seat.": "Ez az oldal már foglal egy helyet.",
		"Another tab of this browser holds this seat.":
			"A böngésző egy másik lapja foglalja ezt a helyet.",
		"The table is closed. Reload the page.":
			"Az asztal lezárult. Töltsd újra az oldalt.",
		"Another tab of this browser is taking this seat. Try again.":
			"A böngésző egy másik lapja éppen elfoglalja ezt a helyet. Próbáld újra.",
		"The other players use another version of the app. Reload the page.":
			"A többi játékos az alkalmazás más verzióját használja. Töltsd újra az oldalt.",
		"This table has too many open pages":
			"Túl sok oldal van megnyitva ehhez az asztalhoz.",
		"The host is online, but this device cannot reach it":
			"A host online van, de ez az eszköz nem éri el.",
		"Becoming host…": "Host szerep átvétele…",
		"A new host is taking over…": "Új host veszi át az irányítást…",
		"Waiting for the host ({seconds} s)": "Várakozás a hostra ({seconds} mp)",
		"Nobody is at this table right now": "Most senki sincs az asztalnál",
		"Trackers reachable": "Elérhető trackerek",
		"Nostr relays reachable": "Elérhető Nostr-továbbítók",
		"MQTT brokers reachable": "Elérhető MQTT-brókerek",
		"{open} of {total}": "{total} közül {open}",
		"At most {count} Nostr relay URLs are allowed (VITE_NOSTR_RELAY_URLS).":
			"Legfeljebb {count} Nostr-továbbító URL használható (VITE_NOSTR_RELAY_URLS).",
		"Not a valid wss: Nostr relay URL in VITE_NOSTR_RELAY_URLS: {url}":
			"Érvénytelen wss: Nostr-továbbító URL a VITE_NOSTR_RELAY_URLS értékben: {url}",
		"A URL cannot be both a tracker and a Nostr relay: {url}":
			"Egy URL nem lehet egyszerre tracker és Nostr-továbbító: {url}",
		"At most {count} MQTT broker URLs are allowed (VITE_MQTT_BROKER_URLS).":
			"Legfeljebb {count} MQTT-bróker URL használható (VITE_MQTT_BROKER_URLS).",
		"Not a valid wss: MQTT broker URL in VITE_MQTT_BROKER_URLS: {url}":
			"Érvénytelen wss: MQTT-bróker URL a VITE_MQTT_BROKER_URLS értékben: {url}",
		"A URL cannot be both an MQTT broker and a tracker or Nostr relay: {url}":
			"Egy URL nem lehet egyszerre MQTT-bróker és tracker vagy Nostr-továbbító: {url}",
		"Direct connections": "Közvetlen kapcsolatok",
		"Players checked": "Ellenőrzött játékosok",
		"Pages not reachable directly": "Közvetlenül nem elérhető oldalak",
		"Link repair rooms": "Kapcsolatjavító szobák",
		"Rejoins with no links": "Visszalépések hivatkozás nélkül",
		"Public address found": "Nyilvános cím megtalálva",
		"Ignored wrong-key attempts": "Hibás kulcsú próbálkozások mellőzve",
		"not started": "nem indult el",
		none: "nincs",
		yes: "igen",
		no: "nem",
		"after connecting": "kapcsolódás után",
		"Tracker {host}": "Tracker: {host}",
		"Nostr relay {host}": "Nostr-továbbító: {host}",
		"MQTT broker {host}": "MQTT-bróker: {host}",
		"STUN {host}": "STUN: {host}",
		closed: "zárva",
		"heard {seconds} s ago": "{seconds} mp-e jelzett",
		"nothing heard yet": "még nem jelzett",
		checking: "ellenőrzés",
		answered: "válaszolt",
		"no answer": "nincs válasz",
		"WebRTC in this browser": "WebRTC ebben a böngészőben",
		missing: "hiányzik",
		"Local candidates": "Helyi jelöltek",
		works: "működik",
		"This browser has WebRTC turned off, so this page cannot reach the other players. On an iPhone or iPad, Lockdown Mode turns WebRTC off: turn it off for this website in the website settings of Safari, or use another device.":
			"Ez a böngésző kikapcsolta a WebRTC-t, ezért ez az oldal nem éri el a többi játékost. iPhone-on vagy iPaden a Zárolási mód (Lockdown Mode) kikapcsolja a WebRTC-t: kapcsold ki ennél a webhelynél a Safari webhelybeállításaiban, vagy használj másik eszközt.",
		open: "nyitott",
		repaired: "javítva",
		"timed out": "időtúllépés",
		"memory only: a reload loses this copy":
			"csak memóriában: újratöltéskor ez a példány elvész",
		"kept by the browser": "a böngésző megtartotta",
		"stored; the browser may clear it": "mentve; a böngésző törölheti",
		"stored in this browser": "ebben a böngészőben mentve",
		"Your hand": "A lapjaid",
		"Game board": "Játéktábla",
		"Other players": "Többi játékos",
		"Share URL": "Hivatkozás megosztása",
		"Share action completed.": "A megosztás befejeződött.",
		"Could not share the board URL.":
			"Nem sikerült megosztani az asztal hivatkozását.",
		"Deals won": "Megnyert leosztások",
		"Deals lost": "Elvesztett leosztások",
		"Total score": "Összpontszám",
		Round: "Forduló",
		"{points}p": "{points}p",
		HCP: "HCP",
		"corrected HCP": "korrigált HCP",
		Vienna: "Bécsi",
		Reith: "Reith",
		"Four Aces": "Four Aces",
		Other: "Egyéb",
		"Milton/HCP (4-3-2-1)": "Milton/HCP (4-3-2-1)",
		"Corrected Milton HCP": "Korrigált Milton HCP",
		"Vienna (7-5-3-1)": "Bécsi (7-5-3-1)",
		"Reith (6-4-3-2-1)": "Reith (6-4-3-2-1)",
		"Four Aces (3-2-1-½)": "Four Aces (3-2-1-½)",
		Light: "Világos",
		Dark: "Sötét",
		Appearance: "Megjelenés",
		Theme: "Téma",
		"Suit and rank font size": "Színjelek és lapértékek betűmérete",
		"Suit colours": "Színjelek színei",
		"Board texture": "Asztal textúrája",
		"Texture strength": "Textúra erőssége",
		"Card texture": "Kártyák textúrája",
		"Side panel texture": "Oldalsáv textúrája",
		"Paper texture in the light appearance":
			"Papírtextúra világos megjelenésnél",
		Shadows: "Árnyékok",
		"Shadow intensity and distance": "Árnyék erőssége és távolsága",
		Off: "Kikapcsolva",
		Mild: "Enyhe",
		Medium: "Közepes",
		Strong: "Erős",
		"Set {number}": "{number}. készlet",
		"Set {number}: clubs {clubs}, diamonds {diamonds}, hearts {hearts}, spades {spades}":
			"{number}. készlet: treff {clubs}, káró {diamonds}, kőr {hearts}, pikk {spades}",
		Black: "Fekete",
		Red: "Piros",
		Green: "Zöld",
		Blue: "Kék",
		Purple: "Lila",
		Yellow: "Sárga",
		Orange: "Narancs",
		Pink: "Rózsaszín",
		Cyan: "Cián",
		Normal: "Normál",
		Solarized: "Solarized",
		Selenized: "Selenized",
		Gruvbox: "Gruvbox",
		"Bidding system": "Licitrendszer",
		"corr. HCP": "korr. HCP",
		"Show the points next to the cards": "Pontok mutatása a lapok mellett",
		"Frame the player whose turn it is to bid":
			"Keret a licitre következő játékos körül",
		"Frame the player whose turn it is to play":
			"Keret a lapra következő játékos körül",
		"Show as text whose turn it is to bid":
			"Szövegként mutassa, ki következik licitálni",
		"Show as text whose turn it is to play":
			"Szövegként mutassa, ki következik lapot tenni",
		"Show the network quality": "Hálózati minőség mutatása",
		"Show the voice box for a player without video":
			"Hangjelző mutatása a videó nélküli játékosnál",
		"Screen orientation": "Képernyő tájolása",
		"On a phone or tablet in landscape, show the desktop view":
			"Telefonon vagy táblagépen fekvő tájolásban az asztali nézet mutatása",
		"On a computer with a portrait window, show the mobile view":
			"Számítógépen álló ablakban a mobilnézet mutatása",

		"Save settings": "Beállítások mentése",
		Settings: "Beállítások",
		"Turn and network display": "Soron következő és hálózat kijelzése",
		Connection: "Kapcsolat",
		"Check the connection more often": "A kapcsolat gyakoribb ellenőrzése",
		"Turn this on if your network connection is unstable, for example on a train, on weak mobile data or on Wi-Fi that drops. The page then finds a lost connection sooner, and it sends a few more messages to the public relays.":
			"Kapcsold be, ha a hálózati kapcsolatod instabil, például vonaton, gyenge mobilneten vagy akadozó Wi-Fi-n. Az oldal így hamarabb észreveszi a megszakadt kapcsolatot, és valamivel több üzenetet küld a nyilvános továbbítóknak.",
		Bots: "Botok",

		"This browser could not store the settings.":
			"Ez a böngésző nem tudta tárolni a beállításokat.",
		"Opponents'": "Ellenfél",
		"Bidding history": "Licitek",
		"Current trick": "Aktuális ütés",
		"Trick count": "Ütések száma",
		"Your call": "A te licited",
		"Trump suit": "Aduszín",
		"Our tricks": "Ütések",
		"Contract needs {needed} / {remaining}": "Vállalás: {needed} / {remaining}",
		"Contract secured": "Teljesített vállalás",
		"Contract defeated": "Elbukott vállalás",
		"Board {number}": "{number}. leosztás",
		"Dealer: {dealer}": "Osztó: {dealer}",
		AUCTION: "LICITÁLÁS",
		"N-S": "É-D",
		"E-W": "K-Ny",
		Declarer: "Felvevő",
		Dummy: "Asztal",
		"Tricks: N-S {ns} · E-W {ew}": "Ütések: É-D {ns} · K-Ny {ew}",
		"Made contract": "Teljesített vállalás",
		"Made +{margin}": "Többlet: {margin}",
		"Made: {contract}": "Teljesítve: {contract}",
		"Made: {contract} + {margin}": "Teljesítve: {contract} + {margin}",
		"Opponents made: {contract}": "Ellenfél teljesítette: {contract}",
		"Opponents made: {contract} + {margin}":
			"Ellenfél teljesítette: {contract} + {margin}",
		"Down {margin}": "Bukás: {margin}",
		"Opponents made contract": "Az ellenfél teljesítette a vállalást",
		"Opponents made +{margin}": "Az ellenfél többlete: {margin}",
		"Opponents down {margin}": "Az ellenfél bukása: {margin}",
		by: "–",
		trick: "ütés",
		tricks: "ütés",
		WON: "NYERT",
		LOST: "VESZTETT",
		"PASSED OUT": "KIPASSZOLVA",
		Contract: "Vállalás",
		"N-S vulnerable": "É-D bellben",
		"N-S not vulnerable": "É-D mansban",
		"E-W vulnerable": "K-Ny bellben",
		"E-W not vulnerable": "K-Ny mansban",
		vulnerable: "bellben",
		"not vulnerable": "mansban",
		Confirm: "Megerősítés",
		"Next board {board} in {seconds} second":
			"Következő parti {board}, {seconds} másodperc múlva",
		"Next board {board} in {seconds} seconds":
			"Következő parti {board}, {seconds} másodperc múlva",
		None: "Senki",
		Host: "Host",
		Release: "Feladás",
		"Confirm release": "Feladás megerősítése",
		"Received by {receivedBy} of {of}": "{of} játékosból {receivedBy} megkapta",
		"Pending — waiting for the host": "Függőben — várakozás a hostra",
		"Not sent: {reason}": "Nem ment el: {reason}",
		"Not sent: {reason}.": "Nem ment el: {reason}.",
		"Undo not sent: {reason}": "A visszavonás nem ment el: {reason}",
		"Undo vote not sent: {reason}":
			"A visszavonási szavazat nem ment el: {reason}",
		"Undo cancellation not sent: {reason}":
			"A visszavonás megszakítása nem ment el: {reason}",
		"Claim not sent: {reason}": "Az ütésigénylés nem ment el: {reason}",
		"Claim decision not sent: {reason}":
			"Az ütésigénylésről szóló döntés nem ment el: {reason}",
		"Reset not sent: {reason}": "A visszaállítás nem ment el: {reason}",
		"Reset approval not sent: {reason}":
			"A visszaállítás jóváhagyása nem ment el: {reason}",
		"Reset decision not sent: {reason}":
			"A visszaállításról szóló döntés nem ment el: {reason}",
		"Reset cancellation not sent: {reason}":
			"A visszaállítás megszakítása nem ment el: {reason}",
		"Release failed: {reason}": "A feladás nem sikerült: {reason}",
		"Release failed: no host is connected. Try again later.":
			"A feladás nem sikerült: nincs csatlakozott host. Próbáld később.",
		"All players connected": "Minden játékos csatlakozott",

		"The host could not change that seat.":
			"A host nem tudta módosítani ezt a helyet.",
		"The host could not restore the saved bot seats.":
			"A host nem tudta visszaállítani a mentett bothelyeket.",
		"Only the current host can run bots in this browser.":
			"Ebben a böngészőben csak az aktuális host futtathat botokat.",

		"Bots could not start. Check that this page is the ready host.":
			"A botok nem indultak el. Ellenőrizd, hogy ez az oldal az aktív host-e.",
		"Host changed. Bots stopped.": "Megváltozott a host. A botok leálltak.",
		"Approve reset": "Visszaállítás jóváhagyása",
		"Reject reset": "Visszaállítás elutasítása",
		"Cancel reset": "Visszaállítás megszakítása",
		"Copy table link": "Asztal hivatkozásának másolása",
		"This browser does not allow storing data, so it cannot create a table.":
			"Ez a böngésző nem engedélyezi az adattárolást, ezért nem tud asztalt létrehozni.",
		"This tab was superseded": "Ezt a lapot felváltotta egy másik",
		"another tab of this browser holds this seat now":
			"a böngésző egy másik lapja foglalja ezt a helyet",
		"another device holds this seat now":
			"egy másik eszköz foglalja ezt a helyet",
		"Connection failed: the other players were found, but no direct connection works. Try another network.":
			"A kapcsolat nem sikerült: a többi játékos megtalálható, de nincs működő közvetlen kapcsolat. Próbálj másik hálózatot.",
		Send: "Küldés",
		"Stored; sent when a host is connected":
			"Mentve; a host csatlakozásakor elküldjük",
		"Another player must be online to confirm":
			"A megerősítéshez egy másik játékosnak online kell lennie",
		"Only a seated player can become the host":
			"Csak helyet foglaló játékos lehet host",
		"If no host comes, the table starts again from the link":
			"Ha nem jön host, az asztal a hivatkozásról újraindul",
		"This page has no copy of the table yet":
			"Ennek az oldalnak még nincs másolata az asztalról",
		"This client cannot host the table":
			"Ez a kliens nem hostolhatja az asztalt",
		"This browser cannot store the table":
			"Ez a böngésző nem tudja tárolni az asztalt",
		"This table cannot change its host again":
			"Ennek az asztalnak már nem váltható le a hostja",
		"{seat}: enter a name.": "{seat}: adj meg egy nevet.",
		"{seat}: use at most {max} characters.":
			"{seat}: legfeljebb {max} karaktert használj.",
		"Choose your seat.": "Válaszd ki a helyed.",
		"Could not create the game": "Nem sikerült létrehozni a játékot",
		"No direct connection to {names}.":
			"Nincs közvetlen kapcsolat vele: {names}.",
		"Connecting to {names}.": "Kapcsolódás ehhez: {names}.",
		"Connected to {names}.": "Kapcsolódva ehhez: {names}.",
		"In the call; waiting for others to join.":
			"A hívásban vagy; várakozás a többiekre.",
		"Joining the call…": "Csatlakozás a híváshoz…",
		"Call messages are interrupted; reconnecting…":
			"A hívás üzenetei megszakadtak; újracsatlakozás…",
		Waiting: "Várakozás",
		"Not in call": "Nincs a hívásban",
		"In call": "A hívásban",
		Reconnecting: "Újracsatlakozás",
		"Direct connection unavailable": "Közvetlen kapcsolat nem érhető el",
		"Audio reception off": "Hangfogadás kikapcsolva",
		"Mic off": "Mikrofon kikapcsolva",
		"Audio + video": "Hang + videó",
		"Audio only": "Csak hang",
		"Video reception off": "Videófogadás kikapcsolva",
		"Video reception off; {audio}": "Videófogadás kikapcsolva; {audio}",
		"No working microphone: others cannot hear you.":
			"Nem működik a mikrofon: a többiek nem hallanak.",
		"The browser blocks the microphone: others cannot hear you.":
			"A böngésző letiltja a mikrofont: a többiek nem hallanak.",
		"Asking for the microphone…": "Mikrofonengedély kérése…",
		"No working camera: others cannot see you.":
			"Nem működik a kamera: a többiek nem látnak.",
		"The browser blocks the camera: others cannot see you.":
			"A böngésző letiltja a kamerát: a többiek nem látnak.",
		"Asking for the camera…": "Kameraengedély kérése…",
		"Video is not available on this device.":
			"A videó nem érhető el ezen az eszközön.",
		Retry: "Újrapróbálás",
		"Retry {name}": "{name} újrapróbálása",
		"Retry call connection to {name}":
			"Újrapróbálkozás a híváskapcsolattal: {name}",
		Message: "Üzenet",
		"Waiting for {players} to approve the reset.":
			"Várakozás {players} jóváhagyására a visszaállításhoz.",
		"{requester} asks to reset the game.":
			"{requester} kéri a játék visszaállítását.",
		"Clipboard access is unavailable.": "A vágólap nem érhető el.",
		"Copied.": "Másolva.",
		"Could not copy the link. Allow clipboard access and try again.":
			"Nem sikerült másolni a hivatkozást. Engedélyezd a vágólap elérését, majd próbáld újra.",
		Cancel: "Mégse",

		"Room call": "Szobahívás",
		Storage: "Tárhely",
		failed: "sikertelen",
		"Send this link to the three other players. Each one opens it and takes a seat.":
			"Küldd el ezt a hivatkozást a másik három játékosnak. Mindenki nyissa meg és foglaljon helyet.",
		"At most {count} tracker URLs are allowed (VITE_TRACKER_URLS).":
			"Legfeljebb {count} tracker URL használható (VITE_TRACKER_URLS).",
		"Not a valid wss: tracker URL in VITE_TRACKER_URLS: {url}":
			"Érvénytelen wss: tracker URL a VITE_TRACKER_URLS értékben: {url}",
		"At most {count} STUN URLs are allowed (VITE_STUN_URLS).":
			"Legfeljebb {count} STUN URL használható (VITE_STUN_URLS).",
		"Not a valid stun: or stuns: URL in VITE_STUN_URLS: {url}":
			"Érvénytelen stun: vagy stuns: URL a VITE_STUN_URLS értékben: {url}",
		"TURN URLs are not supported; VITE_STUN_URLS takes stun: and stuns: URLs only.":
			"A TURN URL-ek nem támogatottak; a VITE_STUN_URLS csak stun: és stuns: URL-eket fogad el.",
		"Waiting for {players} to approve.": "Várakozás {players} jóváhagyására.",
		"Waiting for {players} to decide.": "Várakozás {players} döntésére.",
		"You ask to undo your {action}. Your cancellation is being sent.":
			"Kéred az utolsó {action} visszavonását. A visszavonási kérés elküldése folyamatban.",
		"You ask to undo your {action}. {waiting}":
			"Kéred az utolsó {action} visszavonását. {waiting}",
		"{requester} asks to undo their {action}. Your vote is being sent.":
			"{requester} kéri az utolsó {action} visszavonását. A szavazatod küldése folyamatban.",
		"{requester} asks to undo their {action}. Your approval is recorded. {waiting}":
			"{requester} kéri az utolsó {action} visszavonását. A jóváhagyásodat rögzítettük. {waiting}",
		"{requester} asks to undo their {action}. {waiting}":
			"{requester} kéri az utolsó {action} visszavonását. {waiting}",
		"Your claim for {count} {tricks} is waiting. {waiting}":
			"A {count} {tricks} igénylése folyamatban van. {waiting}",
		"{requester} claims {count} {tricks}. Your decision is being sent.":
			"{requester} {count} {tricks}-t igényel. A döntésed küldése folyamatban.",
		"{requester} claims {count} {tricks}. You accepted. {waiting}":
			"{requester} {count} {tricks}-t igényel. Elfogadtad. {waiting}",
		"{requester} claims {count} {tricks}. {waiting}":
			"{requester} {count} {tricks}-t igényel. {waiting}",
		"{requester} claims {count} {tricks}. Do you accept the claim?":
			"{requester} {count} {tricks}-t igényel. Elfogadod az igénylést?",
		"{requester} asks to undo their {action}. Do you approve?":
			"{requester} kéri az utolsó {action} visszavonását. Jóváhagyod?",
		"last played card": "utoljára kijátszott lap",
		"last bid": "utolsó bid",
		"Ask to undo your {action}?": "Kéred az {action} visszavonását?",
		"Ask to undo": "Visszavonás kérése",
		"How many of the remaining {count} tricks will you take?":
			"A hátralévő {count} ütésből hányat viszel el?",
		"Confirm that you claim all {count} remaining tricks.":
			"Erősítsd meg mind a hátralévő {count} Tricks igénylését.",
		"YOUR TURN TO BID": "TE LICITÁLSZ",
		"{seat} TO BID": "{seat} LICITÁL",
		"YOUR TURN TO PLAY": "TE KÖVETKEZEL",
		"{seat} TO PLAY": "{seat} KÖVETKEZIK",
		Bridge: "Bridzs",
		"{game}: {name} ({seat})": "{game}: {name} ({seat})",
		"{game}: {name} ({seat}, host)": "{game}: {name} ({seat}, host)",
		"TURN - {title}": "TE JÖSSZ - {title}",
		Debug: "Hibakeresés",
		"Reload players": "Játékosok újratöltése",
		"Host controls": "Házigazda eszközei",
		"Collecting the players' reports…": "A játékosok jelentéseinek gyűjtése…",
		"Debug export copied.": "Hibakeresési export másolva.",
		"Could not copy the debug export. Allow clipboard access and try again.":
			"A hibakeresési exportot nem sikerült másolni. Engedélyezd a vágólap elérését, és próbáld újra.",
		"Asked {count} pages to reload.": "{count} oldal újratöltése kérve.",
		"no report": "nincs jelentés",
		"singleton honour {cards}": "szingli figura {cards}",
		"unsupported honours {cards}": "támasz nélküli figurák {cards}",
		"good suit {cards}": "jó szín {cards}",
		"4333 shape": "4333 elosztás",
		"all four aces": "mind a négy ász",
		"void {suit} ({shape})": "{suit} színhiány ({shape})",
		"singleton {suit} ({shape})": "szingli {suit} ({shape})",
		"doubleton {suit} ({shape})": "kétlapos {suit} ({shape})",
		Guide: "Útmutató",
		"(Convention: {calls})": "(Konvenció: {calls})",
		"(Unconventional)": "(Nem konvencionális)",
		"Bidding guide": "Licitálási útmutató",
		Close: "Bezárás",
		OK: "OK",
		double: "kontra",
		redouble: "rekontra",
		pass: "passz",
		"The bidding guide could not be loaded.":
			"A licitálási útmutatót nem sikerült betölteni.",
		"{seat} to bid": "{seat} licitál",
		"Your turn to play.": "Te következel.",
		"Your turn: play a card from dummy.":
			"Te következel: játssz ki egy lapot az asztalról.",
		"Waiting for {seat} to play.": "Várakozás: {seat} játszik.",
		"Waiting for {seat} to play from dummy.":
			"Várakozás: {seat} játszik az asztalról.",
		"{contract} by {declarer}": "{contract}, felvevő: {declarer}",
		"Loading the table…": "Az asztal betöltése…",
		"This room has no bridge table.": "Ebben a szobában nincs bridzsasztal.",
		Pass: "Passz",
		Double: "Kontra",
		Redouble: "Rekontra",
		PASS: "PASSZ",
		"Level {level}": "{level}. szint",
		Clubs: "Treff",
		Diamonds: "Káró",
		Hearts: "Kőr",
		Spades: "Pikk",
		"No trump": "Szanzadu",
		"Asking {engine} for a bid (attempt {attempt} of {attempts}).":
			"Licit kérése: {engine} ({attempt}. kísérlet / {attempts}).",
		"Asking {engine} for a card play (attempt {attempt} of {attempts}).":
			"Lapkijátszás kérése: {engine} ({attempt}. kísérlet / {attempts}).",

		"Still waiting for {engine} to return a decision.":
			"Még várunk a döntésre: {engine}.",

		"Vienna points": "bécsi pont",
		"Reith points": "Reith pont",
		"Four Aces points": "Four Aces pont",
		points: "pont",
		"{min}+ {scale}": "{min}+ {scale}",
		"{min}–{max} {scale}": "{min}–{max} {scale}",
		balanced: "kiegyensúlyozott",
		"artificial and forcing": "mesterséges és forszírozó",
		"{min}+ {suit} support": "{suit} támogatás, {min}+ lap",
		"weak two, a good {length}-card {suit} suit":
			"gyenge kettes, jó {length} lapos {suit} szín",
		"preempt, a good {length}-card {suit} suit":
			"blokk, jó {length} lapos {suit} szín",
		"transfer, {min}+ {suit}": "transzfer, {min}+ {suit}",
		"Stayman, a {min}-card major": "Stayman, {min} lapos nemes szín",
		"weak, a {min}+ card minor": "gyenge, {min}+ lapos alacsony szín",
		"game try, invites game, {min}+ {suit}":
			"manche-kísérlet, manche-ra invitál, {min}+ {suit}",
		"competitive, no game invitation, {min}+ {suit}":
			"kompetitív, nem invitál manche-ra, {min}+ {suit}",
		waiting: "várakozó",
		"no other guide call fits": "az útmutatóban nincs más illő licit",
		"a good {min}+ card {suit} suit": "jó {min}+ lapos {suit} szín",
		"no {min}-card major": "nincs {min} lapos nemes szín",
		"completes the transfer to {suit}": "teljesíti a transzfert: {suit}",
		"forced, any hand": "kötelező, bármilyen lappal",
		"asks opener to describe the hand": "kéri, hogy a nyitó írja le a lapját",
		"balanced, a {suit} stopper": "kiegyensúlyozott, {suit} fogással",
		"takeout, short in {suit}, or {strong}":
			"informatív, rövid {suit}, vagy {strong}",
		"Blackwood, asks for aces: a small slam needs about {small} together, a grand slam about {grand}":
			"Blackwood, az ászokat kérdezi: kisszlemhez együtt kb. {small} kell, nagyszlemhez kb. {grand}",
		"Blackwood: {small}/{grand}": "Blackwood: {small}/{grand}",
		"Aces: {answers}": "Ászok: {answers}",
		"aces: {counts}": "ászok: {counts}",
		"not in the guide": "nincs az útmutatóban",
	},
	no: {
		Language: "Språk",
		Automatic: "Automatisk",
		North: "Nord",
		East: "Øst",
		South: "Sør",
		West: "Vest",
		N: "N",
		E: "Ø",
		S: "S",
		W: "V",
		and: "og",
		"ROOM CONNECTION": "ROMTILKOBLING",
		"Room lobby": "Romlobby",
		"Network: measuring…": "Nettverk: måler…",
		"Network: excellent": "Nettverk: utmerket",
		"Network: good": "Nettverk: godt",
		"Network: average": "Nettverk: middels",
		"Network: poor": "Nettverk: dårlig",
		"Network: breaking up": "Nettverk: faller ut",
		"Roundtrip: {seconds}sec": "Tur-retur: {seconds} s",
		"Roundtrip: >{seconds}sec": "Tur-retur: >{seconds} s",
		"Roundtrip times [s] (Row sender, column responder)":
			"Tur-retur-tider [s] (rad avsender, kolonne svarer)",
		"No measurement": "Ingen måling",
		"Bot timing": "Tidsinnstillinger for boter",
		"Minimum card time (seconds)": "Minstetid per kort (sekunder)",
		"Minimum bid time (seconds)": "Minstetid per melding (sekunder)",
		"Pause after auction (seconds)": "Pause etter meldingsforløpet (sekunder)",
		"Card thinking budget (seconds)": "Tenketid for kortspill (sekunder)",
		"Thinking time counts toward the minimum delay. Bot settings apply when this browser runs the bots.":
			"Tenketiden regnes med i minste ventetid. Botinnstillingene gjelder når denne nettleseren kjører botene.",
		"Play starts in {seconds} seconds.":
			"Spillet starter om {seconds} sekunder.",
		"Waiting for {players} to come back":
			"Venter på at {players} kommer tilbake",
		"The first board is dealt now.": "Den første given deles ut nå.",
		WAITING: "VENTER",
		"CONNECTING TO HOST": "KOBLER TIL VERTEN",
		"Enable autoplay (bot)": "Slå på automatisk spilling (bot)",
		"Enable bot": "Aktiver bot",
		"No other human players are present.":
			"Ingen andre menneskelige spillere er til stede.",
		"Disable bot": "Deaktiver bot",
		"Temporarily replace player with a bot":
			"Erstatt spilleren midlertidig med en bot",

		"Disable autoplay": "Slå av automatisk spilling",
		"Stop autoplay": "Stopp automatisk spilling",
		"Sending autoplay request…": "Sender forespørsel om automatisk spilling…",
		"The host is playing your seat.": "Verten spiller på plassen din.",
		"Autoplay stopped.": "Automatisk spilling er stoppet.",
		"Autoplay is unavailable on this host.":
			"Automatisk spilling er ikke tilgjengelig hos denne verten.",
		"Autoplay request failed.":
			"Forespørselen om automatisk spilling mislyktes.",
		"Autoplay stopped by the host.": "Verten stoppet automatisk spilling.",
		"Switch to bot": "Bytt til bot",
		"Switch to player": "Bytt til spiller",
		"Open this page over HTTPS.": "Åpne denne siden via HTTPS.",
		"The game has expired or is no longer available":
			"Spillet er utløpt eller ikke lenger tilgjengelig.",
		"This browser cannot make calls.": "Nettleseren kan ikke ringe.",
		"This browser does not allow storing data, so it cannot create a table.":
			"Nettleseren tillater ikke lagring og kan derfor ikke opprette et bord.",
		"This browser cannot store the table": "Nettleseren kan ikke lagre bordet.",
		Connecting: "Kobler til",
		"Choose your seat": "Velg plass",
		"Create new game": "Opprett nytt spill",
		"Restart this game": "Start dette spillet på nytt",
		"Create game": "Opprett spill",
		"Creating…": "Oppretter…",
		"Check the bidding engine.": "Kontroller meldemotoren.",
		"Autoplay uses the local bridge engine.":
			"Automatisk spilling bruker den lokale bridgemotoren.",
		"The local bot failed. Resume bots to try again.":
			"Den lokale boten feilet. Start botene igjen for å prøve på nytt.",
		"Three-card support is not required.": "Trekortsstøtte er ikke nødvendig.",
		"at most {max} {suit} after the transfer was doubled":
			"Lokal melding kjører i nettleseren. Innlærte konvensjoner kan avvike fra SAYC.",
		"Optional automated players": "Valgfrie automatiske spillere",

		Seat: "Plass",
		Name: "Navn",
		You: "Du",
		Bot: "Bot",
		"This is me": "Dette er meg",
		Scoring: "Poengberegning",
		Duplicate: "Duplikat",
		"Chicago (later)": "Chicago (senere)",
		"Rubber (later)": "Gummibridge (senere)",

		"All seats are taken.": "Alle plassene er opptatt.",
		"{seat} (host)": "{seat} (vert)",
		"{seat} (bot)": "{seat} (bot)",
		"{seat} (taken)": "{seat} (opptatt)",
		"{seat} (in another tab)": "{seat} (i en annen fane)",
		"{seat} (waiting for the host)": "{seat} (venter på verten)",
		"Make me the host": "Gjør meg til vert",
		"Try seat again": "Prøv plassen igjen",
		Reload: "Last inn på nytt",
		Network: "Nettverk",
		"Copy link": "Kopier lenke",
		"Pause bots": "Sett botene på pause",
		"Resume bots": "Fortsett med botene",
		Reset: "Nullstill",
		Players: "Spillere",
		Messages: "Meldinger",
		"Claim …": "Krev …",
		"Claim all": "Krev alle",
		Undo: "Angre",
		"Approve undo": "Godta angre",
		"Reject undo": "Avslå angre",
		"Cancel undo": "Avbryt angre",
		"Undo request": "Angreforespørsel",
		"Number of tricks to claim": "Antall stikk som kreves",
		"Confirm claim": "Bekreft kravet",
		"Go back": "Gå tilbake",
		"Accept claim": "Godta kravet",
		"Reject claim": "Avslå kravet",
		"Claim tricks": "Krev stikk",
		"Claim all remaining tricks": "Krev alle gjenværende stikk",
		"Previous game statistics": "Statistikk fra forrige spill",
		Target: "Mål",
		"Bots paused.": "Botene er satt på pause.",
		"No bot seats are active.": "Ingen botplasser er aktive.",
		Online: "Tilkoblet",
		Offline: "Frakoblet",
		Free: "Ledig",
		Sending: "Sender",
		"Waiting for the host": "Venter på verten",
		"Not accepted": "Ikke godtatt",
		"Undone after a host change": "Angret etter et vertsskifte",
		"Deal board {board}": "Del ut spill {board}",
		"Call {call}": "Meld {call}",
		"Play {card}": "Spill {card}",
		"Connected: {players}": "Tilkoblet: {players}",
		"Stored; sent when a host is connected":
			"Lagret; sendes når en vert er tilkoblet.",
		Primary: "Primær",
		Fallback: "Reserve",
		Backup: "Ekstra reserve",

		"Join call": "Bli med",
		"Leave call": "Legg på",
		"Rejoin the call": "Bli med igjen",
		Optional: "Valgfritt",
		"room call": "romsamtale",
		"Room call": "Romsamtale",
		"Game actions": "Spillhandlinger",
		"Send mic audio": "Send lyd",
		"Hear others: receive audio": "Motta lyd",
		"Send camera": "Send video",
		"Send camera video": "Send video",
		"Camera preview": "Kameraforhåndsvisning",
		"Choose camera": "Velg kamera",
		"The camera preview is no longer available.":
			"Forhåndsvisningen av kameraet er ikke lenger tilgjengelig.",
		"Starting camera preview…": "Starter kameraforhåndsvisning…",
		"No camera is available.": "Ingen kamera er tilgjengelig.",
		"Camera access was denied.": "Kameratilgang ble avslått.",
		"The camera is in use or unavailable.":
			"Kameraet er i bruk eller utilgjengelig.",
		"The camera could not be started.": "Kameraet kunne ikke startes.",
		"Camera {number}": "Kamera {number}",
		Mirror: "Speil",
		"Mirror my camera": "Speil: vis mitt kamera",
		"VIDEO IN PROGRESS": "VIDEO SENDES",
		"The host started a room call.": "Verten startet en romsamtale.",
		"Don't join": "Ikke bli med",
		"See cameras: receive video": "Motta video",
		"Claim request is being sent.": "Kravet sendes.",
		"This seat cannot be taken.": "Denne plassen kan ikke tas.",
		"The host changed. Try again.": "Verten er byttet ut. Prøv igjen.",
		"The player is online again.": "Spilleren er tilkoblet igjen.",
		"This seat cannot be released.": "Denne plassen kan ikke frigis.",
		"Only a seated player can become the host":
			"Bare en spiller med plass kan bli vert.",
		"If no host comes, the table starts again from the link":
			"Hvis ingen vert kommer, starter bordet på nytt fra lenken.",
		"This page has no copy of the table yet":
			"Denne siden har ingen kopi av bordet ennå.",
		"This client cannot host the table":
			"Denne klienten kan ikke være vert for bordet.",
		"This table cannot change its host again":
			"Verten for dette bordet kan ikke byttes igjen.",
		"Another player must be online to confirm":
			"En annen spiller må være tilkoblet for å bekrefte.",
		"another tab of this browser holds this seat now":
			"En annen fane i denne nettleseren har nå denne plassen.",
		"another device holds this seat now":
			"En annen enhet har nå denne plassen.",
		"This page already holds a seat.": "Denne siden har allerede en plass.",
		"Becoming host…": "Blir vert…",
		"A new host is taking over…": "En ny vert tar over…",
		"Waiting for the host ({seconds} s)": "Venter på verten ({seconds} s)",
		"Trackers reachable": "Sporingstjenester nås",
		"Nostr relays reachable": "Nostr-reléer nås",
		"MQTT brokers reachable": "MQTT-meglere nås",
		"{open} of {total}": "{open} av {total}",
		"At most {count} Nostr relay URLs are allowed (VITE_NOSTR_RELAY_URLS).":
			"Du kan angi maksimalt {count} Nostr-relé-URL-er (VITE_NOSTR_RELAY_URLS).",
		"Not a valid wss: Nostr relay URL in VITE_NOSTR_RELAY_URLS: {url}":
			"Ugyldig wss:-Nostr-relé-URL i VITE_NOSTR_RELAY_URLS: {url}",
		"A URL cannot be both a tracker and a Nostr relay: {url}":
			"En URL kan ikke være både tracker og Nostr-relé: {url}",
		"At most {count} MQTT broker URLs are allowed (VITE_MQTT_BROKER_URLS).":
			"Du kan angi maksimalt {count} MQTT-megler-URL-er (VITE_MQTT_BROKER_URLS).",
		"Not a valid wss: MQTT broker URL in VITE_MQTT_BROKER_URLS: {url}":
			"Ugyldig wss:-MQTT-megler-URL i VITE_MQTT_BROKER_URLS: {url}",
		"A URL cannot be both an MQTT broker and a tracker or Nostr relay: {url}":
			"En URL kan ikke være både MQTT-megler og tracker eller Nostr-relé: {url}",
		"Direct connections": "Direkte tilkoblinger",
		"Players checked": "Spillere kontrollert",
		"Pages not reachable directly": "Sider som ikke kan nås direkte",
		"Link repair rooms": "Reparasjonsrom for lenker",
		"Rejoins with no links": "Nye tilkoblinger uten lenker",
		"Public address found": "Offentlig adresse funnet",
		"Ignored wrong-key attempts": "Forsøk med feil nøkkel ignorert",
		"not started": "ikke startet",
		none: "ingen",
		yes: "ja",
		no: "nei",
		"after connecting": "etter tilkobling",
		"Tracker {host}": "Sporingstjeneste {host}",
		"Nostr relay {host}": "Nostr-relé {host}",
		"MQTT broker {host}": "MQTT-megler {host}",
		"STUN {host}": "STUN {host}",
		closed: "lukket",
		"heard {seconds} s ago": "hørt for {seconds} s siden",
		"nothing heard yet": "ingenting hørt ennå",
		checking: "sjekker",
		answered: "svarte",
		"no answer": "ikke svar",
		"WebRTC in this browser": "WebRTC i denne nettleseren",
		missing: "mangler",
		"Local candidates": "Lokale kandidater",
		works: "virker",
		"This browser has WebRTC turned off, so this page cannot reach the other players. On an iPhone or iPad, Lockdown Mode turns WebRTC off: turn it off for this website in the website settings of Safari, or use another device.":
			"Denne nettleseren har slått av WebRTC, så denne siden kan ikke nå de andre spillerne. På en iPhone eller iPad slår isolasjonsmodus (Lockdown Mode) av WebRTC: slå den av for dette nettstedet i nettstedsinnstillingene i Safari, eller bruk en annen enhet.",
		open: "åpen",
		repaired: "reparert",
		"timed out": "tidsavbrudd",
		"kept by the browser": "beholdt av nettleseren",
		"stored; the browser may clear it": "lagret; nettleseren kan slette det",
		"stored in this browser": "lagret i denne nettleseren",
		"Your hand": "Hånden din",
		"Game board": "Spillebord",
		"Other players": "Andre spillere",
		"Share URL": "Del URL",
		"Share action completed.": "Delingen er fullført.",
		"Deals won": "Vunne gitte",
		"Deals lost": "Tapte gitte",
		"Total score": "Poengsum totalt",
		Round: "Runde",
		"{points}p": "{points}p",
		HCP: "HCP",
		"corrected HCP": "korrigert HCP",
		Vienna: "Wien",
		Reith: "Reith",
		"Four Aces": "Four Aces",
		Other: "Annet",
		"Milton/HCP (4-3-2-1)": "Milton/HCP (4-3-2-1)",
		"Corrected Milton HCP": "Korrigert Milton-HCP",
		"Vienna (7-5-3-1)": "Wien (7-5-3-1)",
		"Reith (6-4-3-2-1)": "Reith (6-4-3-2-1)",
		"Four Aces (3-2-1-½)": "Four Aces (3-2-1-½)",
		Light: "Lys",
		Dark: "Mørk",
		Appearance: "Utseende",
		Theme: "Tema",
		"Suit and rank font size": "Skriftstørrelse for kortfarger og verdier",
		"Suit colours": "Farger for kortsymboler",
		"Board texture": "Bordtekstur",
		"Texture strength": "Teksturens styrke",
		"Card texture": "Korttekstur",
		"Side panel texture": "Tekstur på sidepanelet",
		"Paper texture in the light appearance": "Papirtekstur i lyst utseende",
		Shadows: "Skygger",
		"Shadow intensity and distance": "Skyggens styrke og avstand",
		Off: "Av",
		Mild: "Svak",
		Medium: "Middels",
		Strong: "Sterk",
		"Set {number}": "Sett {number}",
		"Set {number}: clubs {clubs}, diamonds {diamonds}, hearts {hearts}, spades {spades}":
			"Sett {number}: kløver {clubs}, ruter {diamonds}, hjerter {hearts}, spar {spades}",
		Black: "Svart",
		Red: "Rød",
		Green: "Grønn",
		Blue: "Blå",
		Purple: "Lilla",
		Yellow: "Gul",
		Orange: "Oransje",
		Pink: "Rosa",
		Cyan: "Cyan",
		Normal: "Normal",
		Solarized: "Solarized",
		Selenized: "Selenized",
		Gruvbox: "Gruvbox",
		"Bidding system": "Meldesystem",
		"corr. HCP": "korr. HCP",
		"Show the points next to the cards": "Vis poengene ved kortene",
		"Frame the player whose turn it is to bid":
			"Ramme rundt spilleren som skal melde",
		"Frame the player whose turn it is to play":
			"Ramme rundt spilleren som skal spille",
		"Show as text whose turn it is to bid": "Vis som tekst hvem som skal melde",
		"Show as text whose turn it is to play":
			"Vis som tekst hvem som skal spille",
		"Show the network quality": "Vis nettverkskvaliteten",
		"Show the voice box for a player without video":
			"Vis stemmeindikatoren for en spiller uten video",
		"Screen orientation": "Skjermretning",
		"On a phone or tablet in landscape, show the desktop view":
			"Vis skrivebordsvisningen på en telefon eller et nettbrett i liggende format",
		"On a computer with a portrait window, show the mobile view":
			"Vis mobilvisningen på en datamaskin med et vindu i stående format",

		"Save settings": "Lagre innstillinger",
		Settings: "Innstillinger",
		"Turn and network display": "Visning av tur og nettverk",
		Connection: "Tilkobling",
		"Check the connection more often": "Sjekk tilkoblingen oftere",
		"Turn this on if your network connection is unstable, for example on a train, on weak mobile data or on Wi-Fi that drops. The page then finds a lost connection sooner, and it sends a few more messages to the public relays.":
			"Slå på dette hvis nettverkstilkoblingen er ustabil, for eksempel på tog, med svak mobildata eller med Wi-Fi som faller ut. Siden oppdager da en tapt tilkobling raskere, og sender litt flere meldinger til de offentlige reléene.",
		Bots: "Boter",

		"This browser could not store the settings.":
			"Denne nettleseren kunne ikke lagre innstillingene.",
		"Opponents'": "Motstanderne",
		Confirm: "Bekreft",
		None: "Ingen",
		Host: "Vert",
		Release: "Frigi",
		"Confirm release": "Bekreft frigivelse",
		"Received by {receivedBy} of {of}": "Mottatt av {receivedBy} av {of}",
		"Pending — waiting for the host": "Venter på verten",
		"Not sent: {reason}": "Ikke sendt: {reason}",
		"Not sent: {reason}.": "Ikke sendt: {reason}.",
		"Undo not sent: {reason}": "Angreforespørselen ble ikke sendt: {reason}",
		"Undo request is being sent.": "Angreforespørselen sendes.",
		"Claim not sent: {reason}": "Kravet ble ikke sendt: {reason}",
		"Reset not sent: {reason}": "Nullstillingen ble ikke sendt: {reason}",
		"Release failed: {reason}": "Frigivelsen mislyktes: {reason}",
		"All players connected": "Alle spillerne er tilkoblet",
		"Host changed. Bots stopped.": "Verten er byttet. Botene er stoppet.",
		"Approve reset": "Godta nullstilling",
		"Reject reset": "Avslå nullstilling",
		"Cancel reset": "Avbryt nullstilling",
		"Copy table link": "Kopier bordlenken",
		"This tab was superseded": "Denne fanen ble erstattet",
		Send: "Send",
		"{seat}: enter a name.": "{seat}: skriv inn et navn.",
		"Choose your seat.": "Velg plassen din.",
		"Could not create the game": "Kunne ikke opprette spillet",
		"Connecting to {names}.": "Kobler til {names}.",
		"Connected to {names}.": "Tilkoblet {names}.",
		"Next board {board} in {seconds} second":
			"Neste spillbrett {board} om {seconds} sekund",
		"Next board {board} in {seconds} seconds":
			"Neste spillbrett {board} om {seconds} sekunder",
		"Joining the call…": "Kobler til samtalen…",
		"Your call": "Din melding",
		"Bidding history": "Meldingsforløp",
		Waiting: "Venter",
		"Not in call": "Ikke i samtalen",
		"In call": "I samtalen",
		Reconnecting: "Kobler til igjen",
		"Direct connection unavailable": "Direkte tilkobling er utilgjengelig",
		"In the call; waiting for others to join.":
			"I samtalen; venter på at de andre skal bli med.",
		"Call messages are interrupted; reconnecting…":
			"Samtalemeldinger er avbrutt; kobler til igjen…",
		"Audio reception off": "Lyd av",
		"Mic off": "Mikrofon av",
		"Audio + video": "Lyd + video",
		"Audio only": "Bare lyd",
		"Video reception off": "Video av",
		"Video reception off; {audio}": "Video av; {audio}",
		"Asking for the microphone…": "Ber om tilgang til mikrofonen…",
		"Asking for the camera…": "Ber om tilgang til kameraet…",
		"No working microphone: others cannot hear you.":
			"Ingen fungerende mikrofon: de andre kan ikke høre deg.",
		"The browser blocks the microphone: others cannot hear you.":
			"Nettleseren blokkerer mikrofonen: de andre kan ikke høre deg.",
		"No working camera: others cannot see you.":
			"Ingen fungerende kamera: de andre kan ikke se deg.",
		"The browser blocks the camera: others cannot see you.":
			"Nettleseren blokkerer kameraet: de andre kan ikke se deg.",
		"Video is not available on this device.":
			"Video er ikke tilgjengelig på denne enheten.",
		Retry: "Prøv igjen",
		"Retry {name}": "Prøv {name} igjen",
		Message: "Melding",
		"Clipboard access is unavailable.":
			"Tilgang til utklippstavlen er utilgjengelig.",
		"Could not copy the link. Allow clipboard access and try again.":
			"Kunne ikke kopiere lenken. Gi tilgang til utklippstavlen og prøv igjen.",
		"Copied.": "Kopiert.",
		Cancel: "Avbryt",

		Storage: "Lagring",
		failed: "mislyktes",
		"Waiting for {players} to approve.": "Venter på at {players} godkjenner.",
		"Waiting for {players} to decide.": "Venter på at {players} bestemmer seg.",
		"Waiting for {players} to approve the reset.":
			"Venter på at {players} godkjenner nullstillingen.",
		"last played card": "sist spilte kort",
		"last bid": "siste melding",
		"Ask to undo your {action}?": "Vil du be om å angre {action}?",
		"Ask to undo": "Be om angring",

		"Another tab changed the table at the same time. Reload the page.":
			"En annen fane endret bordet samtidig. Last inn siden på nytt.",
		"Another player took this seat. Choose another one.":
			"En annen spiller tok denne plassen. Velg en annen.",
		"Another tab of this browser holds this seat.":
			"En annen fane i denne nettleseren har denne plassen.",
		"Another tab of this browser is taking this seat. Try again.":
			"En annen fane i denne nettleseren tar denne plassen. Prøv igjen.",
		"At most {count} STUN URLs are allowed (VITE_STUN_URLS).":
			"Du kan angi maksimalt {count} STUN-URL-er (VITE_STUN_URLS).",
		"At most {count} tracker URLs are allowed (VITE_TRACKER_URLS).":
			"Du kan angi maksimalt {count} tracker-URL-er (VITE_TRACKER_URLS).",
		"Contract needs {needed} / {remaining}":
			"Kontrakten trenger {needed} / {remaining}",
		"Contract secured": "Kontrakten er vunnet",
		"Contract defeated": "Kontrakten gikk bet",
		"Board {number}": "Spill {number}",
		"Dealer: {dealer}": "Giver: {dealer}",
		AUCTION: "BUDGIVNING",
		"N-S": "N-S",
		"E-W": "Ø-V",
		Declarer: "Spillefører",
		Dummy: "Blindemann",
		"Tricks: N-S {ns} · E-W {ew}": "Stikk: N-S {ns} · Ø-V {ew}",
		"Made contract": "Kontrakten er vunnet",
		"Made +{margin}": "Overstikk: {margin}",
		"Made: {contract}": "Vunnet: {contract}",
		"Made: {contract} + {margin}": "Vunnet: {contract} + {margin}",
		"Opponents made: {contract}": "Motstanderne vant: {contract}",
		"Opponents made: {contract} + {margin}":
			"Motstanderne vant: {contract} + {margin}",
		"Down {margin}": "Bet: {margin}",
		"Opponents made contract": "Motstanderne vant kontrakten",
		"Opponents made +{margin}": "Motstanderne vant med {margin} overstikk",
		"Opponents down {margin}": "Motstanderne gikk {margin} bet",
		by: "av",
		trick: "stikk",
		tricks: "stikk",
		WON: "VANT",
		LOST: "TAPTE",
		"PASSED OUT": "ALLE PASSET",
		Contract: "Kontrakt",
		"N-S vulnerable": "N-S i sonen",
		"N-S not vulnerable": "N-S utenfor sonen",
		"E-W vulnerable": "Ø-V i sonen",
		"E-W not vulnerable": "Ø-V utenfor sonen",
		vulnerable: "i sonen",
		"not vulnerable": "utenfor sonen",
		"Bots could not start. Check that this page is the ready host.":
			"Botene kunne ikke starte. Kontroller at denne siden er verten og er klar.",

		"How many of the remaining {count} tricks will you take?":
			"Hvor mange av de {count} gjenværende stikkene tar du?",
		"Claim decision not sent: {reason}": "Kravet ble ikke sendt: {reason}",
		"Confirm that you claim all {count} remaining tricks.":
			"Bekreft at du krever alle de {count} gjenværende stikkene.",
		"Connection failed: the other players were found, but no direct connection works. Try another network.":
			"Tilkoblingen mislyktes: de andre spillerne ble funnet, men ingen direkte tilkobling fungerer. Prøv et annet nettverk.",
		"Could not share the board URL.": "Kunne ikke dele URL-en til bordet.",
		"Current trick": "Pågående stikk",

		"No direct connection to {names}.": "Ingen direkte tilkobling til {names}.",
		"Nobody is at this table right now": "Ingen sitter ved bordet nå",
		"Not a valid stun: or stuns: URL in VITE_STUN_URLS: {url}":
			"Ugyldig stun:- eller stuns:-URL i VITE_STUN_URLS: {url}",
		"Not a valid wss: tracker URL in VITE_TRACKER_URLS: {url}":
			"Ugyldig wss:-tracker-URL i VITE_TRACKER_URLS: {url}",
		"TURN URLs are not supported; VITE_STUN_URLS takes stun: and stuns: URLs only.":
			"TURN-URL-er støttes ikke. VITE_STUN_URLS godtar bare stun:- og stuns:-URL-er.",
		"Only a seated player can release a seat.":
			"Bare en spiller med plass kan frigi en plass.",
		"Only the current host can run bots in this browser.":
			"Bare den nåværende verten kan kjøre boter i denne nettleseren.",

		"Our tricks": "Våre stikk",
		"Release failed: no host is connected. Try again later.":
			"Frigivelsen mislyktes: ingen vert er tilkoblet. Prøv igjen senere.",
		"Reset approval not sent: {reason}":
			"Godkjenning av nullstilling ble ikke sendt: {reason}",
		"Reset cancellation not sent: {reason}":
			"Avbryting av nullstilling ble ikke sendt: {reason}",
		"Reset decision not sent: {reason}":
			"Avgjørelsen om nullstilling ble ikke sendt: {reason}",
		"Retry call connection to {name}":
			"Prøv å koble til samtalen med {name} igjen",
		"Running {count} bot seat(s) with {engine}.":
			"Kjører {count} botplasser med {engine}.",
		"Send this link to the three other players. Each one opens it and takes a seat.":
			"Send denne lenken til de tre andre spillerne. Alle åpner den og velger en plass.",

		"The host could not change that seat.":
			"Verten kunne ikke endre den plassen.",
		"The host could not restore the saved bot seats.":
			"Verten kunne ikke gjenopprette de lagrede botplassene.",
		"The host could not save the table.": "Verten kunne ikke lagre bordet.",
		"The host could not save the table. Try again.":
			"Verten kunne ikke lagre bordet. Prøv igjen.",
		"The host is online, but this device cannot reach it":
			"Verten er tilkoblet, men denne enheten får ikke kontakt med verten",
		"The other players use another version of the app. Reload the page.":
			"De andre spillerne bruker en annen versjon av appen. Last inn siden på nytt.",
		"The request did not reach the host. Try again.":
			"Forespørselen nådde ikke verten. Prøv igjen.",
		"The table is closed. Reload the page.":
			"Bordet er stengt. Last inn siden på nytt.",
		"This browser could not save the table.":
			"Nettleseren kunne ikke lagre bordet.",

		"This browser does not store data ({problem}). You can play, but you cannot become the host, and a reload loses this copy of the table.":
			"Nettleseren lagrer ikke data ({problem}). Du kan spille, men ikke bli vert. Hvis du laster inn siden på nytt, går denne bordkopien tapt.",
		"This link is not valid. Check that you copied all of it.":
			"Denne lenken er ugyldig. Kontroller at du kopierte hele lenken.",
		"This table has too many open pages":
			"For mange sider for dette bordet er åpne",
		"Too many messages are waiting. Wait until the host is connected.":
			"For mange meldinger venter. Vent til verten er tilkoblet.",
		"Trick count": "Antall stikk",
		"Trump suit": "Trumffarge",
		"Undo cancellation not sent: {reason}":
			"Avbryting av angreforespørselen ble ikke sendt: {reason}",
		"Undo vote not sent: {reason}":
			"Stemmen om å angre ble ikke sendt: {reason}",
		"YOUR TURN TO BID": "DIN TUR TIL Å MELDE",
		"{seat} TO BID": "{seat} SKAL MELDE",
		"YOUR TURN TO PLAY": "DIN TUR TIL Å SPILLE",
		"{seat} TO PLAY": "{seat} SKAL SPILLE",
		Bridge: "Bridge",
		"{game}: {name} ({seat})": "{game}: {name} ({seat})",
		"{game}: {name} ({seat}, host)": "{game}: {name} ({seat}, vert)",
		"TURN - {title}": "DIN TUR - {title}",
		"You ask to undo your {action}. Your cancellation is being sent.":
			"Du ber om å angre {action}. Avbrytingen sendes.",
		"You ask to undo your {action}. {waiting}":
			"Du ber om å angre {action}. {waiting}",
		"Your claim for {count} {tricks} is waiting. {waiting}":
			"Kravet ditt på {count} {tricks} venter. {waiting}",
		"memory only: a reload loses this copy":
			"bare i minnet: denne kopien går tapt hvis siden lastes inn på nytt",
		"{requester} asks to reset the game.":
			"{requester} ber om å nullstille spillet.",
		"{requester} asks to undo their {action}. Your approval is recorded. {waiting}":
			"{requester} ber om å angre {action}. Godkjenningen din er registrert. {waiting}",
		"{requester} asks to undo their {action}. Your vote is being sent.":
			"{requester} ber om å angre {action}. Stemmen din sendes.",
		"{requester} asks to undo their {action}. {waiting}":
			"{requester} ber om å angre {action}. {waiting}",
		"{requester} claims {count} {tricks}. You accepted. {waiting}":
			"{requester} krever {count} {tricks}. Du godtok kravet. {waiting}",
		"{requester} claims {count} {tricks}. Your decision is being sent.":
			"{requester} krever {count} {tricks}. Avgjørelsen din sendes.",
		"{requester} claims {count} {tricks}. {waiting}":
			"{requester} krever {count} {tricks}. {waiting}",
		"{requester} claims {count} {tricks}. Do you accept the claim?":
			"{requester} krever {count} {tricks}. Godtar du kravet?",
		"{requester} asks to undo their {action}. Do you approve?":
			"{requester} ber om å angre {action}. Godtar du?",
		"{seat}: use at most {max} characters.":
			"{seat}: bruk maksimalt {max} tegn.",
		Debug: "Feilsøking",
		"Reload players": "Last inn spillerne på nytt",
		"Host controls": "Vertskontroller",
		"Collecting the players' reports…": "Henter rapportene fra spillerne…",
		"Debug export copied.": "Feilsøkingseksporten er kopiert.",
		"Could not copy the debug export. Allow clipboard access and try again.":
			"Kunne ikke kopiere feilsøkingseksporten. Tillat tilgang til utklippstavlen og prøv igjen.",
		"Asked {count} pages to reload.": "Ba {count} sider laste inn på nytt.",
		"no report": "ingen rapport",
		"singleton honour {cards}": "singleton honnør {cards}",
		"unsupported honours {cards}": "ustøttede honnører {cards}",
		"good suit {cards}": "god farge {cards}",
		"4333 shape": "4333-fordeling",
		"all four aces": "alle fire ess",
		"void {suit} ({shape})": "renons {suit} ({shape})",
		"singleton {suit} ({shape})": "singleton {suit} ({shape})",
		"doubleton {suit} ({shape})": "doubleton {suit} ({shape})",
		Guide: "Veiledning",
		"(Convention: {calls})": "(Konvensjon: {calls})",
		"(Unconventional)": "(Ukonvensjonell)",
		"Bidding guide": "Meldeveiledning",
		Close: "Lukk",
		OK: "OK",
		double: "dobling",
		redouble: "redobling",
		pass: "pass",
		"The bidding guide could not be loaded.":
			"Meldeveiledningen kunne ikke lastes inn.",
		"{seat} to bid": "{seat} skal melde",
		"Your turn to play.": "Din tur til å spille.",
		"Your turn: play a card from dummy.":
			"Din tur: spill et kort fra blindemann.",
		"Waiting for {seat} to play.": "Venter på at {seat} spiller.",
		"Waiting for {seat} to play from dummy.":
			"Venter på at {seat} spiller fra blindemann.",
		"{contract} by {declarer}": "{contract} av {declarer}",
		"Loading the table…": "Laster bordet…",
		"This room has no bridge table.": "Dette rommet har ikke noe bridgebord.",
		Pass: "Pass",
		Double: "Dobling",
		Redouble: "Redobling",
		PASS: "PASS",
		"Level {level}": "Trinn {level}",
		Clubs: "Kløver",
		Diamonds: "Ruter",
		Hearts: "Hjerter",
		Spades: "Spar",
		"No trump": "Grand",
		"Asking {engine} for a bid (attempt {attempt} of {attempts}).":
			"Spør {engine} om en melding (forsøk {attempt} av {attempts}).",
		"Asking {engine} for a card play (attempt {attempt} of {attempts}).":
			"Spør {engine} om et kort (forsøk {attempt} av {attempts}).",

		"Still waiting for {engine} to return a decision.":
			"Venter fortsatt på en avgjørelse fra {engine}.",

		"Vienna points": "Vienna-poeng",
		"Reith points": "Reith-poeng",
		"Four Aces points": "Four Aces-poeng",
		points: "poeng",
		"{min}+ {scale}": "{min}+ {scale}",
		"{min}–{max} {scale}": "{min}–{max} {scale}",
		balanced: "balansert",
		"artificial and forcing": "kunstig og krav",
		"{min}+ {suit} support": "støtte med {min}+ {suit}",
		"weak two, a good {length}-card {suit} suit":
			"svak to-åpning, en god {suit}-farge med {length} kort",
		"preempt, a good {length}-card {suit} suit":
			"sperremelding, en god {suit}-farge med {length} kort",
		"transfer, {min}+ {suit}": "overføring, {min}+ {suit}",
		"Stayman, a {min}-card major": "Stayman, en høyfarge med {min} kort",
		"weak, a {min}+ card minor": "svak, en lavfarge med {min}+ kort",
		"game try, invites game, {min}+ {suit}":
			"utgangsforsøk, inviterer til utgang, {min}+ {suit}",
		"competitive, no game invitation, {min}+ {suit}":
			"konkurransemelding, ingen utgangsinvitasjon, {min}+ {suit}",
		waiting: "ventemelding",
		"no other guide call fits":
			"ingen annen melding i meldeveiledningen passer",
		"a good {min}+ card {suit} suit": "en god {suit}-farge med {min}+ kort",
		"no {min}-card major": "ingen høyfarge med {min} kort",
		"completes the transfer to {suit}": "fullfører overføringen til {suit}",
		"forced, any hand": "tvunget, alle hender",
		"asks opener to describe the hand": "ber åpner beskrive hånden",
		"balanced, a {suit} stopper": "balansert, hold i {suit}",
		"takeout, short in {suit}, or {strong}":
			"opplysende, kort i {suit}, eller {strong}",
		"Blackwood, asks for aces: a small slam needs about {small} together, a grand slam about {grand}":
			"Blackwood, spør etter ess: lilleslem krever omtrent {small} til sammen, storeslem omtrent {grand}",
		"Blackwood: {small}/{grand}": "Blackwood: {small}/{grand}",
		"Aces: {answers}": "Ess: {answers}",
		"aces: {counts}": "ess: {counts}",
		"not in the guide": "ikke i meldeveiledningen",
	},
	...additionalCatalogs,
};

const catalogs = Object.fromEntries(
	Object.entries(baseCatalogs).map(([locale, catalog]) => [
		locale,
		{
			...catalog,
			...playerCatalogs[locale as Exclude<Locale, "en">],
			...communityCatalogs[locale as Exclude<Locale, "en">],
		},
	]),
) as Readonly<Record<Exclude<Locale, "en">, Catalog>>;

export const translatedMessageKeys = [
	...new Set(
		Object.values(catalogs).flatMap((catalog) => Object.keys(catalog)),
	),
];

/** The keys of the other catalogs that this language's catalog lacks; none for English, the source language. */
export function missingMessageKeys(locale: Locale): readonly string[] {
	if (locale === "en") return [];
	const catalog = catalogs[locale];
	return translatedMessageKeys.filter((key) => !Object.hasOwn(catalog, key));
}

export function detectLocale(
	languages: readonly string[] | undefined,
	language: string | undefined,
): Locale {
	const preferences = languages?.length
		? languages
		: language
			? [language]
			: [];
	for (const preference of preferences) {
		const primary = preference.toLowerCase().split("-")[0];
		if (primary === "nb" || primary === "no") return "no";
		if (
			primary === "de" ||
			primary === "hu" ||
			primary === "es" ||
			primary === "pt" ||
			primary === "fr" ||
			primary === "it" ||
			primary === "nl" ||
			primary === "en"
		)
			return primary;
	}
	return "en";
}

export function translator(locale: Locale): Translate {
	const catalog = locale === "en" ? undefined : catalogs[locale];
	return (message, values = {}) => {
		const template = catalog?.[message] ?? message;
		return template.replace(
			/\{([a-zA-Z0-9_]+)\}/g,
			(placeholder, key: string) => String(values[key] ?? placeholder),
		);
	};
}

# Petul Mail Automation — Projektdokumentation für Claude

## Was ist dieses Projekt?

KI-gestützte E-Mail-Automatisierung für **Petul Hotels** (5 Hotels in Essen/NRW).
Eingehende Gäste-Mails werden klassifiziert, mit PMS-Daten angereichert, und ein Antwortentwurf wird erstellt.
Eine Rezeptionistin prüft und genehmigt den Entwurf im Dashboard — dann wird die Mail automatisch gesendet.

---

## Systemarchitektur

```
IMAP-Listener (imapflow)
       ↓ UNSEEN-Scan des Postfachs — NICHT das "exists"-Event allein
       ↓ (drainInbox(): bei jedem Connect, bei jedem exists, alle 2 Min)
Supabase (emails-Tabelle, status: "new")
       ↓ SOFORT automatisch (kein Dashboard-Klick nötig)
Status: "queued"
       ↓ runAiPipeline(); watchNewMails-Poller (5s) ist das Sicherheitsnetz
       ↓ MAX_CONCURRENT_PIPELINES = 1 — die Agenten laufen strikt nacheinander,
       ↓ eine Mail nach der anderen. Überzählige bleiben "queued".
3-Agenten-KI-Pipeline (gpt-4o-mini, AI SDK generateObject):
  1. Intent Agent  → Klassifizierung der Mail
  2. Policy Agent  → Richtlinienprüfung (Türcodes, Stornierung, etc.)
  3. Action Agent  → Antwortentwurf + geplante PMS-Aktion
       ↓ Signatur wird HIER angehängt (nicht erst beim Versand) —
       ↓ die Rezeptionistin sieht exakt den Text, der rausgeht
Supabase (status: "processing", draft_reply gesetzt)
       ↓ Rezeptionistin bestätigt im Dashboard
Status: "approved"
       ↓ processOutbound-Poller (alle 10s)
Status: "sending"  ← Zwischenstatus, überlebt Prozessabbruch
       ↓ 1. SMTP-Versand   2. DANN die PMS-Mutation (genau einmal)
Status: "sent"
```

**Warum der UNSEEN-Scan:** Der frühere Ansatz („exists"-Event → `fetch(data.count)`)
hatte drei belegte Fehler: der Fetch lief außerhalb des Mailbox-Locks, wodurch IDLE
nicht neu armierte und die Verbindung **exakt 5:00 Min nach jeder Mail** abbrach
(12 von 12 Mal im Log); es wurde nur die höchste Sequenznummer geholt, wodurch bei
gleichzeitig eintreffenden Mails alle bis auf eine verloren gingen (belegt: Index
752 → 753 → **755**); und es gab keinen Nachhol-Scan beim Verbindungsaufbau.

**Warum der Versand vor der Mutation kommt:** Vorher lief die Mutation zuerst, und der
Fehlerpfad setzte den Status auf „approved" zurück — bei jedem Sendefehler wurde die
PMS-Mutation also erneut ausgeführt. `bookExtraService` erzeugt per `REC-${Date.now()}`
jedes Mal einen neuen Beleg auf der Gastrechnung.

Jede Mail, die > 30 Tage in `new`/`processing`/`failed` hängt (nie angeschaut, nie freigegeben,
nie erneut versucht), wird automatisch auf `status: "archived"` gesetzt (`archiveStaleMails()`
in `backend/src/index.ts`, läuft alle 6h) — nichts wird gelöscht, sie verschwindet nur aus der
aktiven Dashboard-Ansicht. Verhindert, dass sich unbemerkt wieder ein Rückstau aufbaut.

---

## Wo läuft was?

| Komponente | Pfad | Runtime / Deployment |
|---|---|---|
| **Backend** (IMAP + Pipeline) | `backend/` | **PM2** auf dem VPS: `petul-mail-automation` |
| **Dashboard** | `dashboard/` | **Vercel** (auto-deploy bei Push auf `main`) |
| **Datenbank** | — | **Supabase**: Projekt-ID `uxqcpmnanjfyztyhsdsi` |

Backend-Startbefehl: `npx tsx src/index.ts` (via PM2-Config)
**tsx hat kein Hot-Reloading** — nach jeder Backend-Änderung MUSS PM2 neu gestartet werden.

---

## KRITISCH: Backend-Deploymentprozess

```bash
# Nach JEDER Änderung an backend/src/** oder backend/prompts/**:
pm2 restart petul-mail-automation --update-env

# Logs prüfen (5 Hotels müssen laden, IMAP muss verbinden):
pm2 logs petul-mail-automation --lines 30
```

Erwartete Ausgabe nach erfolgreichem Start:
```
✅ Hotel Petul "An der Zeche": Settings geladen
✅ Hotel Apart "An'ne 40": Settings geladen
✅ Hotel Apart "Residenz": Settings geladen
✅ Hotel Apart "Am Ruhrbogen": Settings geladen
✅ Art Hotel Brunnen: Settings geladen
✅ Petul: Verbunden & IDLE aktiv. Warte auf Mails...
```

**Fehlerdiagnose: "force_process funktioniert nicht / Antwort kommt nicht / alles kaputt"**
→ Erste Frage: Wurde PM2 nach der letzten Codeänderung neu gestartet?
→ `pm2 list` zeigt Uptime — wenn > 1h und Code wurde geändert: Neustart fehlt.

Dashboard (Next.js): Kein eigener Restart nötig — Vercel deployt automatisch nach `git push`.

---

## E-Mail-Status-Fluss

```
new → queued → [KI-Pipeline] → processing → approved → sending → sent
                             ↘ ignored     (Spam / Portal / System-Benachrichtigung)
                             ↘ failed      (fachlicher Fehler, z.B. Reservierung nicht gefunden)
                             ↺ queued      (transienter Fehler: Netz/Timeout/Rate-Limit, max. 3 Versuche)
                                          approved → send_failed (nach 5 Sendeversuchen)
new/queued/processing/failed/send_failed → archived (automatisch nach 30 Tagen ohne Aktion)
```

**`sending`** ist ein Zwischenstatus, der einen Prozessabbruch überlebt: `recoverStuckSending()`
(alle 5 Min) holt Mails zurück, die zwischen Claim und Versand hängen blieben. War der Versand
bereits erfolgreich (`agent_logs.mail_sent_at` gesetzt) und nur das Status-Update scheiterte,
wird auf `sent` korrigiert statt erneut gesendet — sonst bekäme der Gast die Mail zweimal.

**`send_failed`** = nach 5 Versuchen endgültig unzustellbar. Erscheint in der aktiven
Dashboard-Liste und braucht manuelle Nacharbeit.

**Transient vs. fachlich:** Ein 3RPMS-Ausfall parkte früher jede in dieser Zeit eintreffende
Mail dauerhaft auf `failed`, wo sie nie wieder jemand anfasste. Jetzt bleiben Netzwerk-,
Timeout- und Rate-Limit-Fehler auf `queued` und werden erneut versucht (max. 3 Mal);
nur fachliche Fehler („Reservierung nicht gefunden") landen auf `failed`.

- `new`: Mail eingetroffen — wird vom IMAP-Listener sofort automatisch auf `queued` gesetzt
  (kein Dashboard-Klick mehr nötig). Bleibt nur "new" hängen, wenn dieser Schritt fehlschlägt.
- `queued`: Pipeline läuft/wartet auf Verarbeitung (automatisch getriggert ODER durch einen
  Dashboard-Klick erneut angestoßen — beides landet im selben `watchNewMails`-Poller, 5s)
- `processing`: Pipeline fertig, `draft_reply` gesetzt, wartet auf Freigabe
- `approved`: Rezeptionistin hat bestätigt → processOutbound sendet (10s-Poller)
- `sent` / `failed` / `rejected`: Endstatus
- `ignored`: KI hat Mail als Spam/Portal/System klassifiziert
- `archived`: > 30 Tage in new/processing/failed ohne Aktion — automatisch aus der aktiven
  Ansicht entfernt, Daten bleiben erhalten

**Race-Condition-Schutz (`queued_at`):** Jede Neu-Anstoß-Aktion (Dashboard-Klick oder IMAP-Trigger)
schreibt einen frischen Zeitstempel nach `agent_logs.queued_at`. Bevor `runAiPipeline()` sein
Ergebnis in die DB schreibt, vergleicht es den zu Beginn gelesenen Wert mit dem aktuellen —
weicht er ab, wurde die Mail zwischenzeitlich erneut angestoßen und das veraltete Ergebnis wird
verworfen statt einen frischeren Klick stillschweigend zu überschreiben (`writeResultIfCurrent()`
in `backend/src/index.ts`).

**Dashboard-Sichtbarkeit:** Die Mail-Liste zeigt standardmäßig zwei Gruppen — aktiv
(`new`/`queued`/`processing`/`failed`/`approved`, bis zu 300 Mails) und darunter "Erledigt"
(`ignored`/`sent`/`rejected`, die letzten 50). `archived` taucht dort nie auf. Siehe
`dashboard/src/app/emails/constants.ts` (`ACTIVE_STATUSES`/`DONE_STATUSES`).

---

## Spam/Ignored — "Trotzdem bearbeiten" (force_process)

Mails mit `status: ignored` zeigen im Dashboard:
- **"Trotzdem bearbeiten"** (nur bei Spam): setzt `agent_logs.force_process = true`, re-queued
- **"Neu prüfen"**: re-queued ohne force_process (KI prüft erneut)

Backend liest `force_process` aus `emails.agent_logs` und überspringt bei `true`:
- `IGNORE_CATEGORIES`-Check (Intent Agent)
- `is_spam`-Check (Policy Agent)

Implementierung: `backend/src/index.ts`, Funktion `runAiPipeline`.
**Ohne PM2-Neustart nach Feature-Einführung greift force_process nicht!**

---

## 5 Hotels & IDs

| Hotel-ID (intern) | Hotelname | Supabase-Spalte |
|---|---|---|
| H1 | Hotel Petul "An der Zeche" | `THREE_RPMS_API_KEY_H1` |
| H2 | Hotel Apart "An'ne 40" | `THREE_RPMS_API_KEY_H2` |
| H3 | Hotel Apart "Residenz" | `THREE_RPMS_API_KEY_H4` ⚠️ |
| H4 | Hotel Apart "Am Ruhrbogen" | `THREE_RPMS_API_KEY_H5` ⚠️ |
| H5 | Art Hotel Brunnen | `THREE_RPMS_API_KEY_H3` ⚠️ |

⚠️ Die Schlüssel-Nummern in den Env-Vars stimmen nicht mit den Hotel-IDs überein — historisch gewachsen, nicht ändern.

**Hotel-Erkennung (Priorität, seit Commit 7c2c32c):** `identifyHotel()` (`backend/src/utils/threerpms.ts`)
entscheidet in dieser Reihenfolge:
1. **Manuelle Dashboard-Auswahl** (`agent_logs.ai_force_hotel`) — absoluter Vorrang, gesetzt über
   `updateHotel()` (`dashboard/src/app/emails/actions.ts`), wenn die Rezeptionistin das Hotel im
   "Ziel-Etablissement"-Selector explizit wählt. Wird in `runAiPipeline()` (`backend/src/index.ts`)
   VOR dem eigentlichen `identifyHotel()`-Aufruf geprüft (`forcedHotel`-Variable).
2. Deterministischer E-Mail-Match gegen `X-Original-To`/`Delivered-To`-Header (`forward_target`)
3. KI-Vermutung des Intent Agents (`extracted_entities.hotel_identifiziert`)
4. Keyword-Suche in Empfänger-Adresse

**Wichtig:** `ai_force_hotel` muss über `watchNewMails()` aus `agent_logs` in `mailData` durchgereicht
werden, sonst kommt die manuelle Auswahl beim Backend nie an (das war monatelang der Fall — die
Hotel-Auswahl im Dashboard hatte keinerlei Effekt, s. Häufige Probleme unten).

---

## Supabase-Tabellen (wichtigste)

| Tabelle | Zweck |
|---|---|
| `emails` | Alle eingehenden Mails + status + draft_reply + agent_logs (JSONB) |
| `senders` | Absender-Profile (email, name, hotel_id) |
| `hotel_signatures` | Konfigurierbare Signaturen pro Hotel — editierbar im Dashboard `/settings` |
| `dashboard_auth` | Genau eine Zeile: Passwort-Hash + Session-Token des Dashboards (s. Sicherheitsarchitektur) |

`emails.agent_logs` (JSONB) enthält: `intentData`, `policyData`, `actionData`, `threeRpmsData`,
`inventoryData`, `target_hotel` (aufgelöster Hotelname, vom Backend gesetzt), `ai_force_hotel`
(manuelle Hotel-Wahl aus dem Dashboard, hat Vorrang — s. Hotel-Erkennung oben), `hotel_source`
(`"manuell (Dashboard)"` / `"email-header"` / `"ai-oder-keyword"` / `"unbekannt"`), `empfaenger`,
`forward_target`, `force_process`, `queued_at` (Zeitstempel des letzten Neu-Anstoßes, für den
Race-Condition-Schutz — s. Status-Fluss oben), `pipeline_errors`.

**Jede Aktion in `dashboard/src/app/emails/actions.ts`, die `agent_logs` schreibt, MUSS es mit
`{ ...currentAgentLogs, ... }` mergen, niemals überschreiben** — sonst gehen `empfaenger`/
`forward_target`/`ai_force_hotel` verloren und die Hotel-/PMS-Erkennung fällt beim nächsten
Pipeline-Lauf auf unzuverlässiges Raten zurück (genau das war der Bug in `selectMail()`, behoben
in Commit 7c2c32c).

**Wichtig:** `empfaenger`/`forward_target` sind NUR in `agent_logs` — keine eigenen Spalten der
`emails`-Tabelle. Ein `.select()`/`.update()` mit diesen Namen als Top-Level-Spalten schlägt
fehl (genau das war der Bug, der `processOutbound` monatelang lahmgelegt hat).

`hotel_signatures` hat Zeilen für `H1`–`H5` + `DEFAULT`. Platzhalter-Adressen sind drin —
echte Adressen bitte im Dashboard unter `/settings` eintragen.

`dashboard_auth` (`backend/supabase_migration_dashboard_auth.sql`) hat **RLS an und absichtlich
keine einzige Policy** — nur der Service-Role-Key kommt an die Zeile. Nicht dem Muster von
`hotel_signatures` folgen: eine "Public read access"-Policy würde Passwort-Hash und
Session-Geheimnis für jeden anon-Key lesbar machen.

---

## KI-Agenten & Prompts

| Datei | Aufgabe |
|---|---|
| `backend/prompts/01_intent.md` | Klassifizierung: Portal/System/Spam ZUERST prüfen |
| `backend/prompts/02_policy.md` | Richtlinienprüfung |
| `backend/prompts/03_action.md` | Antwortentwurf + PMS-Aktion |
| `backend/src/agents/01_intentAgent.ts` | Ausführung Intent Agent |
| `backend/src/agents/03_actionAgent.ts` | Ausführung Action Agent (Sprachregel drin!) |

**Sprache der Antworten:** Action Agent antwortet IMMER in der Sprache des Gastes.
Diese Regel steht in `03_action.md` (oberste Priorität) und in `03_actionAgent.ts`.
Wenn Antworten auf Deutsch kommen trotz englischer Mail → beide Dateien prüfen.

---

## 3RPMS GraphQL — bekannte Schema-Eigenheiten

- `Reservation.rooms` (nicht `roomStays`, nicht `room_stays`)
- `ClientFilter` hat **kein** `email`-Feld → E-Mail-Suche geht über `rooms`-Lookup + clientseitigem Filter
- `Company`-Typ: Feld heißt `company` (nicht `name`)
- `ReservationFilter` hat **kein** `reservation_from`-Feld

---

## Dashboard — Layout-Übersicht

- **Linke Sidebar** (dunkel, `w-64`): Mail-Liste — Betreff, Absender, Uhrzeit, Status-Punkt.
  Zwei Gruppen: aktiv oben, "Erledigt" (ignored/sent/rejected) darunter mit Trenner.
- **Header**: Hotel-Selector, Betreff + Absender (klickbar → öffnet `MailExpandModal`, Vollbild)
- **Hauptbereich** (3-Spalten-Grid, `grid-cols-12`):
  - `col-span-3`: **Eingehende Mail** — permanente Vorschau (Betreff, Absender, Body), damit
    man beim Bearbeiten des Entwurfs nicht ständig zwischen Original und Antwort hin- und
    herschalten muss. Maximieren-Button öffnet dieselbe Mail im Vollbild-Modal.
  - `col-span-6`: Antwort-Entwurf (editierbar) + Aktions-Buttons
  - `col-span-3`: Erkannte Anfrage, PMS-Daten, geplante Aktion

Mail-Body-Rendering (HTML/Text + Entity-Cleanup) ist in `MailBodyContent` zusammengefasst
(`dashboard/src/app/EmailFeed.tsx`) — wird von Vorschau-Spalte, Vollbild-Modal und der
`ignored`-Ansicht gemeinsam genutzt, nicht mehr dreifach dupliziert.

Für `ignored`-Mails: kompaktes Banner oben (Farbe je nach Typ) + Mail-Body darunter (lesbar).
Für `processing`-Mails: Entwurf-Textarea + "Bestätigen & Senden" / "Ablehnen" unten.

---

## Sicherheitsarchitektur (Dashboard ↔ Supabase)

Das Dashboard hat **kein Supabase Auth** — Zugriffsschutz ist ausschließlich ein
Passwort-Cookie, geprüft in `proxy.ts`. Alle Datenbankzugriffe laufen deshalb
**ausschließlich serverseitig** über Next.js Server Actions:

- `dashboard/src/utils/supabase/server.ts` — Service-Role-Client, liest `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` (server-only, **kein** `NEXT_PUBLIC_`-Prefix). Darf **niemals**
  aus einer `"use client"`-Datei importiert werden.
- `dashboard/src/app/emails/actions.ts`, `dashboard/src/app/settings/actions.ts` — Server
  Actions (`"use server"`), die diesen Client nutzen. Konstanten (Query-Strings, Status-Listen)
  liegen separat in `emails/constants.ts`, weil eine `"use server"`-Datei nur async Functions
  exportieren darf.
- Client-Komponenten (`EmailFeed.tsx`, `settings/page.tsx`) rufen nur noch diese Server Actions
  auf — es gibt **keinen** Supabase-Client mehr im Browser-Bundle.

### Anmelden, Abmelden, Passwort ändern

Alle Zugangslogik liegt in `dashboard/src/utils/auth.ts` (server-only — **nie** aus einer
`"use client"`-Datei importieren). Quelle der Wahrheit ist die Tabelle `dashboard_auth`:

| Datei | Rolle |
|---|---|
| `dashboard/src/utils/auth.ts` | Hashing (scrypt aus `node:crypto`), Session-Prüfung, Passwortwechsel |
| `dashboard/src/proxy.ts` | Prüft das Cookie bei jedem Request gegen den aktuellen `session_token` |
| `dashboard/src/app/api/auth/route.ts` | `POST` = Login (mit IP-Rate-Limit), `DELETE` = Cookie löschen |
| `dashboard/src/app/auth/actions.ts` | Server Actions `logout()` und `changePassword()` |
| `dashboard/src/app/settings/AccountPanel.tsx` | Formular unter `/settings` → "Passwort ändern" |

- **Abmelden:** Logout-Symbol in der Sidebar (Mail-Ansicht **und** `/settings`) → löscht das
  Cookie, landet auf `/login`.
- **Passwort ändern:** `/settings` → "Passwort ändern". Verlangt das aktuelle Passwort.
- **Ein Passwortwechsel würfelt `session_token` neu und meldet damit ALLE anderen Geräte ab.**
  Das ist Absicht (ausgeschiedene Mitarbeiterinnen aussperren), kein Bug. Nur der Browser, der
  die Änderung vornimmt, bekommt sofort ein frisches Cookie und bleibt drin.
- **Kein Passwort im Klartext:** in der DB steht nur ein scrypt-Hash.
- **Env-Fallback:** Solange `dashboard_auth` fehlt oder leer ist, gelten wie früher
  `DASHBOARD_PASSWORD` + `SESSION_SECRET`. Der erste erfolgreiche Login überführt beides
  automatisch in die Tabelle (Hash + bestehender `SESSION_SECRET` als Token, damit niemand
  rausfliegt). **Ab dann ist die Env-Var wirkungslos** — das Passwort ändert man nur noch im
  Dashboard, nicht mehr in Vercel.
- **Bei Supabase-Ausfall** (z.B. Egress-Sperre) gilt der zuletzt gelesene Stand weiter, statt
  alle auszusperren; ist auch der nicht da, wird der Zugriff verweigert (fail closed).

**Historisch:** Bis Juli 2026 lief `NEXT_PUBLIC_SUPABASE_ANON_KEY` mit dem echten
Service-Role-Key (voller DB-Zugriff, RLS-Bypass) — dadurch war er ~104 Tage lang öffentlich im
Browser-Bundle exponiert (Production/Preview/Development auf Vercel). Der Key sollte in Supabase
rotiert worden sein (Settings → API); falls nicht, dringend nachholen.

---

## Häufige Probleme & Lösungen

| Problem | Wahrscheinlichste Ursache | Lösung |
|---|---|---|
| **Keine Mail wird versendet, freigegebene Entwürfe landen auf `failed`** | ⚠️ **Go-Live-Blocker, Stand 31.07.2026:** Alle sechs Zeilen in `hotel_signatures` enthalten noch die Seed-Platzhalter (`Musterstraße 1 · 44000 Musterstadt`, `[Name]`, `HRB [Nummer]`). `hasPlaceholder()` (`backend/src/utils/signatures.ts`) hält den Versand deshalb **absichtlich** an — sonst ginge an jeden Gast eine erfundene Anschrift mit unvollständigen Pflichtangaben (§5 TMG / §35a GmbHG). | Dashboard → `/settings` → für **alle** Hotels **und** `DEFAULT` die echten Daten eintragen. Danach betroffene Mails mit „Neu prüfen" erneut anstoßen. Log-Zeile: `⛔ … Entwurf enthält Signatur-Platzhalter — Versand angehalten.` |
| **Mailempfang tot, aber `pm2 list` zeigt "online"** | War bis 28.07.2026 das größte Risiko: ein einziger gescheiterter Reconnect legte den Empfang dauerhaft still — belegt vom 21.–28.07.2026, sieben Tage, bei durchgehend grünem PM2. Zusätzlich brach die Verbindung nach **jeder** Mail exakt 5:00 Min später ab. Beides behoben (UNSEEN-Scan im Lock, Reconnect mit Backoff + `.catch()`, Handler vor `connect()`, Watchdog). | Seit 28.07. drei Tage ohne einen einzigen Abbruch. Prüfen mit `grep Heartbeat logs/out.log \| tail -3` — meldet alle 5 Min den Verbindungszustand. Bei „GETRENNT" beendet sich der Prozess nach 30 Min selbst, PM2 startet neu. |
| Antwort auf eine Booking.com-/Airbnb-Nachricht kommt beim Gast nie an | Bis 28.07. ging jede Antwort an `From:` — bei Portalmails ist das `noreply@…`. `Reply-To` wurde nirgends gelesen, die Mail galt trotzdem als `sent`. | Behoben: `reply_to` wird beim Empfang mitgespeichert und im Versand bevorzugt. Das Dashboard zeigt über dem Entwurf „Antwort geht an: …" inkl. Kennzeichnung „via Reply-To". |
| Entwurf nennt Zimmer/Datum/Preis einer fremden Buchung | Mehrere Aufenthalte auf dieselbe E-Mail-Adresse (typisch: Firmenbuchung auf `buchung@firma.de`). Die 3RPMS-Query liefert unsortiert, `roomStays[0]` war ein beliebiger Treffer. | Behoben: Sortierung nach Anreisedatum + `pms_ambiguous`-Kennzeichnung. Das Dashboard zeigt dann „Zuordnung unsicher" mit Begründung. Bei mehr als 50 kommenden Aufenthalten meldet die Suche jetzt einen Fehler statt „Gast nicht gefunden". |
| **Backend tut nichts, alle Mails bleiben liegen, `pm2 logs` voller Fehler** | Supabase-Egress-Kontingent überschritten (`exceed_egress_quota`) — Supabase blockiert dann das GESAMTE Projekt, jeder DB-Zugriff (`watchNewMails`, `processOutbound`, `archiveStaleMails`) schlägt fehl. Kein Code-Bug: 3RPMS läuft parallel weiter (Settings laden beim PM2-Start normal). Trat am 14.07.2026 auf, **seit 31.07.2026 wieder normal** (Backend verarbeitet Mails, PostgREST antwortet mit 200). | **Prüfen:** `pm2 logs petul-mail-automation --lines 20` — Text `exceed_egress_quota` = blockiert. **Fix (nur der Projekt-Owner):** Supabase-Dashboard (Projekt `uxqcpmnanjfyztyhsdsi`) → Settings → Billing → Plan upgraden oder Spend-Cap entfernen. |
| Nach einem Passwortwechsel sind alle Rezeptionistinnen ausgeloggt | Kein Fehler — der Wechsel widerruft absichtlich jede bestehende Session (s. Sicherheitsarchitektur) | Neues Passwort im Team weitergeben; einmal neu anmelden genügt |
| Passwortwechsel meldet "Die Tabelle dashboard_auth fehlt" | `backend/supabase_migration_dashboard_auth.sql` wurde noch nicht im Supabase SQL-Editor ausgeführt | Migration ausführen. Bis dahin läuft der Login unverändert über `DASHBOARD_PASSWORD` weiter |
| Login sagt "Zu viele Fehlversuche" | Rate-Limit greift ab 20 Fehlversuchen pro IP in 15 Minuten — die ganze Rezeption teilt sich eine IP | 15 Minuten warten. Grenze steht in `dashboard/src/app/api/auth/route.ts` (`MAX_ATTEMPTS`) |
| Manuelle Hotel-Wahl im Dashboard-Selector ändert nichts an PMS-Daten/Entwurf | **(behoben, Commit 7c2c32c)** `agent_logs.ai_force_hotel` wurde im Backend nie gelesen — jeder Pipeline-Re-Run hat das Hotel erneut (ggf. wieder falsch/unklar) bestimmt, die manuelle Auswahl verpuffte folgenlos | `runAiPipeline()` prüft `ai_force_hotel` jetzt zuerst, mit absolutem Vorrang (s. Hotel-Erkennung oben). Falls wieder wirkungslos: PM2-Neustart nach der letzten Backend-Änderung geprüft? |
| Entwurf/"Kopieren"/"Bestätigen & Senden" wirken nach Mail-Klick 2s eingefroren | **(behoben, Commit 7c2c32c)** `EmailFeed.tsx` hatte eine feste 2s-Fake-Progress-Animation (Text bei `opacity: 0.04`, Buttons gesperrt) — obwohl Status `processing` den Entwurf per Definition schon fertig bedeutet | Animation springt jetzt sofort auf `step=4`, sobald `draft_reply` bereits vorhanden ist — echte Wartezeit nur noch, wenn tatsächlich kein Entwurf da ist |
| Mail bleibt bei Klick auf eine "neue" Mail ohne Hotel-/PMS-Daten hängen | **(behoben, Commit 7c2c32c)** `selectMail()` in `emails/actions.ts` überschrieb `agent_logs` komplett statt zu mergen — `empfaenger`/`forward_target` (primärer Hotel-Erkennungsweg) gingen verloren | `selectMail()` merged jetzt `currentAgentLogs` wie die übrigen Aktionen (`updateHotel`/`regenerateDraft`/`forceProcess`) |
| "Trotzdem bearbeiten" klassifiziert erneut als Spam | PM2 läuft noch alten Code | `pm2 restart petul-mail-automation --update-env` |
| Vorschau der Antwort fehlt komplett | Pipeline liefert `status: failed` | `pm2 logs petul-mail-automation --lines 50` prüfen; `agent_logs.pipeline_errors` im Dashboard-Panel zeigt jetzt auch unerwartete Fehler (nicht mehr nur die "sauberen" Fehlerpfade) |
| Antwort auf Deutsch trotz englischer Mail | Alter Code im PM2-Prozess | PM2 neu starten; dann `03_action.md` + `03_actionAgent.ts` prüfen |
| Mail erscheint nicht im Dashboard | IMAP-Verbindung verloren, ODER Mail ist `archived` (> 30 Tage untätig) | IMAP: Logs prüfen (automatischer Reconnect). Archiviert: bewusst so, Daten sind erhalten, nur nicht in der aktiven Ansicht |
| Genehmigte Mail wird nie gesendet | **(behoben)** `processOutbound()` fragte bis Juli 2026 nicht-existente Spalten ab (`empfaenger`/`forward_target` sind nur in `agent_logs`, nicht eigene Spalten) — jeder Sendeversuch schlug mit 400 fehl, still verschluckt. Dadurch wurde in der gesamten Projektlaufzeit nur 1 Mail je gesendet | Falls es wieder auftritt: `pm2 logs` auf wiederholte Fehler von `processOutbound` prüfen (wird jetzt geloggt, nicht mehr verschluckt) |
| Dashboard-Klick ("Neu prüfen"/"Trotzdem bearbeiten") scheint wirkungslos | Ein automatisch getriggerter Lauf für dieselbe Mail war noch aktiv und hat das Ergebnis überschrieben | **(behoben)** `queued_at`-Abgleich in `runAiPipeline()`/`writeResultIfCurrent()` verwirft jetzt veraltete Ergebnisse statt frische Klicks zu überschreiben |
| Signatur falsch/leer | Platzhalter noch nicht ersetzt | `/settings` im Dashboard öffnen, echte Daten eintragen |

---

## Deployment-Checkliste

### Dashboard-Änderungen (Next.js)
```bash
git add dashboard/src/... && git commit -m "..." && git push
# Vercel deployt automatisch. Kein weiterer Schritt nötig.
```

### Backend-Änderungen
```bash
git add backend/src/... backend/prompts/... && git commit -m "..." && git push
pm2 restart petul-mail-automation --update-env   # PFLICHT!
pm2 logs petul-mail-automation --lines 20        # Start verifizieren
```

**Niemals Backend-Änderungen ohne PM2-Neustart als "deployed" bezeichnen.**

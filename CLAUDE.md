# Petul Mail Automation — Projektdokumentation für Claude

## Was ist dieses Projekt?

KI-gestützte E-Mail-Automatisierung für **Petul Hotels** (5 Hotels in Essen/NRW).
Eingehende Gäste-Mails werden klassifiziert, mit PMS-Daten angereichert, und ein Antwortentwurf wird erstellt.
Eine Rezeptionistin prüft und genehmigt den Entwurf im Dashboard — dann wird die Mail automatisch gesendet.

---

## Systemarchitektur

```
IMAP-Listener (imapflow)
       ↓ neue Mail
Supabase (emails-Tabelle, status: "new")
       ↓ Rezeptionistin klickt im Dashboard
Status: "queued"
       ↓ watchNewMails-Poller (alle 1,5s)
3-Agenten-KI-Pipeline (gpt-4o-mini, AI SDK generateObject):
  1. Intent Agent  → Klassifizierung der Mail
  2. Policy Agent  → Richtlinienprüfung (Türcodes, Stornierung, etc.)
  3. Action Agent  → Antwortentwurf + geplante PMS-Aktion
       ↓
Supabase (status: "processing", draft_reply gesetzt)
       ↓ Rezeptionistin bestätigt im Dashboard
Status: "approved"
       ↓ processOutbound-Poller (alle 10s)
SMTP: Mail wird gesendet (status: "sent")
```

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
new → queued → [KI-Pipeline] → processing → approved → sent
                             ↘ ignored  (Spam / Portal-Benachrichtigung / System-Benachrichtigung)
                             ↘ failed   (3RPMS-API-Fehler: Gast nicht gefunden etc.)
```

- `new`: Mail eingetroffen, wartet auf Dashboard-Aktion
- `queued`: Dashboard-Klick → watchNewMails startet Pipeline (1,5s-Poller)
- `processing`: Pipeline fertig, `draft_reply` gesetzt, wartet auf Freigabe
- `approved`: Rezeptionistin hat bestätigt → processOutbound sendet (10s-Poller)
- `sent` / `failed` / `rejected`: Endstatus
- `ignored`: KI hat Mail als Spam/Portal/System klassifiziert

---

## Spam/Ignored — "Trotzdem bearbeiten" (force_process)

Mails mit `status: ignored` zeigen im Dashboard:
- **"Trotzdem bearbeiten"** (nur bei Spam): setzt `agent_logs.force_process = true`, re-queued
- **"Neu prüfen"**: re-queued ohne force_process (KI prüft erneut)

Backend liest `force_process` aus `emails.agent_logs` und überspringt bei `true`:
- `IGNORE_CATEGORIES`-Check (Intent Agent)
- `is_spam`-Check (Policy Agent)

Implementierung: `backend/src/index.ts`, Funktion `processEmail`.
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

---

## Supabase-Tabellen (wichtigste)

| Tabelle | Zweck |
|---|---|
| `emails` | Alle eingehenden Mails + status + draft_reply + agent_logs (JSONB) |
| `senders` | Absender-Profile (email, name, hotel_id) |
| `hotel_signatures` | Konfigurierbare Signaturen pro Hotel — editierbar im Dashboard `/settings` |

`emails.agent_logs` (JSONB) enthält: `intentData`, `policyData`, `actionData`, `threeRpmsData`,
`target_hotel`, `empfaenger`, `forward_target`, `force_process`.

`hotel_signatures` hat Zeilen für `H1`–`H5` + `DEFAULT`. Platzhalter-Adressen sind drin —
echte Adressen bitte im Dashboard unter `/settings` eintragen.

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

- **Linke Sidebar** (dunkel): Mail-Liste mit Status-Indikatoren
- **Header**: Hotel-Selector, Betreff + Absender (klickbar → öffnet `MailExpandModal`)
- **Hauptbereich** (2-Spalten-Grid):
  - Links (`col-span-8`): Antwort-Entwurf (editierbar) + Aktions-Buttons
  - Rechts (`col-span-4`): Erkannte Anfrage, PMS-Daten, geplante Aktion

Für `ignored`-Mails: kompaktes Banner oben (Farbe je nach Typ) + Mail-Body darunter (lesbar).
Für `processing`-Mails: Entwurf-Textarea + "Bestätigen & Senden" / "Ablehnen" unten.

---

## Häufige Probleme & Lösungen

| Problem | Wahrscheinlichste Ursache | Lösung |
|---|---|---|
| "Trotzdem bearbeiten" klassifiziert erneut als Spam | PM2 läuft noch alten Code | `pm2 restart petul-mail-automation --update-env` |
| Vorschau der Antwort fehlt komplett | Pipeline liefert `status: failed` | `pm2 logs petul-mail-automation --lines 50` prüfen |
| Antwort auf Deutsch trotz englischer Mail | Alter Code im PM2-Prozess | PM2 neu starten; dann `03_action.md` + `03_actionAgent.ts` prüfen |
| Mail erscheint nicht im Dashboard | IMAP-Verbindung verloren | Passiert automatisch — aber Logs prüfen |
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

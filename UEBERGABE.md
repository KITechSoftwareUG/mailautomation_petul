# Petul Mail-Automation — Was das System kann, was nicht, und wie es weitergeht

Stand: 10.08.2026 · Für Petul Hotels

---

## In einem Satz

Jede eingehende Gäste-Mail wird automatisch gelesen, dem richtigen Haus zugeordnet, mit den
echten Buchungsdaten aus 3RPMS angereichert und zu einem fertigen Antwortentwurf verarbeitet.
Die Rezeptionistin liest, korrigiert bei Bedarf, klickt auf **Bestätigen & Senden** — und die
Mail geht raus.

**Was das System nicht ist:** ein Vollautomat, der eigenständig Buchungen umschreibt. Warum
das so ist, steht weiter unten — es liegt an der Schnittstelle von 3RPMS, nicht am Programm.

---

## Was automatisch passiert

| Schritt | Was passiert |
|---|---|
| **Mail kommt an** | Wird innerhalb von Sekunden erkannt — auch mehrere gleichzeitig, auch nach einem Neustart |
| **Einsortieren** | Spam, Newsletter und Portal-Benachrichtigungen werden aussortiert |
| **Haus zuordnen** | Über die Empfängeradresse, den Mailtext oder einen Gasttreffer im 3RPMS |
| **Buchung heraussuchen** | Über Reservierungsnummer oder Absenderadresse, inkl. vergangener Aufenthalte |
| **Verfügbarkeit prüfen** | Bei Anfragen mit Wunschzeitraum |
| **Antwort schreiben** | Immer in der Sprache des Gastes, mit den echten Buchungsdaten |
| **Sie prüfen** | Entwurf im Dashboard lesen, ändern, freigeben oder ablehnen |
| **Versand** | Geht an die Adresse, die den Gast wirklich erreicht (bei Booking.com/Airbnb nicht dieselbe wie der Absender) |

Die Bearbeitung läuft **eine Mail nach der anderen**. Das ist Absicht: nachvollziehbar,
schonend für alle beteiligten Systeme, und bei wenigen Mails pro Stunde ohne spürbare Wartezeit.

---

## Was das System im Hotelsystem eintragen kann

Hier gibt es **drei Kategorien**. Die Unterscheidung ist wichtig, weil nur eine davon
behebbar ist.

### 🟢 Läuft automatisch

- Mitreisenden zu einer Buchung hinzufügen oder entfernen
- Neuen Gast oder Firma anlegen
- Gruppenname / Rechnungsempfänger einer Reservierung ändern
- Tatsächliche Check-in-/Check-out-Zeit setzen — **wenn der Gast bereits eingecheckt ist**

### 🔒 Noch nicht freigeschaltet — behebbar

Diese drei Dinge sind eine reine Freischaltfrage. Solange sie fehlen, schreibt das System
trotzdem den Entwurf und sagt Ihnen im Dashboard, was Sie von Hand nachtragen müssen.

| Was fehlt | Folge | Wer kann das lösen |
|---|---|---|
| **Reservierungs-API nicht aktiviert** | Keine neuen Buchungen über das Programm | **3RPMS** muss sie für Ihren Zugang freischalten |
| **Kein Verkaufsprodukt angelegt** | Zusatzleistungen (Hund, Frühstück, Parkplatz) nicht automatisch verbuchbar | Einmalige Einrichtung, ca. 5 Minuten |
| **Keine Zahlungsart angelegt** | Anzahlungen nicht automatisch verbuchbar | Einmalige Einrichtung, ca. 5 Minuten |

> **Aktueller Stand (10.08.2026): Alle fünf Häuser sind in allen drei Punkten eingeschränkt.**
> Das Programm läuft trotzdem vollständig — es schreibt Entwürfe und weist auf die
> Handarbeit hin. Im Dashboard sehen Sie das jederzeit unter **Hotelsystem** in der linken Leiste.

### 🔴 Geht grundsätzlich nicht — auch nach jeder Freischaltung

Das sind keine Programmfehler und keine Einstellungssache. Die 3RPMS-Schnittstelle bietet
diese Funktionen schlicht nicht an. Wir haben das direkt an der Schnittstelle überprüft.

| Gastwunsch | Warum es nicht geht |
|---|---|
| **Umbuchung** auf einen anderen Zeitraum | Es gibt keinen Befehl dafür. Änderbar sind nur die tatsächlichen An- und Abreisezeiten, nicht der gebuchte Zeitraum. |
| **Zimmer- oder Kategoriewechsel** | Es gibt keinen Befehl dafür. |
| **Preis einer einzelnen Buchung ändern** | Nur der Preis einer ganzen Kategorie wäre änderbar. Das würde alle Gäste betreffen und sofort an Booking.com & Co. gemeldet. |
| **Späteren Check-out vorab eintragen** | Die Abreisezeit lässt sich erst eintragen, wenn der Gast eingecheckt hat. |
| **Fremde Buchung stornieren** | Nur Buchungen, die dieses Programm selbst angelegt hat, lassen sich darüber stornieren. |

**Wichtig:** In all diesen Fällen schreibt das System eine korrekte, freundliche Antwort —
aber eine, die **nichts Falsches verspricht**. Statt „Ihre Buchung wurde umgebucht" steht dort
sinngemäß „wir kümmern uns darum und melden uns". Über dem Entwurf erscheint ein Hinweis mit
Schloss-Symbol, was noch im 3RPMS zu erledigen ist.

---

## Wie Sie im Alltag damit arbeiten

1. **Dashboard öffnen.** Links stehen die offenen Mails, darunter die erledigten.
2. **Mail anklicken.** Links das Original, in der Mitte der Entwurf, rechts die Buchungsdaten.
3. **Auf Hinweise achten** — sie erscheinen über dem Entwurf:
   - 🔒 **Orange mit Schloss:** Sie müssen nach dem Senden noch etwas im 3RPMS eintragen.
   - ⚠️ **Orange „Zuordnung unsicher":** Mehrere Buchungen auf diese Adresse (z. B. Firmenbuchung).
     Bitte prüfen, ob die genannten Daten zum richtigen Gast gehören.
   - 📎 **„Mail enthält Anhang":** Das Programm liest Anhänge nicht — bitte im Postfach ansehen.
   - ✉️ **„Antwort geht an: …":** Zeigt die tatsächliche Empfängeradresse. Bei Portal-Mails ist
     das eine andere als der Absender.
4. **Entwurf lesen und anpassen.** Der Text im Feld ist exakt das, was rausgeht — inklusive Signatur.
5. **Bestätigen & Senden.**

**Wenn eine Mail falsch einsortiert wurde:** „Trotzdem bearbeiten" erzwingt die Bearbeitung —
auch bei Portal- und Systemnachrichten.

**Wenn das Haus falsch erkannt wurde:** oben im Auswahlfeld korrigieren. Ihre Auswahl hat
Vorrang und bleibt erhalten.

---

## Grenzen der automatischen Haus-Erkennung

32 von 51 auswertbaren Mails gehen an die Sammeladresse `info@petul.de`. Bei fast allen fehlt
die technische Information, an welche Hoteladresse sie ursprünglich gingen — die Weiterleitung
Ihres Anbieters entfernt sie. Und keine einzige dieser Mails nennt ein Hotel im Betreff oder Text.

**Folge:** Bei Neuanfragen ohne Buchung muss das Haus manuell gewählt werden. Bei Gästen mit
bestehender Buchung findet das System das Haus über die Adresse im 3RPMS von selbst.

**Behebbar** durch eine header-erhaltende Weiterleitung beim Mail-Anbieter — das ist eine
Einstellung dort, keine Programmänderung.

---

## Was Sie tun müssen, damit mehr automatisch läuft

**Priorität 1 — bei 3RPMS anfragen:**
> „Bitte aktivieren Sie die Reservierungs-API für unseren API-Zugang."

Ohne sie sind Buchungen, Umbuchungen und Stornierungen über die Schnittstelle dauerhaft
ausgeschlossen. Das ist der mit Abstand größte Hebel.

**Priorität 2 — einmalige Einrichtung (wir übernehmen das):**
- Ein Verkaufsprodukt für Zusatzleistungen anlegen. **Achtung:** Pro Zugang ist genau *ein*
  Produkt möglich, der Name ist auf 20 Zeichen begrenzt und nicht mehr löschbar.
  Vorschlag: `Zusatzleistung`. Unterschiedliche Leistungen werden über Betrag und Belegnummer
  unterschieden.
- Eine Zahlungsart für Anzahlungen anlegen. Vorschlag: `Onlinezahlung`.

**Priorität 3 — beim Mail-Anbieter:**
- Weiterleitung so einstellen, dass die ursprüngliche Empfängeradresse erhalten bleibt.

---

## Betrieb und Verlässlichkeit

- **Läuft es noch?** Das Programm meldet alle 5 Minuten seinen Zustand. Bleibt die Meldung aus
  oder ist die Verbindung länger als 30 Minuten tot, startet es sich selbst neu.
- **Was passiert bei einem Ausfall?** Nicht verarbeitete Mails bleiben im Postfach ungelesen
  liegen und werden nachgeholt, sobald das Programm wieder läuft. Es geht nichts verloren.
- **Was passiert bei einem Fehler beim Senden?** Bis zu fünf Versuche, danach erscheint die
  Mail als „Unzustellbar" in der Liste und braucht Ihre Aufmerksamkeit.
- **Kann eine Mail zweimal rausgehen?** Nein. Jede Mail wird vor dem Versand exklusiv
  beansprucht; war der Versand erfolgreich, wird er nie wiederholt.
- **Alte Mails** verschwinden nach 30 Tagen ohne Bearbeitung aus der aktiven Liste. Gelöscht
  wird nichts.

---

## Wenn etwas nicht stimmt

| Beobachtung | Wahrscheinliche Ursache |
|---|---|
| Entwürfe erscheinen, aber im 3RPMS ändert sich nichts | Normal, solange die Freischaltungen fehlen — siehe Schloss-Hinweis über dem Entwurf |
| Eine Mail taucht gar nicht auf | Als Spam/Portal einsortiert → unter „Erledigt" nachsehen und „Trotzdem bearbeiten" |
| Antwort geht an eine `noreply`-Adresse | Portal-Mail ohne nutzbare Antwortadresse — bitte über das Portal antworten |
| Falsches Haus in der Antwort | Haus oben korrigieren, dann „Neu prüfen" |
| Gar nichts passiert mehr | Technischer Ansprechpartner: KITech Software, aalkh@kitech-software.de |

---

## Für Technikerinnen und Techniker

Die vollständige technische Dokumentation liegt in `CLAUDE.md` im Projektverzeichnis:
Architektur, Statusfluss, alle 25 Schnittstellenbefehle mit Pflichtfeldern, bekannte
Eigenheiten und die Fehlerhistorie mit Belegen.

Die Wahrheitsquelle über die Schnittstellenfähigkeiten ist
`backend/src/utils/pmsCapabilities.ts`. Sie speist sowohl die Anweisungen an die KI als auch
die Prüfung vor jeder Ausführung — beide können nicht auseinanderlaufen. Änderungen dort mit
`npx tsx src/utils/__tests__/mutationGuard.test.ts` absichern.

---

## Einrichtung

Es ist **nichts mehr einzurichten** — die Statusanzeige „Hotelsystem" in der linken Leiste und
der Schloss-Hinweis über den Entwürfen sind aktiv.

Der Freischaltstand wird beim Programmstart und danach alle 6 Stunden neu gemessen. Sobald
3RPMS etwas freischaltet, erscheint es dort automatisch — ohne Codeänderung.

**Betreff:** AW: API-Zugang Petul Hotels — Freischaltung Reservierungs-API und Rückfragen zum Funktionsumfang

---

Guten Tag [Name],

vielen Dank für die ausführliche und schnelle Antwort — das hat uns sehr geholfen. Insbesondere
die Klarstellung zur ExternalSales-API war wichtig: Wir hatten sie zunächst als Weg eingeplant,
um Zusatzleistungen wie Frühstück oder Parkplatz aufzubuchen, und haben das nach Ihrer Auskunft
aus unserer Umsetzung entfernt.

Drei Punkte möchte ich Ihnen zuliefern bzw. noch klären:

## 1. Freischaltung — Sandbox und Produktiv

Wir arbeiten derzeit gegen die **Produktiv-Zugänge** der fünf Häuser, jeweils mit eigenem
API-Key. Einen Sandbox-Account haben wir bislang nicht.

- **1a)** Können Sie uns bitte einen **Sandbox-Account** einrichten? Wir würden die
  Reservierungsanlage gern dort erproben, bevor wir sie produktiv nutzen.
- **1b)** Für die spätere Produktivnutzung: Was benötigen Sie von uns, um die Reservierungs-API
  für die fünf Häuser freizuschalten? Die Hotel-IDs liefern wir Ihnen gern nach — teilen Sie uns
  bitte mit, wo genau wir sie im System finden (bzw. ob Ihnen die Kundennummer von Petul genügt).

*Betroffene Häuser: Hotel Petul „An der Zeche", Hotel Apart „An'ne 40", Hotel Apart „Residenz",
Hotel Apart „Am Ruhrbogen", Art Hotel Brunnen.*

## 2. Notizfeld bei bestehenden Buchungen

Ihre Empfehlung, einen gewünschten späten Check-out im Notizfeld zu vermerken, leuchtet ein.
Nach unserer Schema-Auswertung finden sich die Notizfelder (`guestMessage`, `maidNotes`) jedoch
nur in `ImportRoomStayInput` — also beim Anlegen bzw. vollständigen Übermitteln einer
Reservierung. `UpdateRoomStayInput` kennt ausschließlich `id`, `check_in` und `check_out`.

- **2a)** Gibt es einen Weg, eine Notiz an einer **bestehenden** Reservierung zu hinterlegen,
  die wir **nicht selbst** angelegt haben (also z. B. eine Buchung aus dem PMS oder von
  Booking.com)?
- **2b)** Falls nein: Wäre das ein denkbares Feature, oder ist es bewusst ausgeschlossen?

Das ist für uns der praktisch häufigste Fall — die meisten Gästewünsche betreffen Buchungen,
die nicht über unsere Integration entstanden sind.

## 3. Webhooks

Vielen Dank für den Link. Wir haben `reservation.updated` und `room_stay.updated` gefunden und
planen, mittelfristig darauf umzustellen, statt regelmäßig abzufragen.

- **3a)** Wird `reservation.updated` auch bei **neu angelegten** Reservierungen ausgelöst, oder
  gibt es dafür ein separates Event?
- **3b)** Enthält der Webhook-Payload die geänderten Daten, oder nur eine ID, mit der wir den
  Datensatz nachladen?

## Zum Rate Limit

Danke für die Angabe von 200 Anfragen/Minute — das ist für uns völlig ausreichend. Wir hatten
unsere Abfragen bereits entzerrt und zwischengespeichert, nachdem wir in die 20-Minuten-Sperre
gelaufen waren.

---

Über eine kurze Rückmeldung zu den Punkten 1 bis 3 würden wir uns freuen.

Mit freundlichen Grüßen

**Ayham Alkhalil**
KITech Software
aalkh@kitech-software.de

**Betreff:** API-Zugang Petul Hotels — Freischaltung Reservierungs-API und Rückfragen zum Funktionsumfang

---

Sehr geehrte Damen und Herren,

wir entwickeln für die **Petul Hotels** (5 Häuser in Essen) eine E-Mail-Automatisierung, die
Gästeanfragen mit den Buchungsdaten aus 3RPMS anreichert und Antwortentwürfe erzeugt. Die
Anbindung über Ihre GraphQL-API läuft stabil, lesend funktioniert alles wie erwartet.

Bei der Umsetzung der schreibenden Vorgänge sind wir auf einige Punkte gestoßen, zu denen wir
Sie um Auskunft bitten. Wir haben das Schema per Introspection ausgewertet, möchten aber
sichergehen, dass wir keinen vorgesehenen Weg übersehen.

## 1. Freischaltung der Reservierungs-API

`Query.ratePlans` liefert für unseren Zugang:

> „Die Reservierungs-API wurde nicht aktiviert" (`extensions.category: configuration`)

Da `rateCode` bei `ImportRoomStayInput` ein Pflichtfeld ist und laut Schema aus `ratePlans`
stammen muss, ist `importReservation` für uns derzeit nicht nutzbar.

**Bitte aktivieren Sie die Reservierungs-API für unseren API-Zugang.** Falls dafür Angaben
oder ein separater Vertrag nötig sind, teilen Sie uns bitte mit, was Sie von uns benötigen.

## 2. Änderung einer bestehenden Buchung

`UpdateRoomStayInput` kennt ausschließlich `id`, `check_in` und `check_out`,
`UpdateReservationInput` kein Datums- und kein Kategoriefeld.

- **2a)** Gibt es einen Weg, den **gebuchten Zeitraum** einer bestehenden Reservierung zu
  ändern (Umbuchung), ohne die Buchung über `importReservation` vollständig zu überschreiben?
- **2b)** Gibt es einen Weg, das **Zimmer oder die Kategorie** einer bestehenden Buchung zu
  ändern?
- **2c)** Falls beides nur über `importReservation` geht: Ist das auch für Buchungen möglich,
  die **nicht** über unsere Integration angelegt wurden (also keine uns bekannte `externalId`
  haben, z. B. Buchungen aus dem PMS selbst oder von Booking.com)?

## 3. Check-in- und Check-out-Zeiten

Laut Feldbeschreibung ist `check_out` erst setzbar, wenn der Aufenthalt bereits eingecheckt
ist. Ein häufiger Gastwunsch ist aber der **vorab zugesagte späte Check-out**.

- **3a)** Gibt es ein Feld, um eine **gewünschte** An- oder Abreisezeit vor der Anreise zu
  hinterlegen, sodass sie an der Rezeption sichtbar ist?
- **3b)** Falls nein: Wäre `ImportRoomStayInput.guestMessage` bzw. `maidNotes` der dafür
  vorgesehene Weg, oder gibt es ein passenderes Feld?

## 4. Stornierung

`ReservationStatus` enthält `CANCELLED`, erreichbar scheint der Wert aber nur über
`importReservation`.

- **4a)** Gibt es eine Möglichkeit, eine Reservierung zu stornieren, die **nicht** über unsere
  Integration angelegt wurde?
- **4b)** Falls `importReservation` der einzige Weg ist: Überschreibt ein Import mit
  `status: CANCELLED` und identischer `externalId` die bestehenden RoomStays, oder bleibt der
  Datensatz inhaltlich unverändert und ändert nur den Status?

## 5. Preise einzelner Buchungen

`updateCategoryPrices` wirkt kategorieweit und wird laut Schema sofort an die angebundenen
Portale gepusht. Für eine Kulanz- oder Sonderpreisanpassung **einer einzelnen Buchung** haben
wir keine Mutation gefunden.

- **5a)** Gibt es einen Weg, den Preis einer einzelnen Reservierung anzupassen?
- **5b)** Falls nein: Ist `createExternalSale` mit negativem `amount` ein zulässiger Weg für
  eine Gutschrift, oder raten Sie davon ab?

## 6. External Sales und Zahlungsarten

`Query.externalSalesProducts` und `Query.paymentMethods` liefern für unseren Zugang jeweils
**0 Einträge**. Laut Schema kann pro Integration genau ein Verkaufsprodukt und eine Zahlungsart
angelegt werden.

- **6a)** Können wir `createExternalSalesProduct` und `createPaymentMethod` einfach selbst
  aufrufen, oder ist dafür eine Freischaltung Ihrerseits nötig?
- **6b)** Da nur **ein** Produkt möglich ist: Ist es vorgesehen, unterschiedliche Leistungen
  (Frühstück, Hund, Parkplatz) über `amount` und `receiptNumber` zu unterscheiden — oder gibt
  es einen anderen empfohlenen Weg, damit die Positionen auf der Gastrechnung sauber lesbar sind?
- **6c)** Wie verhält sich `createExternalSale` bei einem doppelten `receiptNumber`-Wert —
  wird abgelehnt oder ein zweiter Beleg erzeugt?

## 7. Türzugang

`createRoomAccessKey` und `addRoomAccessKey` sind für uns interessant, um Gästen bei später
Anreise einen Zugangscode zu senden.

- **7a)** Ist diese Funktion an ein bestimmtes Schließsystem gebunden, oder erzeugt sie nur
  einen Datensatz, den das Schließsystem des Hauses selbst auswerten muss?
- **7b)** Ist sie für unseren Zugang nutzbar, oder ebenfalls freischaltpflichtig?

## 8. Webhooks

`createWebhookEndpoint` erwartet ein Feld `events: [String!]!`.

- **8a)** Wo finden wir die Liste der verfügbaren Event-Namen?
- **8b)** Gibt es ein Event für neue oder geänderte Reservierungen? Das würde uns erlauben,
  auf Änderungen zu reagieren, statt regelmäßig abzufragen — und damit Ihre API deutlich zu
  entlasten.

## 9. Abfragelimits

Uns ist aufgefallen, dass unsere IP nach mehreren Abfragen in kurzer Folge für etwa 13 Minuten
auf TCP-Ebene blockiert wurde. Wir haben unsere Abfragen daraufhin entzerrt und zwischengespeichert.

- **9a)** Welche Rate ist zulässig (Anfragen pro Minute)?
- **9b)** Gibt es einen Response-Header, an dem wir das verbleibende Kontingent ablesen können?

---

Über eine Rückmeldung — gern auch stichpunktartig — würden wir uns sehr freuen. Wenn einzelne
Punkte einen Anruf einfacher machen, melden wir uns gern telefonisch.

Vielen Dank für Ihre Unterstützung.

Mit freundlichen Grüßen

**Ayham Alkhalil**
KITech Software
aalkh@kitech-software.de

*Betroffene Häuser: Hotel Petul „An der Zeche", Hotel Apart „An'ne 40", Hotel Apart „Residenz",
Hotel Apart „Am Ruhrbogen", Art Hotel Brunnen*

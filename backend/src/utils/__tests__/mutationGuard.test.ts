import { validateMutation } from "../mutationGuard";

const FAELLE: [string, string][] = [
  ["REAL 1: updateRoomStay mit mealNotes/guestMessage",
   `mutation { updateRoomStay(input: { id: "11697546", check_in: "2026-08-08T15:00:00", check_out: "2026-08-09T12:00:00", mealNotes: "", guestMessage: "Ihre Reservierung wurde geändert." }) { roomStay { id } } }`],
  ["REAL 2: importReservation mit CLIENT_ID-Platzhalter",
   `mutation { importReservation(input: { externalId: "9434159", client: { id: "CLIENT_ID" }, roomStays: [{ category: "10041", reservation_from: "2026-10-06", reservation_to: "2026-10-08", rates: [99.00] }] }) { reservation { id } } }`],
  ["REAL 3: updateRoomStay, Datum ohne Zeitzone",
   `mutation { updateRoomStay(input: { id: "123", check_out: "2026-10-25T14:00:00" }) { roomStay { id } } }`],
  ["REAL 4: importReservation mit E-Mail als externalId",
   `mutation { importReservation(input: { externalId: "a@b.de", client: { id: "CLIENT_ID" }, roomStays: [{ category: "10041", reservation_from: "2026-09-06", reservation_to: "2026-09-20", rates: [] }] }) { reservation { id } } }`],
  ["KORREKT: updateRoomStay mit Zeitzone",
   `mutation { updateRoomStay(input: { id: "11697546", check_out: "2026-10-25T14:00:00+02:00" }) { roomStay { id } } }`],
  ["KORREKT: createExternalSale vollstaendig",
   `mutation { createExternalSale(input: { productId: "1234", roomStayId: "11697546", amount: "15.00", saleCreatedAt: "2026-08-01T10:00:00+02:00", receiptNumber: "REC-1" }) { sale { id } } }`],
  ["ANGRIFF: nicht freigegebene Mutation",
   `mutation { deletePaymentMethod(input: { id: "1" }) { ok } }`],
];

let pass = 0;
for (const [label, m] of FAELLE) {
  const r = validateMutation(m);
  const erwartetOk = label.startsWith("KORREKT");
  const korrekt = r.ok === erwartetOk;
  if (korrekt) pass++;
  console.log(`${korrekt ? "✅" : "❌ TESTFEHLER"}  ${label}`);
  console.log(`     → ${r.ok ? "AUSFÜHRBAR" : "abgelehnt: " + r.reason}\n`);
}
console.log(`${pass}/${FAELLE.length} Fälle korrekt bewertet.`);
process.exit(pass === FAELLE.length ? 0 : 1);

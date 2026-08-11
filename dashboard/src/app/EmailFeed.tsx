"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
    ArrowRight, Minimize2, Layers, CheckCircle2, Terminal, BrainCircuit, PenTool,
    Database, MessageSquare, Copy, Check, ChevronRight, Sparkles, RefreshCw,
    XCircle, Clock, Send, AlertTriangle, Loader2, Maximize2, X, Settings, LogOut, Lock, Unlock
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
    fetchEmails as fetchEmailsAction,
    fetchEmailBody,
    selectMail,
    updateHotel as updateHotelAction,
    regenerateDraft,
    forceProcess as forceProcessAction,
    approveOrRejectMail,
    fetchCapabilities,
} from "./emails/actions";
import { logout } from "./auth/actions";
import { DONE_STATUSES } from "./emails/constants";

type Email = {
    id: string;
    mail_id: string;
    betreff?: string;
    body_text?: string;
    body_html?: string;
    received_at: string;
    status?: string;
    intent?: string;
    policy_decision_allowed?: boolean;
    policy_decision_reason?: string;
    api_action?: string;
    draft_reply?: string;
    has_attachments?: boolean;
    agent_logs?: any;
    senders?: { email: string; name?: string }[];
};

// Wohin die Antwort tatsächlich geht. Bei Portal-Mails (Booking.com, Airbnb) ist der
// Absender noreply@… und nur Reply-To erreicht den Gast — der Unterschied war im
// Dashboard bisher nirgends sichtbar, obwohl er darüber entscheidet, ob der Gast
// die Antwort je zu sehen bekommt.
function getReplyRecipient(email: Email | null | undefined): string | null {
    if (!email) return null;
    return email.agent_logs?.reply_to || email.senders?.[0]?.email || null;
}

type Capability = {
    hotelId: string;
    hotelName: string;
    reservierungsApi: boolean;
    salesProduct: boolean;
    paymentMethod: boolean;
    geprueftAm: string | null;
};

/** Anzahl der noch gesperrten Freischaltpunkte eines Hauses (0-3). */
function gesperrteAnzahl(c: Capability): number {
    return [c.reservierungsApi, c.salesProduct, c.paymentMethod].filter(x => !x).length;
}

/** Sind alle Häuser identisch freigeschaltet? Dann genügt eine gemeinsame Anzeige. */
function alleGleich(caps: Capability[]): boolean {
    if (caps.length < 2) return true;
    const k = (c: Capability) => `${c.reservierungsApi}|${c.salesProduct}|${c.paymentMethod}`;
    return caps.every(c => k(c) === k(caps[0]));
}

/**
 * Erklärt in Alltagssprache, was das System selbst erledigt und was die Rezeption
 * von Hand tun muss. Bewusst ohne Fachbegriffe: "Reservierungs-API" oder
 * "createExternalSale" sagen der Nutzerin nichts — der Unterschied zwischen
 * "geht grundsätzlich nicht" und "ist nur noch nicht freigeschaltet" schon.
 */
function CapabilityPanel({ caps, onClose }: { caps: Capability[]; onClose: () => void }) {
    // Was unabhängig von jeder Freischaltung unmöglich ist. Steht so auch im Backend
    // (pmsCapabilities.ts, NICHT_MOEGLICH) — hier in Nutzersprache übersetzt.
    const grundsaetzlich = [
        ["Umbuchung auf einen anderen Zeitraum", "Das Hotelsystem bietet dafür keine Schnittstelle an."],
        ["Zimmer- oder Kategoriewechsel", "Das Hotelsystem bietet dafür keine Schnittstelle an."],
        ["Preis einer einzelnen Buchung ändern", "Nur der Preis einer ganzen Kategorie wäre änderbar — das würde alle Gäste betreffen und sofort an Booking.com & Co. gemeldet."],
        ["Späteren Check-out vorab eintragen", "Die Abreisezeit lässt sich erst eintragen, wenn der Gast eingecheckt hat."],
        ["Fremde Buchung stornieren", "Nur Buchungen, die dieses Programm selbst angelegt hat, lassen sich darüber stornieren."],
    ];

    return (
        <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-8"
            onClick={onClose}
        >
            <motion.div
                initial={{ scale: 0.97, y: 8 }} animate={{ scale: 1, y: 0 }}
                className="bg-white w-full max-w-3xl max-h-[85vh] overflow-y-auto custom-scrollbar shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="sticky top-0 bg-[#444444] text-white px-7 py-5 flex items-start justify-between">
                    <div>
                        <h2 className="text-[15px] font-black uppercase tracking-widest">Was das System automatisch kann</h2>
                        <p className="text-[11px] text-white/50 mt-1 max-w-xl leading-relaxed">
                            Petulia schreibt immer den Antwortentwurf. Ob sie die Änderung auch im Hotelsystem
                            eintragen kann, hängt davon ab, was 3RPMS über die Schnittstelle zulässt.
                        </p>
                    </div>
                    <button onClick={onClose} className="text-white/40 hover:text-white shrink-0 ml-4"><X className="w-5 h-5" /></button>
                </div>

                <div className="px-7 py-6 space-y-7">
                    <section>
                        <h3 className="text-[10px] font-black uppercase tracking-widest text-black/35 mb-3">
                            Eintragen ins Hotelsystem
                        </h3>
                        {/* Solange alle Häuser identisch freigeschaltet sind, wäre eine Auflistung
                            pro Haus fünfmal dasselbe. Sobald 3RPMS für ein Haus etwas freischaltet,
                            klappt die Ansicht automatisch auf die Einzeldarstellung um. */}
                        {alleGleich(caps) ? (
                            <>
                                <div className="space-y-2">
                                    {([
                                        ["Buchungen anlegen", caps[0].reservierungsApi,
                                         "Die Reservierungs-API muss von 3RPMS für den Zugang freigeschaltet werden."],
                                        ["Zusatzleistungen verbuchen", caps[0].salesProduct,
                                         "Ein Verkaufsprodukt muss einmalig in der Schnittstelle eingerichtet werden."],
                                        ["Anzahlungen verbuchen", caps[0].paymentMethod,
                                         "Eine Zahlungsart muss einmalig in der Schnittstelle eingerichtet werden."],
                                    ] as [string, boolean, string][]).map(([label, ok, hinweis]) => (
                                        <div key={label} className={`border-l-4 px-4 py-3 ${ok ? "border-[#009697] bg-[#009697]/5" : "border-[#F39200] bg-[#F39200]/5"}`}>
                                            <div className="flex items-center gap-2">
                                                {ok ? <Unlock className="w-3.5 h-3.5 text-[#009697]" /> : <Lock className="w-3.5 h-3.5 text-[#F39200]" />}
                                                <span className="text-[12px] font-bold">{label}</span>
                                                <span className={`ml-auto text-[9px] font-black uppercase tracking-widest shrink-0 ${ok ? "text-[#009697]" : "text-[#F39200]"}`}>
                                                    {ok ? "automatisch" : "noch nicht freigeschaltet"}
                                                </span>
                                            </div>
                                            {!ok && (
                                                <div className="mt-1.5 text-[10px] text-black/45 leading-relaxed">
                                                    {hinweis} Bis dahin entstehen die Entwürfe trotzdem — die Eintragung
                                                    erledigt die Rezeption von Hand, der Hinweis dazu steht über dem Entwurf.
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                                <p className="mt-2 text-[9px] text-black/30">
                                    Gilt für alle {caps.length} Häuser gemeinsam — die Freischaltung hängt am Zugang, nicht am einzelnen Haus.
                                </p>
                            </>
                        ) : (
                            <div className="space-y-2">
                                {caps.map(c => (
                                    <div key={c.hotelId || c.hotelName}
                                         className={`border-l-4 px-4 py-3 ${gesperrteAnzahl(c) === 0 ? "border-[#009697] bg-[#009697]/5" : "border-[#F39200] bg-[#F39200]/5"}`}>
                                        <div className="flex items-center gap-2">
                                            {gesperrteAnzahl(c) === 0
                                                ? <Unlock className="w-3.5 h-3.5 text-[#009697]" />
                                                : <Lock className="w-3.5 h-3.5 text-[#F39200]" />}
                                            <span className="text-[12px] font-bold">{c.hotelName}</span>
                                        </div>
                                        <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
                                            {([["Buchungen", c.reservierungsApi],
                                               ["Zusatzleistungen", c.salesProduct],
                                               ["Anzahlungen", c.paymentMethod]] as [string, boolean][]).map(([label, ok]) => (
                                                <div key={label} className="flex items-center gap-1.5">
                                                    {ok ? <CheckCircle2 className="w-3 h-3 text-[#009697] shrink-0" />
                                                        : <Lock className="w-3 h-3 text-black/25 shrink-0" />}
                                                    <span className={ok ? "text-black/70" : "text-black/35"}>{label}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    <section>
                        <h3 className="text-[10px] font-black uppercase tracking-widest text-black/35 mb-3">Immer automatisch</h3>
                        <ul className="space-y-1.5">
                            {["Antwortentwurf in der Sprache des Gastes",
                              "Buchungsdaten des Gastes heraussuchen und im Entwurf verwenden",
                              "Verfügbarkeit für einen Wunschzeitraum prüfen",
                              "Mitreisende zu einer Buchung hinzufügen oder entfernen",
                              "Neuen Gast im Hotelsystem anlegen",
                              "Spam und Portal-Benachrichtigungen aussortieren"].map(t => (
                                <li key={t} className="flex items-start gap-2 text-[11px] text-black/65">
                                    <CheckCircle2 className="w-3.5 h-3.5 text-[#009697] shrink-0 mt-px" />{t}
                                </li>
                            ))}
                        </ul>
                    </section>

                    <section>
                        <h3 className="text-[10px] font-black uppercase tracking-widest text-black/35 mb-3">
                            Geht grundsätzlich nicht — bitte immer von Hand
                        </h3>
                        <div className="space-y-2">
                            {grundsaetzlich.map(([titel, grund]) => (
                                <div key={titel} className="flex items-start gap-2.5 px-3 py-2 bg-black/[0.03]">
                                    <XCircle className="w-3.5 h-3.5 text-[#E2001A] shrink-0 mt-0.5" />
                                    <div>
                                        <div className="text-[11px] font-bold text-black/70">{titel}</div>
                                        <div className="text-[10px] text-black/45 leading-relaxed mt-0.5">{grund}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <p className="mt-3 text-[10px] text-black/40 leading-relaxed">
                            In diesen Fällen schreibt Petulia eine Antwort, die nichts Falsches verspricht —
                            und zeigt über dem Entwurf an, was noch im 3RPMS zu erledigen ist.
                        </p>
                    </section>

                    {caps[0]?.geprueftAm && (
                        <p className="text-[9px] text-black/25 pt-2 border-t border-black/5">
                            Zuletzt geprüft: {new Date(caps[0].geprueftAm).toLocaleString("de-DE")} · Der Stand wird bei
                            jedem Programmstart und alle 6 Stunden neu ermittelt.
                        </p>
                    )}
                </div>
            </motion.div>
        </motion.div>
    );
}

function getApiActionLabel(action: string | undefined): { title: string; beschreibung: string } | null {
    if (!action || action === "none") return null;
    const map: Record<string, { title: string; beschreibung: string }> = {
        importReservation:                  { title: "Neue Buchung anlegen",        beschreibung: "Die Reservierung wird direkt im Hotelsystem eingetragen." },
        updateRoomStay:                     { title: "Aufenthalt anpassen",         beschreibung: "Check-in- oder Check-out-Zeit wird im System geändert." },
        createExternalSale:                 { title: "Zusatzleistung buchen",       beschreibung: "Wird direkt der Buchung angerechnet (z. B. Hund, Frühstück, Parkplatz)." },
        updateReservation:                  { title: "Buchungsdaten aktualisieren", beschreibung: "Informationen zur Reservierung werden im System geändert." },
        addRoomStayGuest:                   { title: "Gast hinzufügen",            beschreibung: "Eine weitere Person wird zur Buchung eingetragen." },
        removeRoomStayGuest:                { title: "Gast entfernen",             beschreibung: "Eine Person wird aus der Buchung ausgetragen." },
        "Manuelle Stornierung durch Empfang": { title: "Stornierung — manuell",    beschreibung: "Bitte diese Buchung direkt im Hotelsystem stornieren." },
    };
    return map[action] ?? { title: action, beschreibung: "Aktion wird nach Bestätigung ausgeführt." };
}

// ─── Status-Badge ──────────────────────────────────────────────────────────────

function StatusDot({ status }: { status?: string }) {
    const map: Record<string, { color: string; label: string; pulse?: boolean }> = {
        new:        { color: "#aaa",    label: "Neu" },
        queued:     { color: "#6082B6", label: "Läuft",      pulse: true },
        processing: { color: "#F39200", label: "Wartet",     pulse: true },
        approved:   { color: "#009697", label: "Genehmigt",  pulse: true },
        sending:    { color: "#009697", label: "Sendet",     pulse: true },
        sent:       { color: "#22c55e", label: "Gesendet" },
        send_failed:{ color: "#E2001A", label: "Unzustellbar" },
        rejected:   { color: "#E2001A", label: "Abgelehnt" },
        ignored:    { color: "#aaa",    label: "Ignoriert" },
        failed:     { color: "#E2001A", label: "Fehler" },
    };
    const s = map[status ?? ""] ?? { color: "#aaa", label: "—" };
    return (
        <span className="flex items-center gap-1 shrink-0">
            <span
                className={`w-1.5 h-1.5 rounded-full inline-block ${s.pulse ? "animate-pulse" : ""}`}
                style={{ background: s.color }}
            />
            <span className="text-[7px] font-black uppercase tracking-wider" style={{ color: s.color }}>
                {s.label}
            </span>
        </span>
    );
}

// ─── Agent Progress Header ─────────────────────────────────────────────────────

function AgentProgressSlim({ step, currentMail }: { step: number; currentMail: Email }) {
    const hotelName = currentMail.agent_logs?.target_hotel || "UNKLAR";

    const stages = [
        { name: "PRÜFUNG", icon: BrainCircuit, warning: false },
        { name: "HOTEL",   icon: Database,     warning: hotelName === "UNKLAR" },
        { name: "WISSEN",  icon: Terminal,      warning: false },
        { name: "ENTWURF", icon: PenTool,       warning: false },
    ];

    return (
        <div className="flex items-center gap-1.5">
            {stages.map((stage, idx) => {
                const isDone   = step > idx;
                const isActive = step === idx;
                const Icon     = stage.icon;
                const isWarn   = stage.warning && (isActive || isDone);

                let col = "text-black/15";
                if (isWarn)       col = "text-[#E2001A]";
                else if (isDone)  col = "text-[#009697]";
                else if (isActive) col = "text-[#6082B6]";

                return (
                    <div key={idx} className="flex items-center gap-1">
                        <div className={`flex items-center gap-1 transition-all duration-300 ${col}`}>
                            {isDone && !isWarn
                                ? <CheckCircle2 className="w-3.5 h-3.5" />
                                : <Icon className={`w-3.5 h-3.5 ${isActive ? "animate-pulse" : ""}`} />
                            }
                            <span className="text-[8px] font-black uppercase tracking-widest hidden xl:inline">{stage.name}</span>
                        </div>
                        {idx < stages.length - 1 && (
                            <div className={`w-3 h-px mx-0.5 transition-all duration-300 ${isDone ? "bg-[#009697]" : "bg-black/10"}`} />
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// ─── Hotel Selector ────────────────────────────────────────────────────────────

function HotelSelectorHeader({ hotelName, onUpdateHotel }: { hotelName: string; onUpdateHotel: (h: string) => void }) {
    const hotelOptions = [
        "Hotel Petul \"An der Zeche\"",
        "Hotel Apart \"An'ne 40\"",
        "Hotel Apart \"Residenz\"",
        "Hotel Apart \"Am Ruhrbogen\"",
        "Art Hotel Brunnen",
    ];
    const isUnclear = !hotelName || hotelName === "UNKLAR";

    return (
        <div className="flex items-center gap-3">
            <div className="flex flex-col">
                <span className="text-[9px] font-black text-black/30 uppercase tracking-[0.2em] mb-1">Ziel-Etablissement</span>
                <select
                    className={`appearance-none bg-white border-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest cursor-pointer outline-none transition-all ${
                        isUnclear
                            ? "border-[#E2001A] text-[#E2001A] shadow-[3px_3px_0px_0px_rgba(226,0,26,0.1)] animate-pulse"
                            : "border-black text-black hover:bg-black hover:text-white"
                    }`}
                    value={isUnclear ? "" : hotelName}
                    onChange={(e) => onUpdateHotel(e.target.value)}
                >
                    <option value="" disabled>{isUnclear ? "HOTEL JETZT WÄHLEN ↓" : hotelName}</option>
                    {hotelOptions.map((opt) => (
                        <option key={opt} value={opt} className="text-black bg-white">{opt.toUpperCase()}</option>
                    ))}
                </select>
            </div>
            <div className="h-8 w-px bg-black/10" />
        </div>
    );
}

// ─── PMS Data Extractor ────────────────────────────────────────────────────────
// Handles both: direct reservation (via code) and email-search result (client + reservations)

function guestDisplayName(client: any): string {
    if (!client) return "—";
    const full = [client.firstname, client.lastname].filter(Boolean).join(" ");
    return full || client.email || "—";
}

function extractPmsDisplayData(threeRpmsData: any) {
    if (!threeRpmsData) return null;

    // Format A: direkte Reservierung (via getReservationByCode)
    if (threeRpmsData.code) {
        const firstStay = threeRpmsData.rooms?.edges?.[0]?.node;
        return {
            guestName: guestDisplayName(threeRpmsData.client || threeRpmsData.first_guest),
            code:   threeRpmsData.code || "—",
            from:   firstStay?.reservation_from || "—",
            to:     firstStay?.reservation_to   || "—",
            status: threeRpmsData.status || "Aktive Buchung",
            room:   firstStay?.roomName || "—",
        };
    }

    // Format B: E-Mail-Suche (client + roomStays[])
    const client = threeRpmsData.client;
    if (client) {
        const firstStay = threeRpmsData.roomStays?.[0];
        const res = firstStay?.reservation;
        return {
            guestName: guestDisplayName(client),
            code:   res?.code || "—",
            from:   firstStay?.reservation_from || res?.reservationFrom || "—",
            to:     firstStay?.reservation_to   || res?.reservationTo   || "—",
            status: res?.status || "Gefunden",
            room:   firstStay?.roomName || "—",
        };
    }

    // Format C: room_stay direkt
    if (threeRpmsData.reservation_from || threeRpmsData.roomName) {
        return {
            guestName: guestDisplayName(threeRpmsData.first_guest),
            code:   threeRpmsData.reservation?.code || "—",
            from:   threeRpmsData.reservation_from || "—",
            to:     threeRpmsData.reservation_to   || "—",
            status: threeRpmsData.reservation?.status || "—",
            room:   threeRpmsData.roomName || "—",
        };
    }

    return null;
}

// ─── Status-Overlay (für sent / rejected / failed) ────────────────────────────

function StatusOverlay({ status, intent, onRegenerate, errors }: { status: string; intent?: string; onRegenerate?: () => void; errors?: string[] }) {
    if (status === "sent") {
        return (
            <div className="flex-1 flex flex-col items-center justify-center gap-5 text-[#009697]">
                <div className="w-16 h-16 border-2 border-[#009697] flex items-center justify-center">
                    <Send className="w-7 h-7" />
                </div>
                <div className="text-center">
                    <div className="text-sm font-bold uppercase tracking-[0.2em]">E-Mail gesendet</div>
                    <div className="text-[10px] text-black/30 mt-1 uppercase tracking-widest">Antwort erfolgreich übermittelt</div>
                </div>
            </div>
        );
    }
    if (status === "approved") {
        return (
            <div className="flex-1 flex flex-col items-center justify-center gap-5 text-[#6082B6]">
                <div className="w-16 h-16 border-2 border-[#6082B6] flex items-center justify-center">
                    <Loader2 className="w-7 h-7 animate-spin" />
                </div>
                <div className="text-center">
                    <div className="text-sm font-bold uppercase tracking-[0.2em]">Wird verarbeitet</div>
                    <div className="text-[10px] text-black/30 mt-1 uppercase tracking-widest">E-Mail wird gleich gesendet...</div>
                </div>
            </div>
        );
    }
    if (status === "rejected") {
        return (
            <div className="flex-1 flex flex-col items-center justify-center gap-5 text-[#E2001A]">
                <div className="w-16 h-16 border-2 border-[#E2001A] flex items-center justify-center">
                    <XCircle className="w-7 h-7" />
                </div>
                <div className="text-center">
                    <div className="text-sm font-bold uppercase tracking-[0.2em]">Abgelehnt</div>
                    <div className="text-[10px] text-black/30 mt-1 uppercase tracking-widest">Keine Antwort gesendet</div>
                </div>
                {onRegenerate && (
                    <button
                        onClick={onRegenerate}
                        className="flex items-center gap-2 px-4 py-2 border border-[#E2001A]/30 hover:bg-[#E2001A] hover:text-white text-[#E2001A] text-[10px] font-bold uppercase tracking-widest transition-all"
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Neu generieren
                    </button>
                )}
            </div>
        );
    }
    if (status === "failed") {
        return (
            <div className="flex-1 flex flex-col items-center justify-center gap-5 px-10">
                <div className="w-16 h-16 border-2 border-[#E2001A] flex items-center justify-center text-[#E2001A]">
                    <AlertTriangle className="w-7 h-7" />
                </div>
                <div className="text-center">
                    <div className="text-sm font-bold uppercase tracking-[0.2em] text-[#E2001A]">Schnittstellenfehler</div>
                    <div className="text-[10px] text-black/30 mt-1 uppercase tracking-widest">Kein Entwurf erstellt — bitte manuell bearbeiten</div>
                </div>
                {errors && errors.length > 0 && (
                    <div className="w-full max-w-sm bg-[#F9F9F9] border border-[#E2001A]/20 p-3 space-y-1">
                        {errors.map((err, i) => (
                            <div key={i} className="text-[9px] font-mono text-black/40 break-all leading-snug">{err}</div>
                        ))}
                    </div>
                )}
                {onRegenerate && (
                    <button
                        onClick={onRegenerate}
                        className="flex items-center gap-2 px-4 py-2 border border-[#6082B6]/30 hover:bg-[#6082B6] hover:text-white text-[#6082B6] text-[10px] font-bold uppercase tracking-widest transition-all"
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Erneut versuchen
                    </button>
                )}
            </div>
        );
    }
    return null;
}

// ─── Mail-Body-Rendering (geteilt zwischen Vorschau-Spalte, Vollbild-Modal, Ignored-Ansicht) ──

function MailBodyContent({ email, className = "" }: { email: Email; className?: string }) {
    if (email.body_html) {
        return (
            <div
                className={`prose max-w-none break-words overflow-hidden [&_*]:max-w-full [&_img]:max-w-full [&_table]:w-full ${className}`}
                dangerouslySetInnerHTML={{ __html: email.body_html }}
            />
        );
    }
    return (
        <div className={`whitespace-pre-wrap ${className}`}>
            {(email.body_text || "")
                .replace(/&zwnj;/g, "")
                .replace(/&nbsp;/g, " ")
                .replace(/&amp;/g, "&")
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&quot;/g, '"')
                // Numerische Entities werden DEKODIERT, nicht gelöscht. Vorher stand hier
                // .replace(/&#\d+;/g, "") — aus "Gr&#252;&#223;e" wurde damit "Gre" und aus
                // "G&#228;ste" wurde "Gste". Die KI bekam den korrekten Rohtext, die
                // Rezeptionistin las eine verstümmelte Fassung und beurteilte den Entwurf
                // auf dieser Grundlage.
                .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
                .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
                .replace(/‌/g, "")
                .trim()}
        </div>
    );
}

// ─── Mail-Vergrößerung (Vollbild-Ansicht) ─────────────────────────────────────

function MailExpandModal({ email, onClose }: { email: Email; onClose: () => void }) {
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-8"
            onClick={onClose}
        >
            <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.15 }}
                className="bg-white w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="shrink-0 px-6 py-4 border-b border-black/8 flex items-center justify-between gap-2 text-black/25">
                    <div className="flex items-center gap-2">
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span className="text-[9px] font-black uppercase tracking-[0.35em]">Eingehende Mail</span>
                    </div>
                    <button onClick={onClose} title="Schließen" className="hover:text-black transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
                    <div className="mb-5 pb-5 border-b border-black/5">
                        <div className="text-[8px] uppercase font-black tracking-widest text-black/20 mb-1.5">Betreff</div>
                        <h2 className="text-[20px] font-bold tracking-tight leading-snug text-black">
                            {email.betreff}
                        </h2>
                    </div>

                    {email.senders?.[0] && (
                        <div className="flex items-center gap-3 mb-6 p-4 bg-[#F9F9F9] border border-black/5">
                            <div className="w-10 h-10 bg-[#6082B6] flex items-center justify-center shrink-0 text-white text-[14px] font-black">
                                {(email.senders[0].name || email.senders[0].email).charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                                <div className="text-[14px] font-bold truncate leading-tight">
                                    {email.senders[0].name || email.senders[0].email}
                                </div>
                                <div className="text-[11px] text-black/30 truncate">
                                    {email.senders[0].email}
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="text-[15px] leading-relaxed text-black/70">
                        <MailBodyContent email={email} />
                    </div>
                </div>
            </motion.div>
        </motion.div>
    );
}

// ─── Haupt-Komponente ─────────────────────────────────────────────────────────

export function EmailFeed({ emails: initialEmails }: { emails: Email[] }) {
    const router = useRouter();
    const [emails, setEmails] = useState<Email[]>(initialEmails);
    const [selectedId, setSelectedId] = useState<string | null>(
        initialEmails.find((e) => e.status === "processing")?.id || null
    );
    const [actionStatus, setActionStatus] = useState<"idle" | "approving" | "rejecting" | "regenerating">("idle");
    const [actionError, setActionError] = useState<string | null>(null);
    const [capabilities, setCapabilities] = useState<Capability[]>([]);
    const [showCapabilities, setShowCapabilities] = useState(false);
    const [isMinimized, setIsMinimized] = useState(false);
    const [isMailExpanded, setIsMailExpanded] = useState(false);
    const [step, setStep] = useState(0);
    const [editedDraft, setEditedDraft] = useState<string>("");
    const [copied, setCopied] = useState(false);
    const notifiedIds = useRef<Set<string>>(new Set(initialEmails.map((e) => e.id)));

    const pendingCount = emails.filter((e) => e.status === "processing").length;
    const currentMail = emails.find((e) => e.id === selectedId);

    // ─── Mail-Body: gezielt pro ausgewählter Mail nachladen ──────────────────
    // Die Liste/das Polling liefert bewusst KEINEN body_text/body_html mehr (siehe
    // emails/constants.ts) — das war der Haupttreiber für den Supabase-Egress-Überlauf.
    const [mailBody, setMailBody] = useState<{ id: string; body_text?: string; body_html?: string } | null>(null);
    const [loadingBody, setLoadingBody] = useState(false);

    useEffect(() => {
        if (!selectedId) { setMailBody(null); return; }
        let cancelled = false;
        setLoadingBody(true);
        fetchEmailBody(selectedId).then((data) => {
            if (!cancelled && data) setMailBody(data);
            if (!cancelled) setLoadingBody(false);
        });
        return () => { cancelled = true; };
    }, [selectedId]);

    const currentMailWithBody = currentMail
        ? { ...currentMail, ...(mailBody?.id === currentMail.id ? mailBody : { body_text: undefined, body_html: undefined }) }
        : null;

    // ─── Realtime-ähnliches Polling ─────────────────────────────────────────
    // 15s wenn aktive Mails vorhanden, sonst 60s (vorher 8s/45s — jede Mail in der Liste
    // liefert ihr komplettes agent_logs-JSONB mit, gemessen ~150KB pro Fetch bei ~300
    // aktiven Mails; bei durchgehend offenem Dashboard war das mit 8s-Takt der mit Abstand
    // größte einzelne Egress-Treiber, ~66MB/h. Gröberer Takt halbiert das ohne spürbaren
    // UX-Verlust — die Pipeline selbst braucht ohnehin mehrere Sekunden pro Mail.

    const fetchEmails = useCallback(async () => {
        const data = await fetchEmailsAction();
        if (data) setEmails(data as Email[]);
    }, []);

    // Der Fähigkeitsstand ändert sich nur, wenn 3RPMS etwas freischaltet — einmal beim
    // Laden reicht. Bewusst NICHT im Polling-Takt: die Anzeige wäre identisch, der
    // Egress aber dauerhaft höher.
    useEffect(() => {
        fetchCapabilities().then(d => setCapabilities((d ?? []) as Capability[]));
    }, []);

    useEffect(() => {
        const hasActive = emails.some((e) => e.status === "queued" || e.status === "approved");
        const interval = setInterval(fetchEmails, hasActive ? 15000 : 60000);
        return () => clearInterval(interval);
    }, [emails, fetchEmails]);

    // ─── Browser-Benachrichtigungen ─────────────────────────────────────────

    useEffect(() => {
        if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
            Notification.requestPermission();
        }
    }, []);

    useEffect(() => {
        for (const email of emails.filter((e) => e.status === "processing")) {
            if (!notifiedIds.current.has(email.id)) {
                notifiedIds.current.add(email.id);
                if (typeof window !== "undefined" && Notification.permission === "granted") {
                    new Notification("Neue E-Mail — Petulia", {
                        body: email.betreff || "Neue eingehende E-Mail",
                        icon: "/favicon.ico",
                    });
                }
            }
        }
    }, [emails]);

    // ─── Draft-Sync beim Mail-Wechsel ────────────────────────────────────────

    useEffect(() => {
        setEditedDraft(currentMail?.draft_reply || "");
        setCopied(false);
        setIsMailExpanded(false);
    }, [selectedId, currentMail?.draft_reply]);

    // ─── Agent-Progress-Animation ────────────────────────────────────────────
    // Nur animieren, wenn wirklich noch kein Entwurf da ist (z.B. Status "processing"
    // wird zwar sofort mit fertigem draft_reply erreicht — Status heißt per Definition
    // "Entwurf ist fertig"). Liegt der Entwurf schon vor, sofort voll anzeigen statt
    // Text und Aktions-Buttons künstlich 2s zu verstecken/sperren — die KI-Pipeline lief
    // längst im Hintergrund, das hier ist nur eine Ziereffekt-Animation, kein echter Ladevorgang.

    useEffect(() => {
        if (!currentMail) return;
        if (currentMail.draft_reply) {
            setStep(4);
            return;
        }
        setStep(0);
        const timers = [
            setTimeout(() => setStep(1), 500),
            setTimeout(() => setStep(2), 1000),
            setTimeout(() => setStep(3), 1500),
            setTimeout(() => setStep(4), 2000),
        ];
        return () => timers.forEach(clearTimeout);
    }, [selectedId, currentMail?.draft_reply]);

    // ─── Nach Aktion: nächste "processing" Mail auswählen ────────────────────

    const autoSelectNext = useCallback((excludeId: string) => {
        const nextMail = emails.find((e) => e.status === "processing" && e.id !== excludeId);
        if (nextMail) {
            setSelectedId(nextMail.id);
        }
    }, [emails]);

    // ─── Handlers ────────────────────────────────────────────────────────────

    const handleSelectMail = async (email: Email) => {
        setSelectedId(email.id);
        if (email.status === "new") {
            await selectMail(email.id, email.agent_logs);
            await fetchEmails();
        }
    };

    const handleUpdateHotel = async (hotel: string) => {
        if (!currentMail) return;
        await updateHotelAction(currentMail.id, hotel, currentMail.agent_logs);
        await fetchEmails();
    };

    const handleCopy = async () => {
        if (!editedDraft) return;
        await navigator.clipboard.writeText(editedDraft);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleRegenerate = async () => {
        if (!currentMail) return;
        setActionStatus("regenerating");
        setStep(0);
        await regenerateDraft(currentMail.id, currentMail.agent_logs);
        setEditedDraft("");
        await fetchEmails();
        setActionStatus("idle");
    };

    const handleForceProcess = async () => {
        if (!currentMail) return;
        setActionStatus("regenerating");
        setStep(0);
        await forceProcessAction(currentMail.id, currentMail.agent_logs);
        setEditedDraft("");
        await fetchEmails();
        setActionStatus("idle");
    };

    const handleAction = async (action: "approve" | "reject") => {
        if (!currentMail) return;
        const currentId = currentMail.id;
        setActionStatus(action === "approve" ? "approving" : "rejecting");
        setActionError(null);

        // Der Rückgabewert wurde bisher komplett verworfen. Schlug die Freigabe fehl —
        // etwa weil die Mail zwischenzeitlich neu analysiert oder von einer Kollegin
        // freigegeben wurde —, sprang die Oberfläche trotzdem zur nächsten Mail und
        // suggerierte Erfolg. Der Gast bekam nie eine Antwort, und niemand erfuhr davon.
        const result = await approveOrRejectMail(currentId, action, action === "approve" ? editedDraft : undefined);
        await fetchEmails();
        setActionStatus("idle");

        if (result?.error) {
            setActionError(result.error);
            return; // bewusst KEIN Weiterspringen — die Mail braucht Aufmerksamkeit
        }

        // Nach kurzer Verzögerung zur nächsten Mail wechseln
        setTimeout(() => autoSelectNext(currentId), 400);
    };

    // ─── PMS-Daten extrahieren ────────────────────────────────────────────────

    const pmsData = extractPmsDisplayData(currentMail?.agent_logs?.threeRpmsData ?? null);
    const isTerminal = ["sent", "rejected", "ignored", "failed", "approved"].includes(currentMail?.status ?? "");
    const isQueued = currentMail?.status === "queued";
    const isNew = currentMail?.status === "new";

    // ─── Render ───────────────────────────────────────────────────────────────

    return (
        <div className="relative w-full h-screen overflow-hidden bg-[#F9F9F9] text-black tracking-tight selection:bg-[#6082B6] selection:text-white font-sans">
            <AnimatePresence mode="wait">
                {!isMinimized ? (
                    <motion.div
                        key="expanded"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="absolute inset-0 flex bg-white overflow-hidden"
                    >
                        {/* ── LINKE SIDEBAR ── */}
                        <div className="w-64 shrink-0 border-r border-black/10 flex flex-col bg-[#444444] text-white">
                            <div className="px-5 pt-5 pb-4">
                                <div className="flex items-start justify-between mb-3">
                                    <div className="flex flex-col">
                                        <h1 className="text-[16px] font-serif tracking-widest leading-none mb-0.5 uppercase">Apart Hotels</h1>
                                        <span className="text-[14px] font-light italic lowercase opacity-70" style={{ fontFamily: "serif" }}>petul</span>
                                    </div>
                                    <div className="flex items-center gap-2.5 mt-1">
                                        <button
                                            onClick={() => router.push("/settings")}
                                            title="Einstellungen"
                                            className="text-white/30 hover:text-white transition-colors"
                                        >
                                            <Settings className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => logout()}
                                            title="Abmelden"
                                            className="text-white/30 hover:text-white transition-colors"
                                        >
                                            <LogOut className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                                {/* Dauerhaft sichtbarer Zustand der Hotelsystem-Anbindung. Läuft mit,
                                    damit nie der Eindruck entsteht, das Programm sei defekt, wenn in
                                    Wahrheit eine Funktion in 3RPMS noch nicht freigeschaltet ist. */}
                                {capabilities.length > 0 && (() => {
                                    const gleich = alleGleich(capabilities);
                                    const gesperrt = gleich
                                        ? gesperrteAnzahl(capabilities[0])
                                        : capabilities.filter(c => gesperrteAnzahl(c) > 0).length;
                                    const alleFrei = capabilities.every(c => gesperrteAnzahl(c) === 0);
                                    return (
                                        <button
                                            onClick={() => setShowCapabilities(true)}
                                            className="w-full mb-3 flex items-center gap-2 px-2.5 py-2 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors text-left"
                                            title="Was das System automatisch kann"
                                        >
                                            {alleFrei
                                                ? <Unlock className="w-3.5 h-3.5 shrink-0 text-[#009697]" />
                                                : <Lock className="w-3.5 h-3.5 shrink-0 text-[#F39200]" />}
                                            <div className="min-w-0 flex-1">
                                                <div className="text-[8px] font-black uppercase tracking-widest text-white/40">Hotelsystem</div>
                                                <div className={`text-[10px] font-bold leading-tight ${alleFrei ? "text-[#009697]" : "text-[#F39200]"}`}>
                                                    {alleFrei
                                                        ? "Alle Aktionen automatisch"
                                                        : gleich
                                                            ? `${gesperrt} ${gesperrt === 1 ? "Aktion" : "Aktionen"} noch nicht freigeschaltet`
                                                            : `${gesperrt} von ${capabilities.length} Häusern eingeschränkt`}
                                                </div>
                                            </div>
                                            <ChevronRight className="w-3 h-3 shrink-0 text-white/25" />
                                        </button>
                                    );
                                })()}
                                <div className="flex h-[3px] w-full mb-3 overflow-hidden">
                                    <div className="flex-1 bg-[#E2001A]" />
                                    <div className="flex-1 bg-[#F39200]" />
                                    <div className="flex-1 bg-[#009697]" />
                                    <div className="flex-1 bg-[#6082B6]" />
                                </div>
                                <div className="text-[8px] font-bold text-[#F39200] uppercase tracking-widest flex items-center gap-1.5">
                                    <div className="w-1 h-1 bg-[#F39200] rounded-full animate-pulse" />
                                    {pendingCount} {pendingCount === 1 ? "Posteingang" : "Posteingänge"}
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-3">
                                {emails.length === 0 && (
                                    <div className="px-3 py-8 text-center text-white/25 text-[10px] uppercase tracking-widest">
                                        Keine Mails
                                    </div>
                                )}
                                {emails.map((email, idx) => {
                                    const isDone = DONE_STATUSES.includes(email.status ?? "");
                                    const prevIsDone = idx > 0 && DONE_STATUSES.includes(emails[idx - 1].status ?? "");
                                    const showDivider = isDone && (idx === 0 || !prevIsDone);
                                    return (
                                        <div key={email.id}>
                                            {showDivider && (
                                                <div className="px-3 pt-4 pb-1.5 text-[8px] font-black uppercase tracking-widest text-white/25">
                                                    Erledigt
                                                </div>
                                            )}
                                            <button
                                                onClick={() => handleSelectMail(email)}
                                                className={`w-full text-left px-3 py-2.5 mb-0.5 transition-all duration-150 border-l-2 ${
                                                    selectedId === email.id
                                                        ? "bg-white/10 border-[#6082B6] text-white"
                                                        : "hover:bg-white/5 border-transparent text-white/45"
                                                }`}
                                            >
                                                <div className="text-[11px] font-bold truncate mb-0.5 leading-snug">
                                                    {email.betreff || "Kein Betreff"}
                                                </div>
                                                <div className="text-[9px] truncate mb-1 opacity-45">
                                                    {email.senders?.[0]?.name || email.senders?.[0]?.email || "Unbekannter Absender"}
                                                </div>
                                                <div className="flex items-center justify-between gap-1 mt-1">
                                                    <div className="text-[9px] font-bold uppercase tracking-widest opacity-30">
                                                        {new Date(email.received_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr
                                                    </div>
                                                    <StatusDot status={email.status} />
                                                </div>
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* ── HAUPTBEREICH ── */}
                        <div className="flex-1 flex flex-col min-w-0">
                            {currentMail ? (
                                <>
                                    {/* TOP-HEADER */}
                                    <div className="shrink-0 flex items-center justify-between px-7 py-3 border-b border-black/8 bg-white gap-4">
                                        <div className="flex items-center gap-4 shrink-0">
                                            <HotelSelectorHeader
                                                hotelName={currentMail.agent_logs?.target_hotel || ""}
                                                onUpdateHotel={handleUpdateHotel}
                                            />
                                            {!isTerminal && !isQueued && !isNew && (
                                                <AgentProgressSlim step={step} currentMail={currentMail} />
                                            )}
                                            {isQueued && (
                                                <div className="flex items-center gap-2 text-[#6082B6]">
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    <span className="text-[9px] font-black uppercase tracking-widest">Pipeline läuft...</span>
                                                </div>
                                            )}
                                        </div>
                                        <button
                                            className="flex-1 min-w-0 flex flex-col items-center justify-center cursor-pointer hover:opacity-70 transition-opacity"
                                            onClick={() => setIsMailExpanded(true)}
                                            title="Mail ansehen"
                                        >
                                            <div className="text-[12px] font-bold truncate w-full text-center text-black/75 leading-snug">
                                                {currentMail.betreff || "Kein Betreff"}
                                            </div>
                                            {currentMail.senders?.[0] && (
                                                <div className="text-[9px] text-black/30 truncate">
                                                    {currentMail.senders[0].name
                                                        ? `${currentMail.senders[0].name} <${currentMail.senders[0].email}>`
                                                        : currentMail.senders[0].email}
                                                </div>
                                            )}
                                        </button>
                                        <div className="flex items-center gap-3 shrink-0">
                                            <button
                                                onClick={() => setIsMailExpanded(true)}
                                                title="Originalmail ansehen"
                                                className="flex items-center gap-1.5 px-2.5 py-1 border border-black/10 hover:bg-[#6082B6] hover:text-white hover:border-[#6082B6] text-black/30 text-[8px] font-black uppercase tracking-widest transition-all"
                                            >
                                                <Maximize2 className="w-3 h-3" />
                                                Mail
                                            </button>
                                            <button
                                                className="hover:rotate-90 transition-transform duration-500 text-black/25 hover:text-black"
                                                title="Bildschirmschoner"
                                                onClick={() => setIsMinimized(true)}
                                            >
                                                <Minimize2 className="w-5 h-5" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* CONTENT: 3 Spalten */}
                                    <div className="flex-1 grid grid-cols-12 min-h-0 overflow-hidden">

                                        {/* ── SPALTE 0: EINGEHENDE MAIL (Vorschau, permanent sichtbar) ── */}
                                        <div className="col-span-3 flex flex-col bg-[#FAFAF8] border-r border-black/8 overflow-hidden">
                                            <div className="shrink-0 px-4 py-3 border-b border-black/5 flex items-center justify-between gap-2 text-black/25">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                                                    <span className="text-[9px] font-black uppercase tracking-[0.35em]">Eingehende Mail</span>
                                                </div>
                                                <button
                                                    onClick={() => setIsMailExpanded(true)}
                                                    title="Vollbild anzeigen"
                                                    className="shrink-0 hover:text-black transition-colors"
                                                >
                                                    <Maximize2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                            <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
                                                <div className="mb-3 pb-3 border-b border-black/5">
                                                    <div className="text-[8px] uppercase font-black tracking-widest text-black/20 mb-1">Betreff</div>
                                                    <h3 className="text-[13px] font-bold tracking-tight leading-snug text-black break-words">
                                                        {currentMail.betreff || "Kein Betreff"}
                                                    </h3>
                                                </div>
                                                {currentMail.senders?.[0] && (
                                                    <div className="mb-3 text-[10px] text-black/40 break-words leading-snug">
                                                        {currentMail.senders[0].name
                                                            ? `${currentMail.senders[0].name} <${currentMail.senders[0].email}>`
                                                            : currentMail.senders[0].email}
                                                    </div>
                                                )}
                                                <div className="text-[12px] leading-relaxed text-black/60">
                                                    {loadingBody && mailBody?.id !== currentMail.id ? (
                                                        <div className="flex items-center gap-2 text-black/25">
                                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                            <span className="text-[10px] uppercase tracking-widest">Lädt...</span>
                                                        </div>
                                                    ) : (
                                                        <MailBodyContent email={currentMailWithBody!} />
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* ── SPALTE 1: ANTWORT-ENTWURF ── */}
                                        <div className="col-span-6 flex flex-col bg-white border-r border-black/8 overflow-hidden">
                                            <div className="shrink-0 px-8 py-3 border-b border-black/5 flex items-center justify-between">
                                                <div className="flex items-center gap-2.5">
                                                    <span className="text-[9px] font-black uppercase tracking-[0.35em] text-[#6082B6]">Antwort-Entwurf</span>
                                                    {currentMail.status === "processing" && (
                                                        <div className="flex items-center gap-1 px-2 py-0.5 bg-[#F39200]/10 border border-[#F39200]/30 text-[#F39200]" title="KI-Entwurf — nur intern sichtbar">
                                                            <Sparkles className="w-2.5 h-2.5" />
                                                            <span className="text-[7px] font-black uppercase tracking-widest">KI-Entwurf</span>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {(currentMail.status === "processing" || isTerminal) && (
                                                        <button
                                                            onClick={handleRegenerate}
                                                            disabled={actionStatus !== "idle"}
                                                            title="KI-Antwort neu generieren"
                                                            className="flex items-center gap-1.5 px-2.5 py-1 border border-black/10 hover:bg-[#6082B6] hover:text-white hover:border-[#6082B6] text-black/30 text-[8px] font-black uppercase tracking-widest transition-all disabled:opacity-20"
                                                        >
                                                            <RefreshCw className={`w-3 h-3 ${actionStatus === "regenerating" ? "animate-spin" : ""}`} />
                                                            {actionStatus === "regenerating" ? "Lädt..." : "Neu"}
                                                        </button>
                                                    )}
                                                    {currentMail.status === "processing" && (
                                                        <button
                                                            onClick={handleCopy}
                                                            disabled={!editedDraft || step < 4}
                                                            title="In Zwischenablage kopieren"
                                                            className="flex items-center gap-1.5 px-2.5 py-1 border border-black/10 hover:bg-black hover:text-white text-black/30 text-[8px] font-black uppercase tracking-widest transition-all disabled:opacity-20"
                                                        >
                                                            {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                                                            {copied ? "Kopiert" : "Kopieren"}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Terminal states (sent, rejected, failed, approved) */}
                                            {currentMail.status === "ignored" ? (() => {
                                                const isPortal = currentMail.intent === "Portal-Benachrichtigung";
                                                const isSystem = currentMail.intent === "System-Benachrichtigung";
                                                const label    = isPortal ? "Portal-Benachrichtigung" : isSystem ? "System-Benachrichtigung" : "Spam / Irrelevant";
                                                const sub      = isPortal ? "Buchungsportal-Nachricht — kann echte Gastanfragen enthalten"
                                                               : isSystem ? "Automatische Systemnachricht — keine Antwort nötig"
                                                               : "Als Spam oder irrelevant eingestuft";
                                                const color    = isPortal || isSystem ? "#6082B6" : "#E2001A";
                                                return (
                                                    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                                                        {/* Kompaktes Status-Banner */}
                                                        <div className="shrink-0 flex items-center justify-between gap-4 px-8 py-3 border-b border-black/8" style={{ background: color + "12" }}>
                                                            <div className="flex items-center gap-3 min-w-0">
                                                                <div className="w-5 h-5 border-2 flex items-center justify-center font-bold text-[10px] shrink-0" style={{ borderColor: color, color }}>
                                                                    {isPortal || isSystem ? "i" : "!"}
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <div className="text-[9px] font-black uppercase tracking-widest" style={{ color }}>{label}</div>
                                                                    <div className="text-[8px] text-black/35 truncate">{sub}</div>
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-2 shrink-0">
                                                                {/* Für ALLE ignorierten Kategorien, nicht nur Spam. Vorher galt
                                                                    isSpam = !isPortal && !isSystem — Portal-Mails boten damit nur
                                                                    "Neu prüfen" an, was ohne force_process erneut dieselbe
                                                                    Klassifizierung erzeugt und wieder auf "ignored" landet.
                                                                    Eine Airbnb-Nachricht "Wir kommen erst um 23 Uhr an, wie kommen
                                                                    wir rein?" war damit strukturell unbeantwortbar. */}
                                                                <button
                                                                    onClick={handleForceProcess}
                                                                    disabled={actionStatus !== "idle"}
                                                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#6082B6] text-white hover:bg-[#444444] text-[9px] font-bold uppercase tracking-widest transition-all disabled:opacity-30"
                                                                >
                                                                    <CheckCircle2 className="w-3 h-3" />
                                                                    Trotzdem bearbeiten
                                                                </button>
                                                                <button
                                                                    onClick={handleRegenerate}
                                                                    disabled={actionStatus !== "idle"}
                                                                    className="flex items-center gap-1.5 px-3 py-1.5 border border-black/10 hover:bg-[#6082B6] hover:text-white text-black/30 text-[9px] font-bold uppercase tracking-widest transition-all disabled:opacity-30"
                                                                >
                                                                    <RefreshCw className={`w-3 h-3 ${actionStatus === "regenerating" ? "animate-spin" : ""}`} />
                                                                    Neu prüfen
                                                                </button>
                                                            </div>
                                                        </div>
                                                        {/* Mail-Body — nur lesbar */}
                                                        <div className="flex-1 overflow-y-auto custom-scrollbar px-10 py-8 text-[15px] leading-relaxed text-black/55">
                                                            {loadingBody && mailBody?.id !== currentMail.id ? (
                                                                <div className="flex items-center gap-2 text-black/25">
                                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                                    <span className="text-[10px] uppercase tracking-widest">Lädt...</span>
                                                                </div>
                                                            ) : (
                                                                <MailBodyContent email={currentMailWithBody!} />
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })() : isTerminal ? (
                                                <StatusOverlay
                                                    status={currentMail.status!}
                                                    intent={currentMail.intent}
                                                    onRegenerate={handleRegenerate}
                                                    errors={currentMail.agent_logs?.pipeline_errors}
                                                />
                                            ) : isNew ? (
                                                /* Noch nicht analysiert — Klick hat getriggert */
                                                <div className="flex-1 flex flex-col items-center justify-center gap-4 text-black/20">
                                                    <Database className="w-10 h-10 opacity-30" />
                                                    <div className="text-center">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.3em]">Analyse startet...</div>
                                                        <div className="text-[9px] text-black/20 mt-1">Einen Moment bitte</div>
                                                    </div>
                                                </div>
                                            ) : isQueued ? (
                                                /* Pipeline läuft */
                                                <div className="flex-1 flex flex-col items-center justify-center gap-4 text-[#6082B6]">
                                                    <Loader2 className="w-10 h-10 animate-spin opacity-30" />
                                                    <div className="text-center">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.3em]">Petulia analysiert...</div>
                                                        <div className="text-[9px] text-black/25 mt-1">KI-Pipeline läuft im Hintergrund</div>
                                                    </div>
                                                </div>
                                            ) : (
                                                /* processing — editierbarer Entwurf */
                                                <motion.div
                                                    initial={{ opacity: 0, y: 8 }}
                                                    animate={{ opacity: step >= 4 ? 1 : 0.04, y: step >= 4 ? 0 : 8 }}
                                                    className="flex-1 flex flex-col min-h-0"
                                                >
                                                    <textarea
                                                        value={editedDraft}
                                                        onChange={(e) => setEditedDraft(e.target.value)}
                                                        disabled={step < 4}
                                                        placeholder="Petulia erstellt Antwortvorschlag..."
                                                        className="flex-1 w-full px-10 py-8 bg-white text-black resize-none outline-none font-sans text-[15px] lg:text-[16px] font-medium leading-relaxed tracking-wide selection:bg-[#6082B6] selection:text-white disabled:cursor-default custom-scrollbar border-0"
                                                    />
                                                </motion.div>
                                            )}

                                            {/* Muss die Rezeptionistin nach dem Senden noch etwas von Hand tun?
                                                Ein Entwurf ohne Systemwirkung sieht genauso aus wie einer mit —
                                                ohne diesen Hinweis müsste sie bei jeder Mail raten. */}
                                            {currentMail.status === "processing" && currentMail.agent_logs?.manual_task?.noetig && (
                                                <div className="shrink-0 mx-8 mt-3 border-l-4 border-[#F39200] bg-[#F39200]/10">
                                                    <div className="px-4 py-3">
                                                        <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-[#F39200]">
                                                            <Lock className="w-3 h-3" />
                                                            {currentMail.agent_logs.manual_task.art === "gesperrt"
                                                                ? "Noch nicht freigeschaltet — bitte manuell erledigen"
                                                                : "Nicht automatisch möglich — bitte manuell erledigen"}
                                                        </div>
                                                        <div className="mt-1.5 text-[13px] font-bold text-black/75">
                                                            {currentMail.agent_logs.manual_task.titel}
                                                        </div>
                                                        <div className="mt-1 text-[11px] leading-relaxed text-black/50">
                                                            {currentMail.agent_logs.manual_task.grund}
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Mehrere Buchungen auf dieselbe Adresse (typisch: Firmenbuchung,
                                                bei der alle Zimmer auf buchung@firma.de laufen). Der Entwurf
                                                kann dann die Daten eines anderen Gastes enthalten. */}
                                            {currentMail.status === "processing" && currentMail.agent_logs?.pms_ambiguous && (
                                                <div className="shrink-0 mx-8 mt-3 px-4 py-3 border-l-4 border-[#F39200] bg-[#F39200]/10">
                                                    <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-[#F39200]">
                                                        <AlertTriangle className="w-3 h-3" />
                                                        Zuordnung unsicher
                                                    </div>
                                                    <div className="mt-1 text-[11px] leading-relaxed text-black/60">
                                                        {currentMail.agent_logs.pms_ambiguity_reason}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Empfänger + Anhang-Hinweis: beides entscheidet darüber, ob der
                                                Entwurf überhaupt sinnvoll ist, und war bisher unsichtbar. */}
                                            {currentMail.status === "processing" && (
                                                <div className="shrink-0 px-8 pt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                                                    <div className="flex items-center gap-1.5 text-[9px] text-black/35">
                                                        <Send className="w-3 h-3 text-[#6082B6]" />
                                                        <span className="font-black uppercase tracking-widest">Antwort geht an:</span>
                                                        <span className="font-mono text-black/60">{getReplyRecipient(currentMail) ?? "— keine Adresse —"}</span>
                                                        {currentMail.agent_logs?.reply_to && (
                                                            <span className="px-1.5 py-0.5 bg-[#6082B6]/10 text-[#6082B6] font-bold uppercase tracking-wide">
                                                                via Reply-To
                                                            </span>
                                                        )}
                                                    </div>
                                                    {currentMail.has_attachments && (
                                                        <div className="flex items-center gap-1.5 text-[9px] text-[#F39200]">
                                                            <AlertTriangle className="w-3 h-3" />
                                                            <span className="font-black uppercase tracking-widest">
                                                                Mail enthält Anhang — im Postfach prüfen
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {/* Freigabe ist fehlgeschlagen — muss sichtbar sein, sonst geht
                                                die Korrektur der Rezeptionistin unbemerkt verloren. */}
                                            {actionError && (
                                                <div className="shrink-0 mx-8 mb-3 px-4 py-3 border-l-4 border-[#E2001A] bg-[#E2001A]/8">
                                                    <div className="text-[9px] font-black uppercase tracking-widest text-[#E2001A] mb-1">
                                                        Nicht gesendet
                                                    </div>
                                                    <div className="text-[11px] leading-relaxed text-black/60">{actionError}</div>
                                                </div>
                                            )}

                                            {/* Aktions-Buttons — nur bei "processing" */}
                                            {currentMail.status === "processing" && (
                                                <motion.div
                                                    initial={{ opacity: 0, y: 6 }}
                                                    animate={{ opacity: step >= 4 ? 1 : 0, y: step >= 4 ? 0 : 6 }}
                                                    className="shrink-0 px-8 pb-7 pt-4 flex gap-3 border-t border-black/5"
                                                >
                                                    <button
                                                        onClick={() => handleAction("approve")}
                                                        disabled={actionStatus !== "idle" || step < 4}
                                                        className="flex-[3] h-12 bg-[#6082B6] text-white hover:bg-[#444444] transition-all text-sm font-bold uppercase tracking-[0.2em] flex items-center justify-center gap-3 group disabled:opacity-30 active:translate-y-0.5 shadow-md"
                                                    >
                                                        {actionStatus === "approving" ? (
                                                            <>
                                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                                WIRD VERARBEITET...
                                                            </>
                                                        ) : (
                                                            <>
                                                                BESTÄTIGEN & SENDEN
                                                                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                                                            </>
                                                        )}
                                                    </button>
                                                    <button
                                                        onClick={() => handleAction("reject")}
                                                        disabled={actionStatus !== "idle"}
                                                        className="flex-1 h-12 border border-black/10 bg-white hover:bg-[#E2001A] hover:text-white transition-all text-[9px] font-bold uppercase tracking-widest flex items-center justify-center text-black/30 disabled:opacity-30"
                                                    >
                                                        ABLEHNEN
                                                    </button>
                                                </motion.div>
                                            )}
                                        </div>

                                        {/* ── SPALTE 2: INSIGHTS ── */}
                                        <div className="col-span-3 flex flex-col bg-[#F9F9F9] overflow-y-auto custom-scrollbar">
                                            <div className="shrink-0 px-4 py-3 border-b border-black/5 flex items-center gap-2 text-black/25">
                                                <Database className="w-3.5 h-3.5 text-[#6082B6]" />
                                                <span className="text-[9px] font-black uppercase tracking-[0.35em]">Ergebnisse</span>
                                            </div>

                                            <div className="p-4 space-y-3">
                                                {/* Erkannte Anfrage */}
                                                {currentMail.intent && (
                                                    <div className="bg-white border border-black/5 p-3">
                                                        <div className="text-[8px] uppercase text-black/20 font-black tracking-widest mb-1.5">
                                                            Erkannte Anfrage
                                                        </div>
                                                        <div className="text-[12px] font-bold text-[#6082B6] leading-snug">
                                                            {currentMail.intent}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Policy Hinweis (nur wenn Richtlinie verletzt) */}
                                                {currentMail.policy_decision_reason && currentMail.policy_decision_allowed === false && (
                                                    <div className="bg-[#F39200]/8 border border-[#F39200]/25 p-3">
                                                        <div className="flex items-center gap-1.5 mb-1.5">
                                                            <AlertTriangle className="w-3 h-3 text-[#F39200]" />
                                                            <span className="text-[8px] font-black text-[#F39200] uppercase tracking-widest">
                                                                Richtlinien-Hinweis
                                                            </span>
                                                        </div>
                                                        <div className="text-[10px] text-black/60 leading-snug">
                                                            {currentMail.policy_decision_reason}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Pipeline-Fehler */}
                                                {currentMail.agent_logs?.pipeline_errors?.length > 0 && (
                                                    <div className="bg-[#E2001A]/6 border border-[#E2001A]/20 p-3">
                                                        <div className="flex items-center gap-1.5 mb-2">
                                                            <XCircle className="w-3 h-3 text-[#E2001A]" />
                                                            <span className="text-[8px] font-black text-[#E2001A] uppercase tracking-widest">
                                                                System-Fehler
                                                            </span>
                                                        </div>
                                                        <div className="space-y-1">
                                                            {currentMail.agent_logs.pipeline_errors.map((err: string, i: number) => (
                                                                <div key={i} className="text-[9px] text-black/50 leading-snug font-mono break-all">
                                                                    {err}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* PMS-Reservierungsdaten */}
                                                {pmsData ? (
                                                    <motion.div
                                                        initial={{ opacity: 0, x: 8 }}
                                                        animate={{ opacity: 1, x: 0 }}
                                                        className="bg-white border-l-2 border-[#009697] p-3 shadow-sm"
                                                    >
                                                        <div className="flex items-center gap-1.5 mb-3">
                                                            <CheckCircle2 className="w-3 h-3 text-[#009697]" />
                                                            <span className="text-[8px] font-black text-[#009697] uppercase tracking-widest">
                                                                Reservierung gefunden
                                                            </span>
                                                        </div>
                                                        <div className="space-y-2">
                                                            <div className="flex justify-between items-center gap-2">
                                                                <span className="text-[8px] uppercase text-black/25 font-black tracking-wide shrink-0">Gast</span>
                                                                <span className="text-[11px] font-bold text-[#444444] text-right truncate">{pmsData.guestName}</span>
                                                            </div>
                                                            {pmsData.code !== "—" && (
                                                                <div className="flex justify-between items-center gap-2">
                                                                    <span className="text-[8px] uppercase text-black/25 font-black tracking-wide shrink-0">Code</span>
                                                                    <span className="text-[8px] font-black bg-[#444444] text-white px-1.5 py-0.5">
                                                                        {pmsData.code}
                                                                    </span>
                                                                </div>
                                                            )}
                                                            {pmsData.room !== "—" && (
                                                                <div className="flex justify-between items-center gap-2">
                                                                    <span className="text-[8px] uppercase text-black/25 font-black tracking-wide shrink-0">Zimmer</span>
                                                                    <span className="text-[10px] font-bold">{pmsData.room}</span>
                                                                </div>
                                                            )}
                                                            <div className="flex justify-between items-center gap-2">
                                                                <span className="text-[8px] uppercase text-black/25 font-black tracking-wide shrink-0">Anreise</span>
                                                                <span className="text-[10px] font-bold">{pmsData.from}</span>
                                                            </div>
                                                            <div className="flex justify-between items-center gap-2">
                                                                <span className="text-[8px] uppercase text-black/25 font-black tracking-wide shrink-0">Abreise</span>
                                                                <span className="text-[10px] font-bold">{pmsData.to}</span>
                                                            </div>
                                                            <div className="pt-2 mt-1 border-t border-black/5">
                                                                <span className="inline-block text-[9px] px-2 py-0.5 bg-green-50 text-green-700 border border-green-200 font-bold">
                                                                    {pmsData.status}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </motion.div>
                                                ) : (
                                                    <div className="p-5 border border-dashed border-black/10 flex flex-col items-center gap-2 text-center">
                                                        <Database className="w-5 h-5 text-black/8" />
                                                        <div className="text-[9px] font-bold text-black/20 uppercase tracking-widest leading-snug">
                                                            {isQueued
                                                                ? "Wird gesucht..."
                                                                : currentMail.agent_logs?.target_hotel && currentMail.agent_logs.target_hotel !== "UNKLAR"
                                                                    ? "Keine PMS-Daten"
                                                                    : "Hotel wählen"}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Geplante Aktion */}
                                                {(() => {
                                                    const actionLabel = getApiActionLabel(currentMail.api_action);
                                                    const hasMutation = currentMail.agent_logs?.actionData?.graphql_mutation &&
                                                        currentMail.agent_logs.actionData.graphql_mutation !== "none";
                                                    if (!actionLabel || !hasMutation) return null;
                                                    return (
                                                        <div className="bg-[#444444] p-3 text-white">
                                                            <div className="flex items-center gap-1.5 mb-2">
                                                                <ChevronRight className="w-3 h-3 text-[#F39200]" />
                                                                <span className="text-[8px] font-black text-[#F39200] uppercase tracking-widest">
                                                                    Geplante Aktion
                                                                </span>
                                                            </div>
                                                            <div className="text-[11px] font-bold leading-snug">{actionLabel.title}</div>
                                                            <div className="mt-1 text-[10px] opacity-60 leading-snug">{actionLabel.beschreibung}</div>
                                                            {currentMail.status === "processing" && (
                                                                <div className="mt-2 text-[8px] font-mono opacity-35 uppercase tracking-wide">
                                                                    Erst nach Bestätigung
                                                                </div>
                                                            )}
                                                            {/* "Ausgeführt" hing bisher allein am Status "sent" — auch dann,
                                                                wenn die PMS-Mutation in Wahrheit fehlgeschlagen war. Die Mail
                                                                hatte dem Gast dann etwas zugesagt (z.B. späterer Check-out),
                                                                was im System nie ankam, und das Dashboard meldete grün. */}
                                                            {currentMail.status === "sent" && !currentMail.agent_logs?.mutation_failed && (
                                                                <div className="mt-2 flex items-center gap-1 text-[8px] text-[#009697] font-bold uppercase tracking-wide">
                                                                    <CheckCircle2 className="w-3 h-3" />
                                                                    Ausgeführt
                                                                </div>
                                                            )}
                                                            {currentMail.status === "sent" && currentMail.agent_logs?.mutation_failed && (
                                                                <div className="mt-2 p-2 bg-[#E2001A] text-white">
                                                                    <div className="flex items-center gap-1 text-[8px] font-black uppercase tracking-wide">
                                                                        <AlertTriangle className="w-3 h-3" />
                                                                        NICHT ausgeführt — Nacharbeit nötig
                                                                    </div>
                                                                    <div className="mt-1 text-[9px] leading-snug opacity-90">
                                                                        Die Antwort ist bereits beim Gast, die Änderung im PMS aber nicht.
                                                                        Bitte manuell im 3RPMS nachtragen.
                                                                    </div>
                                                                    {currentMail.agent_logs?.mutation_error && (
                                                                        <div className="mt-1 text-[8px] font-mono opacity-70 break-words">
                                                                            {currentMail.agent_logs.mutation_error}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })()}


                                                {/* Historischer Kontext */}
                                                {currentMail.agent_logs?.relevant_context && (
                                                    <div className="bg-white border border-black/5 p-3">
                                                        <div className="text-[8px] uppercase text-black/20 font-black tracking-widest mb-1.5">
                                                            Historischer Kontext
                                                        </div>
                                                        <div className="text-[10px] text-black/50 italic leading-relaxed">
                                                            {currentMail.agent_logs.relevant_context}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Reflexionen der KI (optional, ausblendbar) */}
                                                {currentMail.agent_logs?.actionData?.reflexion_loop_gedanken?.length > 0 && (
                                                    <details className="group">
                                                        <summary className="text-[8px] uppercase text-black/20 font-black tracking-widest cursor-pointer hover:text-black/40 transition-colors list-none flex items-center gap-1">
                                                            <ChevronRight className="w-3 h-3 transition-transform group-open:rotate-90" />
                                                            KI-Reflexionen
                                                        </summary>
                                                        <div className="mt-2 space-y-1.5">
                                                            {(currentMail.agent_logs.actionData.reflexion_loop_gedanken as string[]).map((thought, i) => (
                                                                <div key={i} className="text-[9px] text-black/40 leading-snug pl-2 border-l border-black/10">
                                                                    {thought}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </details>
                                                )}
                                            </div>
                                        </div>

                                    </div>
                                </>
                            ) : (
                                <div className="flex-1 flex items-center justify-center bg-[#F2EFE6]">
                                    <Layers className="w-20 h-20 text-black/10 animate-pulse" />
                                </div>
                            )}
                        </div>
                    </motion.div>
                ) : (
                    /* ── SCREENSAVER ── */
                    <motion.div
                        key="screensaver"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="absolute inset-0 flex items-center justify-center bg-[#F9F9F9] cursor-pointer"
                        onClick={() => setIsMinimized(false)}
                    >
                        <div className="bg-white border border-black/10 px-16 py-20 lg:px-24 lg:py-20 shadow-2xl text-center">
                            <div className="flex flex-col items-center mb-2">
                                <h1 className="text-[60px] lg:text-[100px] font-serif tracking-widest leading-none text-[#444444] uppercase">
                                    APART HOTELS
                                </h1>
                                <span
                                    className="text-[50px] lg:text-[80px] font-light italic lowercase text-[#444444] opacity-80 -mt-4"
                                    style={{ fontFamily: "serif" }}
                                >
                                    petul
                                </span>
                            </div>
                            <div className="flex mt-8">
                                <div className="h-0.5 flex-1 bg-[#E2001A]" />
                                <div className="h-0.5 flex-1 bg-[#F39200]" />
                                <div className="h-0.5 flex-1 bg-[#009697]" />
                                <div className="h-0.5 flex-1 bg-[#6082B6]" />
                            </div>
                            {pendingCount > 0 ? (
                                <p className="mt-8 text-[12px] uppercase font-bold tracking-[0.4em] text-[#F39200] animate-pulse">
                                    {pendingCount} {pendingCount === 1 ? "Mail wartet" : "Mails warten"} auf Freigabe
                                </p>
                            ) : (
                                <p className="mt-8 text-[12px] uppercase font-bold tracking-[0.4em] text-[#6082B6]">
                                    Petulia bereit zur Bearbeitung
                                </p>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {isMailExpanded && currentMailWithBody && (
                    <MailExpandModal email={currentMailWithBody} onClose={() => setIsMailExpanded(false)} />
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showCapabilities && capabilities.length > 0 && (
                    <CapabilityPanel caps={capabilities} onClose={() => setShowCapabilities(false)} />
                )}
            </AnimatePresence>
        </div>
    );
}

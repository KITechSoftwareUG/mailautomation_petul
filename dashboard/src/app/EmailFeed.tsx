"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
    ArrowRight, Minimize2, Layers, CheckCircle2, Terminal, BrainCircuit, PenTool,
    Database, MessageSquare, Copy, Check, ChevronRight, Sparkles, RefreshCw,
    XCircle, Clock, Send, AlertTriangle, Loader2
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@supabase/supabase-js";

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
    agent_logs?: any;
    senders?: { email: string; name?: string }[];
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";
const supabase = createClient(supabaseUrl, supabaseKey);

// ─── Status-Badge ──────────────────────────────────────────────────────────────

function StatusDot({ status }: { status?: string }) {
    const map: Record<string, { color: string; label: string; pulse?: boolean }> = {
        new:        { color: "#6082B6", label: "Läuft",      pulse: true },
        processing: { color: "#F39200", label: "Wartet",     pulse: true },
        approved:   { color: "#009697", label: "Genehmigt",  pulse: true },
        sent:       { color: "#22c55e", label: "Gesendet" },
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

function extractPmsDisplayData(threeRpmsData: any) {
    if (!threeRpmsData) return null;

    // Format A: direkte Reservierung (via getReservationByCode → reservations.edges[0].node)
    if (threeRpmsData.code || threeRpmsData.reservationFrom) {
        const guest = threeRpmsData.client || threeRpmsData.first_guest;
        const firstStay = threeRpmsData.roomStays?.edges?.[0]?.node;
        return {
            guestName: [guest?.firstname, guest?.lastname || guest?.name].filter(Boolean).join(" ") || "—",
            code: threeRpmsData.code || "—",
            from: firstStay?.reservation_from || threeRpmsData.reservationFrom || "—",
            to:   firstStay?.reservation_to   || threeRpmsData.reservationTo   || "—",
            status: threeRpmsData.status || "Aktive Buchung",
            room: firstStay?.roomName || "—",
        };
    }

    // Format B: E-Mail-Suche (client + roomStays[] oder reservations[])
    const client = threeRpmsData.client;
    const firstRes = threeRpmsData.reservations?.[0] || threeRpmsData.roomStays?.[0];
    const firstStay = threeRpmsData.roomStays?.[0];
    if (client) {
        return {
            guestName: [client.firstname, client.lastname || client.name].filter(Boolean).join(" ") || "—",
            code: firstRes?.code || firstStay?.reservation?.code || "—",
            from: firstStay?.reservation_from || firstRes?.reservationFrom || "—",
            to:   firstStay?.reservation_to   || firstRes?.reservationTo   || "—",
            status: firstRes?.status || firstStay?.reservation?.status || "Gefunden",
            room: firstStay?.roomName || "—",
        };
    }

    // Format C: room_stay direkt
    if (threeRpmsData.reservation_from || threeRpmsData.roomName) {
        const g = threeRpmsData.first_guest;
        return {
            guestName: g ? `${g.firstname || ""} ${g.lastname || ""}`.trim() : "—",
            code: threeRpmsData.reservation?.code || "—",
            from: threeRpmsData.reservation_from || "—",
            to:   threeRpmsData.reservation_to   || "—",
            status: threeRpmsData.reservation?.status || "—",
            room: threeRpmsData.roomName || "—",
        };
    }

    return null;
}

// ─── Status-Overlay (für sent / rejected / failed) ────────────────────────────

function StatusOverlay({ status, onRegenerate }: { status: string; onRegenerate?: () => void }) {
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
            <div className="flex-1 flex flex-col items-center justify-center gap-5 text-[#E2001A]">
                <div className="w-16 h-16 border-2 border-[#E2001A] flex items-center justify-center">
                    <AlertTriangle className="w-7 h-7" />
                </div>
                <div className="text-center">
                    <div className="text-sm font-bold uppercase tracking-[0.2em]">Pipeline-Fehler</div>
                    <div className="text-[10px] text-black/30 mt-1 uppercase tracking-widest">AI-Analyse konnte nicht abgeschlossen werden</div>
                </div>
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
    if (status === "ignored") {
        return (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-[#E2001A]">
                <div className="w-14 h-14 border-2 border-[#E2001A] flex items-center justify-center font-bold text-2xl">!</div>
                <div className="text-center">
                    <div className="text-base font-bold uppercase tracking-widest">SPAM / IRRELEVANT</div>
                    <div className="text-[10px] font-medium opacity-60 tracking-normal mt-1">Nachricht als nicht relevant eingestuft</div>
                </div>
                {onRegenerate && (
                    <button
                        onClick={onRegenerate}
                        className="flex items-center gap-2 px-4 py-2 border border-black/10 hover:bg-[#6082B6] hover:text-white text-black/30 text-[10px] font-bold uppercase tracking-widest transition-all"
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Neu prüfen
                    </button>
                )}
            </div>
        );
    }
    return null;
}

// ─── Haupt-Komponente ─────────────────────────────────────────────────────────

export function EmailFeed({ emails: initialEmails }: { emails: Email[] }) {
    const router = useRouter();
    const [emails, setEmails] = useState<Email[]>(initialEmails);
    const [selectedId, setSelectedId] = useState<string | null>(
        initialEmails.find((e) => e.status === "processing")?.id || initialEmails[0]?.id || null
    );
    const [actionStatus, setActionStatus] = useState<"idle" | "approving" | "rejecting" | "regenerating">("idle");
    const [isMinimized, setIsMinimized] = useState(false);
    const [step, setStep] = useState(0);
    const [editedDraft, setEditedDraft] = useState<string>("");
    const [copied, setCopied] = useState(false);
    const notifiedIds = useRef<Set<string>>(new Set(initialEmails.map((e) => e.id)));

    const pendingCount = emails.filter((e) => e.status === "processing").length;
    const currentMail = emails.find((e) => e.id === selectedId);

    // ─── Realtime-ähnliches Polling ─────────────────────────────────────────
    // Schnelles Polling (5s) wenn aktive Mails vorhanden, sonst 30s

    const fetchEmails = useCallback(async () => {
        const { data } = await supabase
            .from("emails")
            .select(`id, mail_id, betreff, body_text, body_html, received_at, status, intent,
                     policy_decision_allowed, policy_decision_reason, api_action, draft_reply,
                     agent_logs, senders!inner(email, name)`)
            .order("received_at", { ascending: false })
            .limit(50);
        if (data) setEmails(data as Email[]);
    }, []);

    useEffect(() => {
        const hasActive = emails.some((e) => e.status === "new" || e.status === "approved");
        const interval = setInterval(fetchEmails, hasActive ? 5000 : 30000);
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
    }, [selectedId, currentMail?.draft_reply]);

    // ─── Agent-Progress-Animation ────────────────────────────────────────────

    useEffect(() => {
        if (!currentMail) return;
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

    const handleUpdateHotel = async (hotel: string) => {
        if (!currentMail) return;
        await supabase.from("emails").update({
            status: "new",
            intent: null,
            agent_logs: { ...currentMail.agent_logs, target_hotel: hotel, ai_force_hotel: hotel },
        }).eq("id", currentMail.id);
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
        await supabase.from("emails").update({
            status: "new",
            intent: null,
            api_action: null,
            draft_reply: null,
            agent_logs: {
                target_hotel: currentMail.agent_logs?.target_hotel || null,
                ai_force_hotel: currentMail.agent_logs?.ai_force_hotel || null,
            },
        }).eq("id", currentMail.id);
        setEditedDraft("");
        await fetchEmails();
        setActionStatus("idle");
    };

    const handleAction = async (action: "approve" | "reject") => {
        if (!currentMail) return;
        const currentId = currentMail.id;
        setActionStatus(action === "approve" ? "approving" : "rejecting");
        if (action === "approve") {
            await supabase.from("emails").update({ draft_reply: editedDraft, status: "approved" }).eq("id", currentId);
        } else {
            await supabase.from("emails").update({ status: "rejected" }).eq("id", currentId);
        }
        await fetchEmails();
        setActionStatus("idle");
        // Nach kurzer Verzögerung zur nächsten Mail wechseln
        setTimeout(() => autoSelectNext(currentId), 400);
    };

    // ─── PMS-Daten extrahieren ────────────────────────────────────────────────

    const pmsData = extractPmsDisplayData(currentMail?.agent_logs?.threeRpmsData ?? null);
    const isTerminal = ["sent", "rejected", "ignored", "failed", "approved"].includes(currentMail?.status ?? "");
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
                        <div className="w-52 shrink-0 border-r border-black/10 flex flex-col bg-[#444444] text-white">
                            <div className="px-5 pt-5 pb-4">
                                <div className="flex flex-col mb-3">
                                    <h1 className="text-[16px] font-serif tracking-widest leading-none mb-0.5 uppercase">Apart Hotels</h1>
                                    <span className="text-[14px] font-light italic lowercase opacity-70" style={{ fontFamily: "serif" }}>petul</span>
                                </div>
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
                                {emails.slice(0, 30).map((email) => (
                                    <button
                                        key={email.id}
                                        onClick={() => setSelectedId(email.id)}
                                        className={`w-full text-left px-3 py-2.5 mb-0.5 transition-all duration-150 border-l-2 ${
                                            selectedId === email.id
                                                ? "bg-white/10 border-[#6082B6] text-white"
                                                : "hover:bg-white/5 border-transparent text-white/45"
                                        }`}
                                    >
                                        <div className="text-[11px] font-bold truncate mb-0.5 leading-snug">
                                            {email.betreff || "Kein Betreff"}
                                        </div>
                                        <div className="flex items-center justify-between gap-1 mt-1">
                                            <div className="text-[9px] font-bold uppercase tracking-widest opacity-30">
                                                {new Date(email.received_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr
                                            </div>
                                            <StatusDot status={email.status} />
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* ── HAUPTBEREICH ── */}
                        <div className="flex-1 flex flex-col min-w-0">
                            {currentMail ? (
                                <>
                                    {/* TOP-HEADER */}
                                    <div className="shrink-0 flex items-center justify-between px-7 py-3 border-b border-black/8 bg-white">
                                        <div className="flex items-center gap-4">
                                            <HotelSelectorHeader
                                                hotelName={currentMail.agent_logs?.target_hotel || ""}
                                                onUpdateHotel={handleUpdateHotel}
                                            />
                                            {!isTerminal && !isNew && (
                                                <AgentProgressSlim step={step} currentMail={currentMail} />
                                            )}
                                            {isNew && (
                                                <div className="flex items-center gap-2 text-[#6082B6]">
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    <span className="text-[9px] font-black uppercase tracking-widest">Pipeline läuft...</span>
                                                </div>
                                            )}
                                        </div>
                                        <button
                                            className="hover:rotate-90 transition-transform duration-500 text-black/25 hover:text-black"
                                            title="Bildschirmschoner"
                                            onClick={() => setIsMinimized(true)}
                                        >
                                            <Minimize2 className="w-5 h-5" />
                                        </button>
                                    </div>

                                    {/* CONTENT: 3 Spalten */}
                                    <div className="flex-1 grid grid-cols-12 min-h-0 overflow-hidden">

                                        {/* ── SPALTE 1: E-MAIL PREVIEW ── */}
                                        <div className="col-span-3 border-r border-black/8 bg-white flex flex-col overflow-hidden">
                                            <div className="shrink-0 px-5 py-3 border-b border-black/5 flex items-center gap-2 text-black/25">
                                                <MessageSquare className="w-3.5 h-3.5" />
                                                <span className="text-[9px] font-black uppercase tracking-[0.35em]">Eingehende Mail</span>
                                            </div>

                                            <div className="flex-1 overflow-y-auto custom-scrollbar p-5">
                                                <div className="mb-4 pb-4 border-b border-black/5">
                                                    <div className="text-[8px] uppercase font-black tracking-widest text-black/20 mb-1.5">Betreff</div>
                                                    <h2 className="text-[13px] font-bold tracking-tight leading-snug text-black">
                                                        {currentMail.betreff}
                                                    </h2>
                                                </div>

                                                {currentMail.senders?.[0] && (
                                                    <div className="flex items-center gap-2.5 mb-5 p-3 bg-[#F9F9F9] border border-black/5">
                                                        <div className="w-8 h-8 bg-[#6082B6] flex items-center justify-center shrink-0 text-white text-[11px] font-black">
                                                            {(currentMail.senders[0].name || currentMail.senders[0].email).charAt(0).toUpperCase()}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className="text-[11px] font-bold truncate leading-tight">
                                                                {currentMail.senders[0].name || currentMail.senders[0].email}
                                                            </div>
                                                            <div className="text-[9px] text-black/30 truncate">
                                                                {currentMail.senders[0].email}
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}

                                                <div className="text-[12px] leading-relaxed text-black/65">
                                                    {currentMail.body_html ? (
                                                        <div
                                                            className="prose prose-xs max-w-none break-words overflow-hidden"
                                                            dangerouslySetInnerHTML={{ __html: currentMail.body_html }}
                                                        />
                                                    ) : (
                                                        <div className="whitespace-pre-wrap">{currentMail.body_text}</div>
                                                    )}
                                                </div>

                                                {currentMail.agent_logs?.relevant_context && (
                                                    <div className="mt-5 pt-4 border-t border-black/5">
                                                        <span className="text-[9px] font-black uppercase tracking-widest text-[#6082B6] block mb-2">
                                                            Historischer Kontext
                                                        </span>
                                                        <div className="text-[11px] text-black/50 italic leading-relaxed">
                                                            {currentMail.agent_logs.relevant_context}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* ── SPALTE 2: ANTWORT-ENTWURF ── */}
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

                                            {/* Terminal states (sent, rejected, failed, ignored, approved) */}
                                            {isTerminal ? (
                                                <StatusOverlay status={currentMail.status!} onRegenerate={handleRegenerate} />
                                            ) : isNew ? (
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

                                        {/* ── SPALTE 3: INSIGHTS ── */}
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

                                                {/* Policy Warning */}
                                                {currentMail.policy_decision_reason && !currentMail.policy_decision_allowed && (
                                                    <div className="bg-[#E2001A]/5 border border-[#E2001A]/20 p-3">
                                                        <div className="flex items-center gap-1.5 mb-1.5">
                                                            <AlertTriangle className="w-3 h-3 text-[#E2001A]" />
                                                            <span className="text-[8px] font-black text-[#E2001A] uppercase tracking-widest">
                                                                Richtlinien-Warnung
                                                            </span>
                                                        </div>
                                                        <div className="text-[10px] text-[#E2001A]/80 leading-snug">
                                                            {currentMail.policy_decision_reason}
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
                                                            {isNew
                                                                ? "Wird gesucht..."
                                                                : currentMail.agent_logs?.target_hotel && currentMail.agent_logs.target_hotel !== "UNKLAR"
                                                                    ? "Keine PMS-Daten"
                                                                    : "Hotel wählen"}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Geplante Aktion */}
                                                {currentMail.agent_logs?.actionData?.graphql_mutation &&
                                                    currentMail.agent_logs.actionData.graphql_mutation !== "none" && (
                                                        <div className="bg-[#444444] p-3 text-white">
                                                            <div className="flex items-center gap-1.5 mb-2">
                                                                <ChevronRight className="w-3 h-3 text-[#F39200]" />
                                                                <span className="text-[8px] font-black text-[#F39200] uppercase tracking-widest">
                                                                    Geplante Aktion
                                                                </span>
                                                            </div>
                                                            <div className="text-[11px] font-bold leading-snug">{currentMail.api_action}</div>
                                                            {currentMail.status === "processing" && (
                                                                <div className="mt-2 text-[8px] font-mono opacity-35 uppercase tracking-wide">
                                                                    Erst nach Bestätigung
                                                                </div>
                                                            )}
                                                            {currentMail.status === "sent" && (
                                                                <div className="mt-2 flex items-center gap-1 text-[8px] text-[#009697] font-bold uppercase tracking-wide">
                                                                    <CheckCircle2 className="w-3 h-3" />
                                                                    Ausgeführt
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}

                                                {/* Policy OK Info */}
                                                {currentMail.policy_decision_allowed && currentMail.policy_decision_reason && (
                                                    <div className="p-3 border border-black/5 bg-white">
                                                        <div className="text-[8px] uppercase text-black/20 font-black tracking-widest mb-1">
                                                            Richtlinien-Check
                                                        </div>
                                                        <div className="text-[10px] text-black/50 leading-snug">
                                                            {currentMail.policy_decision_reason}
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
        </div>
    );
}

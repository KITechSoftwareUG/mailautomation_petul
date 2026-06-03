"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
    ArrowRight, Minimize2, Layers, CheckCircle2, Terminal, BrainCircuit, PenTool, Database, MessageSquare, Copy, Check, ChevronRight, Sparkles, RefreshCw
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
    api_action?: string;
    draft_reply?: string;
    agent_logs?: any;
    senders?: { email: string; name?: string }[];
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";
const supabase = createClient(supabaseUrl, supabaseKey);

// Schlanker horizontaler Agent-Fortschritts-Indikator für den Header
function AgentProgressSlim({ step, currentMail }: { step: number; currentMail: Email }) {
    const hotelName = currentMail.agent_logs?.target_hotel || "UNKLAR";

    const stages = [
        { name: "PRÜFUNG", icon: BrainCircuit, warning: false },
        { name: "HOTEL", icon: Database, warning: hotelName === "UNKLAR" },
        { name: "WISSEN", icon: Terminal, warning: false },
        { name: "ENTWURF", icon: PenTool, warning: false },
    ];

    return (
        <div className="flex items-center gap-1.5">
            {stages.map((stage, idx) => {
                const isDone = step > idx;
                const isActive = step === idx;
                const Icon = stage.icon;
                const isWarning = stage.warning && (isActive || isDone);

                let colorClass = "text-black/15";
                if (isWarning) colorClass = "text-[#E2001A]";
                else if (isDone) colorClass = "text-[#009697]";
                else if (isActive) colorClass = "text-[#6082B6]";

                return (
                    <div key={idx} className="flex items-center gap-1">
                        <div className={`flex items-center gap-1 transition-all duration-300 ${colorClass}`}>
                            {isDone && !isWarning ? (
                                <CheckCircle2 className="w-3.5 h-3.5" />
                            ) : (
                                <Icon className={`w-3.5 h-3.5 ${isActive ? "animate-pulse" : ""}`} />
                            )}
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

export function EmailFeed({ emails }: { emails: Email[] }) {
    const router = useRouter();
    const [selectedId, setSelectedId] = useState<string | null>(
        emails.find((e) => e.status === "processing")?.id || emails[0]?.id || null
    );
    const [actionStatus, setActionStatus] = useState<"idle" | "approving" | "rejecting" | "regenerating">("idle");
    const [isMinimized, setIsMinimized] = useState(false);
    const [step, setStep] = useState(0);
    const [editedDraft, setEditedDraft] = useState<string>("");
    const [copied, setCopied] = useState(false);
    const notifiedIds = useRef<Set<string>>(new Set(emails.map((e) => e.id)));

    const pendingCount = emails.filter((e) => e.status === "processing").length;
    const currentMail = emails.find((e) => e.id === selectedId);

    useEffect(() => {
        if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
            Notification.requestPermission();
        }
    }, []);

    useEffect(() => {
        const processingEmails = emails.filter((e) => e.status === "processing");
        for (const email of processingEmails) {
            if (!notifiedIds.current.has(email.id)) {
                notifiedIds.current.add(email.id);
                if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
                    new Notification("Neue E-Mail — Petulia", {
                        body: email.betreff || "Neue eingehende E-Mail",
                        icon: "/favicon.ico",
                    });
                }
            }
        }
    }, [emails]);

    useEffect(() => {
        setEditedDraft(currentMail?.draft_reply || "");
        setCopied(false);
    }, [selectedId, currentMail?.draft_reply]);

    useEffect(() => {
        const interval = setInterval(() => router.refresh(), 30000);
        return () => clearInterval(interval);
    }, [router]);

    useEffect(() => {
        if (currentMail) {
            setStep(0);
            const t1 = setTimeout(() => setStep(1), 500);
            const t2 = setTimeout(() => setStep(2), 1000);
            const t3 = setTimeout(() => setStep(3), 1500);
            const t4 = setTimeout(() => setStep(4), 2000);
            return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
        }
    }, [selectedId, currentMail?.draft_reply]);

    const handleUpdateHotel = async (hotel: string) => {
        if (!currentMail) return;
        try {
            await supabase.from("emails").update({
                status: "new",
                intent: null,
                agent_logs: { ...currentMail.agent_logs, target_hotel: hotel, ai_force_hotel: hotel },
            }).eq("id", currentMail.id);
            router.refresh();
        } catch (err) {
            console.error("Hotel Update Fehler:", err);
        }
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
        try {
            await supabase.from("emails").update({
                status: "new",
                intent: null,
                api_action: null,
                draft_reply: null,
                agent_logs: {
                    ...(currentMail.agent_logs || {}),
                    target_hotel: currentMail.agent_logs?.target_hotel || null,
                    ai_force_hotel: currentMail.agent_logs?.ai_force_hotel || null,
                },
            }).eq("id", currentMail.id);
            setEditedDraft("");
            await new Promise((resolve) => setTimeout(resolve, 1000));
            router.refresh();
        } finally {
            setActionStatus("idle");
        }
    };

    const handleAction = async (action: "approve" | "reject") => {
        if (!currentMail) return;
        setActionStatus(action === "approve" ? "approving" : "rejecting");
        try {
            if (action === "approve") {
                await supabase.from("emails").update({ draft_reply: editedDraft, status: "approved" }).eq("id", currentMail.id);
            } else {
                await supabase.from("emails").update({ status: "rejected" }).eq("id", currentMail.id);
            }
            await new Promise((resolve) => setTimeout(resolve, 800));
            router.refresh();
        } finally {
            setActionStatus("idle");
        }
    };

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
                        {/* ── LINKE SIDEBAR: KOMPAKTE E-MAIL-LISTE ── */}
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
                                    {pendingCount} Posteingänge
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-3">
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
                                        <div className="text-[9px] font-bold uppercase tracking-widest opacity-30">
                                            {new Date(email.received_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} Uhr
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* ── HAUPTBEREICH ── */}
                        <div className="flex-1 flex flex-col min-w-0">
                            {currentMail ? (
                                <>
                                    {/* TOP-HEADER: Hotel-Wahl + Agent-Fortschritt + Minimize */}
                                    <div className="shrink-0 flex items-center justify-between px-7 py-3 border-b border-black/8 bg-white">
                                        <div className="flex items-center gap-4">
                                            <HotelSelectorHeader
                                                hotelName={currentMail.agent_logs?.target_hotel || ""}
                                                onUpdateHotel={handleUpdateHotel}
                                            />
                                            <AgentProgressSlim step={step} currentMail={currentMail} />
                                        </div>
                                        <button
                                            className="hover:rotate-90 transition-transform duration-500 text-black/25 hover:text-black"
                                            title="Bildschirmschoner"
                                            onClick={() => setIsMinimized(true)}
                                        >
                                            <Minimize2 className="w-5 h-5" />
                                        </button>
                                    </div>

                                    {/* CONTENT: 3 Spalten — Preview / Entwurf / Insights */}
                                    <div className="flex-1 grid grid-cols-12 min-h-0 overflow-hidden">

                                        {/* ── SPALTE 1: E-MAIL PREVIEW (3/12 = 25%) ── */}
                                        <div className="col-span-3 border-r border-black/8 bg-white flex flex-col overflow-hidden">
                                            <div className="shrink-0 px-5 py-3 border-b border-black/5 flex items-center gap-2 text-black/25">
                                                <MessageSquare className="w-3.5 h-3.5" />
                                                <span className="text-[9px] font-black uppercase tracking-[0.35em]">Eingehende Mail</span>
                                            </div>

                                            <div className="flex-1 overflow-y-auto custom-scrollbar p-5">
                                                {/* Betreff */}
                                                <div className="mb-4 pb-4 border-b border-black/5">
                                                    <div className="text-[8px] uppercase font-black tracking-widest text-black/20 mb-1.5">Betreff</div>
                                                    <h2 className="text-[13px] font-bold tracking-tight leading-snug text-black">
                                                        {currentMail.betreff}
                                                    </h2>
                                                </div>

                                                {/* Absender-Karte */}
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

                                                {/* Mail-Inhalt */}
                                                <div className="text-[12px] leading-relaxed text-black/65">
                                                    {currentMail.body_html ? (
                                                        <div
                                                            className="prose prose-xs max-w-none break-words overflow-hidden"
                                                            dangerouslySetInnerHTML={{ __html: currentMail.body_html }}
                                                        />
                                                    ) : (
                                                        <div className="italic leading-relaxed">{currentMail.body_text}</div>
                                                    )}
                                                </div>

                                                {/* Historischer Kontext */}
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

                                        {/* ── SPALTE 2: ANTWORT-ENTWURF (6/12 = 50%) ── */}
                                        <div className="col-span-6 flex flex-col bg-white border-r border-black/8 overflow-hidden">
                                            <div className="shrink-0 px-8 py-3 border-b border-black/5 flex items-center justify-between">
                                                <div className="flex items-center gap-2.5">
                                                    <span className="text-[9px] font-black uppercase tracking-[0.35em] text-[#6082B6]">Antwort-Entwurf</span>
                                                    <div className="flex items-center gap-1 px-2 py-0.5 bg-[#F39200]/10 border border-[#F39200]/30 text-[#F39200]" title="KI-Entwurf — nur intern sichtbar">
                                                        <Sparkles className="w-2.5 h-2.5" />
                                                        <span className="text-[7px] font-black uppercase tracking-widest">KI-Entwurf</span>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {(currentMail.status === "processing" || currentMail.status === "ignored") && (
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
                                                    <button
                                                        onClick={handleCopy}
                                                        disabled={!editedDraft || step < 4}
                                                        title="In Zwischenablage kopieren"
                                                        className="flex items-center gap-1.5 px-2.5 py-1 border border-black/10 hover:bg-black hover:text-white text-black/30 text-[8px] font-black uppercase tracking-widest transition-all disabled:opacity-20"
                                                    >
                                                        {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                                                        {copied ? "Kopiert" : "Kopieren"}
                                                    </button>
                                                </div>
                                            </div>

                                            <motion.div
                                                initial={{ opacity: 0, y: 8 }}
                                                animate={{ opacity: step >= 4 ? 1 : 0.04, y: step >= 4 ? 0 : 8 }}
                                                className="flex-1 flex flex-col min-h-0"
                                            >
                                                {currentMail.status === "ignored" || currentMail.intent === "Spam/Irrelevant" ? (
                                                    <div className="flex-1 flex flex-col items-center justify-center text-[#E2001A] gap-4">
                                                        <div className="w-14 h-14 border-2 border-[#E2001A] flex items-center justify-center font-bold text-2xl">!</div>
                                                        <div className="text-base font-bold uppercase tracking-widest text-center leading-tight">
                                                            SPAM / IRRELEVANT
                                                            <br />
                                                            <span className="text-[10px] font-medium opacity-60 tracking-normal capitalize">
                                                                Nachricht als nicht relevant eingestuft.
                                                            </span>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <textarea
                                                        value={editedDraft}
                                                        onChange={(e) => setEditedDraft(e.target.value)}
                                                        disabled={step < 4 || currentMail.status !== "processing"}
                                                        placeholder="Petulia erstellt Antwortvorschlag..."
                                                        className="flex-1 w-full px-10 py-8 bg-white text-black resize-none outline-none font-sans text-[15px] lg:text-[16px] font-medium leading-relaxed tracking-wide selection:bg-[#6082B6] selection:text-white disabled:cursor-default custom-scrollbar border-0"
                                                    />
                                                )}
                                            </motion.div>

                                            {/* Aktions-Buttons */}
                                            {currentMail.status === "processing" && (
                                                <motion.div
                                                    initial={{ opacity: 0, y: 6 }}
                                                    animate={{ opacity: step >= 4 ? 1 : 0, y: step >= 4 ? 0 : 6 }}
                                                    className="shrink-0 px-8 pb-7 pt-4 flex gap-3"
                                                >
                                                    <button
                                                        onClick={() => handleAction("approve")}
                                                        disabled={actionStatus !== "idle" || step < 4}
                                                        className="flex-[3] h-12 bg-[#6082B6] text-white hover:bg-[#444444] transition-all text-sm font-bold uppercase tracking-[0.2em] flex items-center justify-center gap-3 group disabled:opacity-30 active:translate-y-0.5 shadow-md"
                                                    >
                                                        {actionStatus === "approving" ? "WIRD VERARBEITET..." : "BESTÄTIGEN & AUSFÜHREN"}
                                                        <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleAction("reject")}
                                                        disabled={actionStatus !== "idle"}
                                                        className="flex-1 h-12 border border-black/10 bg-white hover:bg-[#E2001A] hover:text-white transition-all text-[9px] font-bold uppercase tracking-widest flex items-center justify-center text-black/30"
                                                    >
                                                        ABLEHNEN
                                                    </button>
                                                </motion.div>
                                            )}
                                        </div>

                                        {/* ── SPALTE 3: KOMPAKTE INSIGHTS (3/12 = 25%) ── */}
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

                                                {/* PMS-Reservierungsdaten */}
                                                {currentMail.agent_logs?.threeRpmsData ? (
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
                                                                <span className="text-[11px] font-bold text-[#444444] text-right truncate">
                                                                    {currentMail.agent_logs.threeRpmsData.first_guest?.lastname || "—"}
                                                                </span>
                                                            </div>
                                                            <div className="flex justify-between items-center gap-2">
                                                                <span className="text-[8px] uppercase text-black/25 font-black tracking-wide shrink-0">Code</span>
                                                                <span className="text-[8px] font-black bg-[#444444] text-white px-1.5 py-0.5">
                                                                    {currentMail.agent_logs.threeRpmsData.reservation?.code || "—"}
                                                                </span>
                                                            </div>
                                                            <div className="flex justify-between items-center gap-2">
                                                                <span className="text-[8px] uppercase text-black/25 font-black tracking-wide shrink-0">Anreise</span>
                                                                <span className="text-[10px] font-bold">
                                                                    {currentMail.agent_logs.threeRpmsData.reservation_from || "—"}
                                                                </span>
                                                            </div>
                                                            <div className="flex justify-between items-center gap-2">
                                                                <span className="text-[8px] uppercase text-black/25 font-black tracking-wide shrink-0">Abreise</span>
                                                                <span className="text-[10px] font-bold">
                                                                    {currentMail.agent_logs.threeRpmsData.reservation_to || "—"}
                                                                </span>
                                                            </div>
                                                            <div className="pt-2 mt-1 border-t border-black/5">
                                                                <span className="inline-block text-[9px] px-2 py-0.5 bg-green-50 text-green-700 border border-green-200 font-bold">
                                                                    {currentMail.agent_logs.threeRpmsData.status || "Aktive Buchung"}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </motion.div>
                                                ) : (
                                                    <div className="p-5 border border-dashed border-black/10 flex flex-col items-center gap-2 text-center">
                                                        <Database className="w-5 h-5 text-black/8" />
                                                        <div className="text-[9px] font-bold text-black/20 uppercase tracking-widest leading-snug">
                                                            {currentMail.status === "new"
                                                                ? "Wird analysiert..."
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
                                                            <div className="mt-2 text-[8px] font-mono opacity-35 uppercase tracking-wide">
                                                                Erst nach Bestätigung
                                                            </div>
                                                        </div>
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
                            <p className="mt-8 text-[12px] uppercase font-bold tracking-[0.4em] text-[#6082B6]">
                                Petulia bereit zur Bearbeitung
                            </p>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

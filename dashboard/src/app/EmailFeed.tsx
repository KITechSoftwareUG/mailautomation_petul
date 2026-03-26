"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    Check, X, Bot, Zap, User,
    ArrowRight, MessageSquare, Loader2, Clock, Building2, Maximize2, Minimize2, Mail, Layers
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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export function EmailFeed({ emails }: { emails: Email[] }) {
    const router = useRouter();
    const [selectedId, setSelectedId] = useState<string | null>(emails.find(e => e.status === 'processing')?.id || emails[0]?.id || null);
    const [actionStatus, setActionStatus] = useState<"idle" | "sending" | "rejecting">("idle");
    const [isMinimized, setIsMinimized] = useState(false);

    const pendingCount = emails.filter(e => e.status === "processing").length;
    const currentMail = emails.find(e => e.id === selectedId);

    useEffect(() => {
        const interval = setInterval(() => router.refresh(), 10000);
        return () => clearInterval(interval);
    }, [router]);

    const handleAction = async (status: "completed" | "rejected") => {
        if (!currentMail) return;
        setActionStatus(status === "completed" ? "sending" : "rejecting");
        try {
            await supabase.from("emails").update({ status }).eq("id", currentMail.id);
            await new Promise(resolve => setTimeout(resolve, 800));
            router.refresh();
        } finally {
            setActionStatus("idle");
        }
    };

    return (
        <div className="relative w-full h-screen overflow-hidden flex bg-transparent text-slate-800 uppercase tracking-tight selection:bg-indigo-100">

            {/* --- HUD INTERFACE (Deutsch & Optimiert) --- */}
            <div className="flex-1 flex items-center justify-center px-6 lg:px-12 relative z-40 transition-all duration-700">
                <AnimatePresence mode="wait">
                    {!isMinimized ? (
                        <motion.div
                            key="expanded-german-hud"
                            initial={{ opacity: 0, y: 15, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -25, scale: 1.02 }}
                            className="w-full max-w-7xl h-[88vh] glass-panel rounded-[60px] flex overflow-hidden shadow-[0_50px_120px_rgba(0,0,0,0.04)] border border-white"
                        >
                            {/* Linke Seitenleiste: Feed */}
                            <div className="w-80 border-r border-slate-100 flex flex-col bg-slate-50/50">
                                <div className="p-8 flex items-center justify-between border-b border-slate-100 bg-white/60">
                                    <div className="flex flex-col">
                                        <span className="text-[13px] font-black uppercase tracking-[0.3em] text-indigo-600">PETULIA ZENTRALE</span>
                                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">EINGANGSFUTTER</span>
                                    </div>
                                    {pendingCount > 0 && (
                                        <div className="bg-indigo-600 px-3 py-1 rounded-full text-[10px] font-black text-white animate-pulse">
                                            {pendingCount} PENDING
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2">
                                    {emails.slice(0, 30).map(email => (
                                        <button
                                            key={email.id}
                                            onClick={() => setSelectedId(email.id)}
                                            className={`w-full text-left p-6 rounded-[35px] transition-all duration-300 ${selectedId === email.id ? "bg-white shadow-[0_20px_45px_rgba(0,0,0,0.06)] ring-1 ring-slate-100" : "hover:bg-white/60 opacity-50 hover:opacity-100"}`}
                                        >
                                            <div className="flex items-center gap-2 mb-2">
                                                <div className={`w-2 h-2 rounded-full ${email.status === 'processing' ? 'bg-indigo-500 animate-pulse' : 'bg-slate-300'}`} />
                                                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter italic">{new Date(email.received_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} UHR</span>
                                            </div>
                                            <div className="text-[12px] font-black truncate mb-1 tracking-tight text-slate-900 leading-tight">{email.betreff || "Kein Betreff"}</div>
                                            <div className="text-[9px] text-slate-500 truncate italic tracking-normal font-medium">{email.senders?.[0]?.name || email.senders?.[0]?.email}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Hauptbereich: Entscheidung */}
                            <div className="flex-1 flex flex-col min-w-0 bg-transparent">
                                {currentMail ? (
                                    <div className="flex-1 flex flex-col p-10 lg:p-12 gap-10 overflow-hidden">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-4">
                                                <div className="px-6 py-2.5 bg-indigo-50 border border-indigo-100 rounded-full flex items-center gap-3 shadow-sm">
                                                    <Building2 className="w-4 h-4 text-indigo-500" />
                                                    <span className="text-[11px] font-black uppercase tracking-widest text-indigo-600">
                                                        HOTEL: {currentMail.agent_logs?.target_hotel || "NICHT IDENTIFIZIERT"}
                                                    </span>
                                                </div>
                                                <div className="px-5 py-2.5 bg-slate-50 rounded-full text-[10px] font-black uppercase tracking-widest text-slate-400 italic">
                                                    INTENT: {currentMail.intent || "ANALYSE..."}
                                                </div>
                                            </div>
                                            <div className="p-3 cursor-pointer opacity-10 hover:opacity-100 transition-opacity" onClick={() => setIsMinimized(true)}>
                                                <Minimize2 className="w-6 h-6 text-slate-900" />
                                            </div>
                                        </div>

                                        <div className="flex-1 grid grid-cols-12 gap-12 min-h-0 pb-6">
                                            {/* Original E-Mail Inhalt */}
                                            <div className="col-span-12 lg:col-span-7 bg-white rounded-[55px] p-12 flex flex-col overflow-hidden border border-slate-100 shadow-xl shadow-indigo-100/10 hover:shadow-indigo-100/20 transition-all relative">
                                                <div className="absolute top-6 left-12 text-[9px] font-black text-slate-200 uppercase tracking-[0.4em] font-mono">EINGEHENDES SIGNAL</div>
                                                <div className="flex-1 overflow-y-auto custom-scrollbar pt-10 pb-6 px-1">
                                                    <h2 className="text-3xl font-black text-slate-900 mb-10 leading-tight tracking-tighter italic select-text">{currentMail.betreff}</h2>
                                                    {currentMail.body_html ? (
                                                        <div className="prose prose-sm lg:prose-base opacity-90 tracking-normal font-sans select-text max-w-none leading-relaxed" dangerouslySetInnerHTML={{ __html: currentMail.body_html }} />
                                                    ) : (
                                                        <div className="text-lg font-serif italic text-slate-500 leading-relaxed tracking-normal p-10 bg-slate-50/50 rounded-[45px] select-text border border-dashed border-slate-200">&quot;{currentMail.body_text}&quot;</div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* KI-Antwort / Entwurf */}
                                            <div className="col-span-12 lg:col-span-5 flex flex-col gap-6 overflow-hidden">
                                                <div className="bg-indigo-600 rounded-[55px] p-12 shadow-[0_50px_100px_-25px_rgba(79,70,229,0.35)] flex flex-col flex-1 min-h-0 relative group">
                                                    <div className="absolute top-0 right-0 p-12 opacity-10 group-hover:opacity-20 transition-opacity duration-1000">
                                                        <Zap className="w-24 h-24 text-white" />
                                                    </div>
                                                    <h4 className="text-[11px] font-black uppercase text-white/50 mb-10 flex items-center gap-3 relative z-10 font-mono tracking-[0.3em]">
                                                        <Bot className="w-5 h-5" /> PETULIA LÖSUNG
                                                    </h4>
                                                    <div className="flex-1 overflow-y-auto custom-scrollbar text-[17px] font-bold leading-relaxed whitespace-pre-wrap pb-10 pr-2 text-white/95 tracking-normal relative z-10 select-text">
                                                        {currentMail.draft_reply || "ERSTELLE ANTWORT-LOGIK..."}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Steuerungskonsole */}
                                        {currentMail.status === "processing" && (
                                            <div className="flex gap-8 h-24 shrink-0 relative z-30 mb-2">
                                                <button
                                                    onClick={() => handleAction("rejected")} disabled={actionStatus !== "idle"}
                                                    className="flex-1 rounded-[40px] bg-white border-2 border-slate-100 hover:bg-rose-50 text-rose-500 transition-all text-[12px] font-black uppercase tracking-widest disabled:opacity-20 flex items-center justify-center gap-3 shadow-sm active:scale-95"
                                                >
                                                    <X className="w-6 h-6" /> ABLEHNEN & LÖSCHEN
                                                </button>
                                                <button
                                                    onClick={() => handleAction("completed")} disabled={actionStatus !== "idle"}
                                                    className="flex-[2] rounded-[40px] bg-slate-900 text-white hover:bg-indigo-600 shadow-2xl shadow-slate-200 transition-all text-[14px] font-black uppercase tracking-[0.3em] disabled:opacity-20 flex items-center justify-center gap-6 group active:scale-[0.98]"
                                                >
                                                    {actionStatus === 'sending' ? <Loader2 className="w-6 h-6 animate-spin text-white" /> : <Check className="w-8 h-8 text-emerald-400 group-hover:text-white transition-colors" />}
                                                    FREIGEBEN & ABSENDEN
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex-1 flex flex-col items-center justify-center opacity-10 grayscale">
                                        <Layers className="w-32 h-32 text-slate-800 animate-pulse" />
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="screensaver-german"
                            initial={{ opacity: 0, y: 40 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            className="bg-white/50 backdrop-blur-[60px] px-24 py-16 rounded-[120px] shadow-[0_80px_160px_rgba(0,0,0,0.05)] border border-white/80 cursor-pointer group hover:scale-[1.02] transition-transform duration-700"
                            onClick={() => setIsMinimized(false)}
                        >
                            <h1 className="text-[140px] font-black leading-[0.6] text-slate-900/10 uppercase select-none pointer-events-none italic tracking-tighter group-hover:text-indigo-600/20 transition-colors duration-1000">PETULIA</h1>
                            <p className="text-[14px] uppercase font-black tracking-[1.2em] text-indigo-600/20 mt-16 italic text-center">SYSTEM IN BEREITSCHAFT</p>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Hochwertiger Grain-Effekt */}
            <div className="fixed inset-0 pointer-events-none opacity-[0.04] mix-blend-overlay bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />
        </div>
    );
}

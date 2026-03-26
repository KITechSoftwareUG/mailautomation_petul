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

            {/* --- TRUE TRANSPARENT SILHOUETTE (Using Masking) --- */}
            <motion.div
                initial={false}
                animate={{
                    x: isMinimized ? 50 : 0,
                    scale: isMinimized ? 1.05 : 0.8,
                    y: isMinimized ? 0 : 80,
                    opacity: isMinimized ? 0.3 : 0.08
                }}
                transition={{ type: "spring", damping: 20 }}
                className="fixed left-0 bottom-0 z-50 petulia-float select-none pointer-events-auto cursor-pointer flex flex-col items-center"
                onClick={() => setIsMinimized(!isMinimized)}
            >
                <div className="relative group">
                    {/* The Trick: Using the image as a mask for a solid color background. 
                        Since the image is Dark-on-White, we invert it so the dark part becomes the visible mask. */}
                    <div
                        style={{
                            maskImage: 'url(/petulia_silhouette.png)',
                            WebkitMaskImage: 'url(/petulia_silhouette.png)',
                            maskSize: 'contain',
                            WebkitMaskSize: 'contain',
                            maskRepeat: 'no-repeat',
                            WebkitMaskRepeat: 'no-repeat',
                            backgroundColor: '#4338ca',
                            // Invert mask to make the dark silhouette the "visible" part
                            filter: 'invert(1) brightness(0.2)',
                            mixBlendMode: 'multiply'
                        }}
                        className="w-[500px] h-[500px] transition-transform group-hover:scale-105"
                    />

                    {pendingCount > 0 && (
                        <div className="absolute top-[25%] left-[25%] bg-indigo-600 w-10 h-10 rounded-full flex items-center justify-center text-xs font-black shadow-[0_10px_20px_rgba(79,70,229,0.3)] border-2 border-white text-white animate-bounce">
                            {pendingCount}
                        </div>
                    )}
                </div>
            </motion.div>

            {/* --- LIGHT HUD INTERFACE --- */}
            <div className="flex-1 flex items-center justify-center pl-[280px] pr-20 relative z-40">
                <AnimatePresence mode="wait">
                    {!isMinimized ? (
                        <motion.div
                            key="expanded-hud-light-transparent"
                            initial={{ opacity: 0, x: 20, scale: 0.99 }}
                            animate={{ opacity: 1, x: 0, scale: 1 }}
                            exit={{ opacity: 0, x: 80, scale: 1.05 }}
                            className="w-full max-w-5xl h-[78vh] glass-panel rounded-[50px] flex overflow-hidden shadow-2xl border border-white"
                        >
                            {/* Inner Sidebar */}
                            <div className="w-64 border-r border-slate-100 flex flex-col bg-slate-50/40">
                                <div className="p-6 flex items-center justify-between border-b border-slate-100 bg-white/50">
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Incoming Feed</span>
                                </div>
                                <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-1">
                                    {emails.slice(0, 15).map(email => (
                                        <button
                                            key={email.id}
                                            onClick={() => setSelectedId(email.id)}
                                            className={`w-full text-left p-4 rounded-[32px] transition-all ${selectedId === email.id ? "bg-white shadow-[0_15px_30px_rgba(0,0,0,0.05)] ring-1 ring-slate-100" : "hover:bg-white/50 opacity-40 hover:opacity-100"}`}
                                        >
                                            <div className="flex items-center gap-2 mb-1">
                                                <div className={`w-1.5 h-1.5 rounded-full ${email.status === 'processing' ? 'bg-indigo-500 animate-pulse' : 'bg-slate-300'}`} />
                                                <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter">{new Date(email.received_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                            </div>
                                            <div className="text-[11px] font-black truncate mb-0.5 tracking-tight text-slate-900">{email.betreff || "Untitled Request"}</div>
                                            <div className="text-[9px] text-slate-400 truncate italic tracking-normal">{email.senders?.[0]?.name}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Main Workspace Area */}
                            <div className="flex-1 flex flex-col min-w-0 bg-transparent">
                                {currentMail ? (
                                    <div className="flex-1 flex flex-col p-8 gap-6 overflow-hidden">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="px-4 py-1.5 bg-indigo-50 border border-indigo-100 rounded-full flex items-center gap-2 shadow-sm">
                                                    <Building2 className="w-3 h-3 text-indigo-500" />
                                                    <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600">
                                                        {currentMail.agent_logs?.target_hotel || "Petul Node"}
                                                    </span>
                                                </div>
                                                <div className="px-4 py-1.5 bg-slate-50 rounded-full text-[9px] font-black uppercase tracking-widest text-slate-400 italic">
                                                    {currentMail.intent}
                                                </div>
                                            </div>
                                            <div className="p-2 cursor-pointer opacity-20 hover:opacity-100 transition-opacity" onClick={() => setIsMinimized(true)}>
                                                <Minimize2 className="w-4 h-4 text-slate-900" />
                                            </div>
                                        </div>

                                        <div className="flex-1 grid grid-cols-12 gap-8 min-h-0 pb-6">
                                            {/* Original Content View */}
                                            <div className="col-span-12 lg:col-span-7 bg-white rounded-[45px] p-10 flex flex-col overflow-hidden border border-slate-100 shadow-xl shadow-indigo-100/10 hover:shadow-indigo-100/20 transition-all">
                                                <div className="absolute top-5 left-8 text-[8px] font-black text-slate-200 uppercase tracking-[0.3em]">Signal Source</div>
                                                <div className="flex-1 overflow-y-auto custom-scrollbar pt-6 pb-6 px-1">
                                                    <h2 className="text-xl font-black text-slate-900 mb-8 leading-tight tracking-tight italic">{currentMail.betreff}</h2>
                                                    {currentMail.body_html ? (
                                                        <div className="prose prose-sm opacity-90 tracking-normal font-sans" dangerouslySetInnerHTML={{ __html: currentMail.body_html }} />
                                                    ) : (
                                                        <div className="text-base font-serif italic text-slate-500 leading-relaxed tracking-normal p-6 bg-slate-50/50 rounded-3xl">&quot;{currentMail.body_text}&quot;</div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Response Synthesis */}
                                            <div className="col-span-12 lg:col-span-5 flex flex-col gap-4 overflow-hidden">
                                                <div className="bg-indigo-600 rounded-[45px] p-10 shadow-[0_40px_80px_-15px_rgba(79,70,229,0.3)] flex flex-col flex-1 min-h-0 relative group">
                                                    <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                                                        <Zap className="w-16 h-16 text-white" />
                                                    </div>
                                                    <h4 className="text-[9px] font-black uppercase text-white/50 mb-6 flex items-center gap-3 relative z-10 font-mono">
                                                        <Bot className="w-4 h-4" /> AI RESOLUTION
                                                    </h4>
                                                    <div className="flex-1 overflow-y-auto custom-scrollbar text-[15px] font-semibold leading-relaxed whitespace-pre-wrap pb-6 pr-2 text-white/95 tracking-normal relative z-10">
                                                        {currentMail.draft_reply || "Architecting logic stream..."}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* HUD Control Actions */}
                                        {currentMail.status === "processing" && (
                                            <div className="flex gap-4 h-18 shrink-0 relative z-30 mb-2">
                                                <button
                                                    onClick={() => handleAction("rejected")} disabled={actionStatus !== "idle"}
                                                    className="flex-1 rounded-[32px] bg-white border border-slate-100 hover:bg-rose-50 text-rose-500 transition-all text-[10px] font-black uppercase tracking-widest disabled:opacity-20 flex items-center justify-center gap-2 shadow-sm"
                                                >
                                                    <X className="w-5 h-5" /> Discard
                                                </button>
                                                <button
                                                    onClick={() => handleAction("completed")} disabled={actionStatus !== "idle"}
                                                    className="flex-[2] rounded-[32px] bg-slate-900 text-white hover:bg-indigo-600 shadow-2xl shadow-slate-200 transition-all text-[11px] font-black uppercase tracking-[0.3em] disabled:opacity-20 flex items-center justify-center gap-4 group active:scale-[0.98]"
                                                >
                                                    {actionStatus === 'sending' ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <Check className="w-6 h-6 text-emerald-400 group-hover:text-white transition-colors" />}
                                                    Authorize & Deploy
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex-1 flex flex-col items-center justify-center opacity-10">
                                        <Layers className="w-24 h-24 text-slate-800 animate-pulse" />
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="screensaver-mode-final"
                            initial={{ opacity: 0, y: 30 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="w-full text-center"
                        >
                            <h1 className="text-[180px] font-black leading-[0.7] text-slate-900/[0.03] uppercase select-none pointer-events-none italic tracking-tighter">PETULIA</h1>
                            <p className="text-[12px] uppercase font-black tracking-[0.8em] text-indigo-600/10 mt-10 italic">Hub Online / Standing By</p>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}

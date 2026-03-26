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

            {/* --- HUD INTERFACE (Centered & Full space) --- */}
            <div className="flex-1 flex items-center justify-center px-10 relative z-40 transition-all duration-700">
                <AnimatePresence mode="wait">
                    {!isMinimized ? (
                        <motion.div
                            key="expanded-clean-hud"
                            initial={{ opacity: 0, y: 10, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -20, scale: 1.02 }}
                            className="w-full max-w-6xl h-[85vh] glass-panel rounded-[60px] flex overflow-hidden shadow-[0_50px_100px_rgba(0,0,0,0.03)] border border-white"
                        >
                            {/* Inner Sidebar */}
                            <div className="w-72 border-r border-slate-100 flex flex-col bg-slate-50/40">
                                <div className="p-8 flex items-center justify-between border-b border-slate-100 bg-white/50">
                                    <div className="flex flex-col">
                                        <span className="text-[12px] font-black uppercase tracking-[0.3em] text-indigo-600">Petulia Hub</span>
                                        <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest mt-1">Live Feed</span>
                                    </div>
                                    {pendingCount > 0 && (
                                        <div className="bg-indigo-600 px-2 py-0.5 rounded-full text-[9px] font-black text-white animate-pulse">
                                            {pendingCount}
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-1.5">
                                    {emails.slice(0, 20).map(email => (
                                        <button
                                            key={email.id}
                                            onClick={() => setSelectedId(email.id)}
                                            className={`w-full text-left p-5 rounded-[35px] transition-all duration-300 ${selectedId === email.id ? "bg-white shadow-[0_20px_40px_rgba(0,0,0,0.04)] ring-1 ring-slate-100" : "hover:bg-white/50 opacity-50 hover:opacity-100"}`}
                                        >
                                            <div className="flex items-center gap-2 mb-1.5">
                                                <div className={`w-1.5 h-1.5 rounded-full ${email.status === 'processing' ? 'bg-indigo-500 animate-pulse' : 'bg-slate-300'}`} />
                                                <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter">{new Date(email.received_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                            </div>
                                            <div className="text-[11px] font-black truncate mb-0.5 tracking-tight text-slate-900">{email.betreff || "Untagged Transmission"}</div>
                                            <div className="text-[9px] text-slate-400 truncate italic tracking-normal">{email.senders?.[0]?.name || email.senders?.[0]?.email}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Main Workspace Area */}
                            <div className="flex-1 flex flex-col min-w-0 bg-transparent">
                                {currentMail ? (
                                    <div className="flex-1 flex flex-col p-10 gap-8 overflow-hidden">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-4">
                                                <div className="px-5 py-2 bg-indigo-50 border border-indigo-100 rounded-full flex items-center gap-3 shadow-sm">
                                                    <Building2 className="w-3.5 h-3.5 text-indigo-500" />
                                                    <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600">
                                                        {currentMail.agent_logs?.target_hotel || "Management Node"}
                                                    </span>
                                                </div>
                                                <div className="px-4 py-2 bg-slate-50 rounded-full text-[9px] font-black uppercase tracking-widest text-slate-400 italic">
                                                    {currentMail.intent}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <div className="p-2 cursor-pointer opacity-10 hover:opacity-100 transition-opacity" onClick={() => setIsMinimized(true)}>
                                                    <Minimize2 className="w-5 h-5 text-slate-900" />
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex-1 grid grid-cols-12 gap-10 min-h-0 pb-4">
                                            {/* Original Content View */}
                                            <div className="col-span-12 lg:col-span-7 bg-white rounded-[50px] p-10 flex flex-col overflow-hidden border border-slate-100 shadow-xl shadow-indigo-100/10 hover:shadow-indigo-100/20 transition-all relative">
                                                <div className="absolute top-6 left-10 text-[8px] font-black text-slate-200 uppercase tracking-[0.4em]">Signal Source</div>
                                                <div className="flex-1 overflow-y-auto custom-scrollbar pt-8 pb-6 px-2">
                                                    <h2 className="text-2xl font-black text-slate-900 mb-10 leading-tight tracking-tight italic select-text">{currentMail.betreff}</h2>
                                                    {currentMail.body_html ? (
                                                        <div className="prose prose-sm opacity-90 tracking-normal font-sans select-text max-w-none" dangerouslySetInnerHTML={{ __html: currentMail.body_html }} />
                                                    ) : (
                                                        <div className="text-base font-serif italic text-slate-500 leading-relaxed tracking-normal p-8 bg-slate-50/50 rounded-[40px] select-text">&quot;{currentMail.body_text}&quot;</div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Response Synthesis */}
                                            <div className="col-span-12 lg:col-span-5 flex flex-col gap-6 overflow-hidden">
                                                <div className="bg-indigo-600 rounded-[50px] p-12 shadow-[0_40px_80px_-20px_rgba(79,70,229,0.3)] flex flex-col flex-1 min-h-0 relative group">
                                                    <div className="absolute top-0 right-0 p-10 opacity-10 group-hover:opacity-20 transition-opacity duration-700">
                                                        <Zap className="w-20 h-20 text-white" />
                                                    </div>
                                                    <h4 className="text-[10px] font-black uppercase text-white/50 mb-8 flex items-center gap-3 relative z-10 font-mono tracking-[0.2em]">
                                                        <Bot className="w-4 h-4" /> AI RESOLUTION
                                                    </h4>
                                                    <div className="flex-1 overflow-y-auto custom-scrollbar text-[16px] font-semibold leading-relaxed whitespace-pre-wrap pb-6 pr-2 text-white/95 tracking-normal relative z-10 select-text">
                                                        {currentMail.draft_reply || "Architecting logic stream..."}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Interaction Logic */}
                                        {currentMail.status === "processing" && (
                                            <div className="flex gap-6 h-20 shrink-0 relative z-30 mb-2">
                                                <button
                                                    onClick={() => handleAction("rejected")} disabled={actionStatus !== "idle"}
                                                    className="flex-1 rounded-[35px] bg-white border border-slate-100 hover:bg-rose-50 text-rose-500 transition-all text-[11px] font-black uppercase tracking-widest disabled:opacity-20 flex items-center justify-center gap-2 shadow-sm active:scale-95"
                                                >
                                                    <X className="w-5 h-5" /> Discard Dispatch
                                                </button>
                                                <button
                                                    onClick={() => handleAction("completed")} disabled={actionStatus !== "idle"}
                                                    className="flex-[2] rounded-[35px] bg-slate-900 text-white hover:bg-indigo-600 shadow-2xl shadow-slate-200 transition-all text-[12px] font-black uppercase tracking-[0.3em] disabled:opacity-20 flex items-center justify-center gap-5 group active:scale-[0.98]"
                                                >
                                                    {actionStatus === 'sending' ? <Loader2 className="w-5 h-5 animate-spin text-white" /> : <Check className="w-7 h-7 text-emerald-400 group-hover:text-white transition-colors" />}
                                                    Authorize & Deploy
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex-1 flex flex-col items-center justify-center opacity-5">
                                        <Layers className="w-24 h-24 text-slate-800 animate-pulse" />
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="screensaver-clean"
                            initial={{ opacity: 0, y: 30 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-white/40 backdrop-blur-3xl px-16 py-12 rounded-[100px] shadow-2xl border border-white cursor-pointer group hover:scale-105 transition-transform"
                            onClick={() => setIsMinimized(false)}
                        >
                            <h1 className="text-[120px] font-black leading-[0.7] text-slate-900/5 uppercase select-none pointer-events-none italic tracking-tighter group-hover:text-indigo-600/10 transition-colors">PETULIA</h1>
                            <p className="text-[12px] uppercase font-black tracking-[1em] text-indigo-600/10 mt-12 italic">System Standing By</p>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Grain/Texture Effect */}
            <div className="fixed inset-0 pointer-events-none opacity-[0.03] mix-blend-multiply bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />
        </div>
    );
}

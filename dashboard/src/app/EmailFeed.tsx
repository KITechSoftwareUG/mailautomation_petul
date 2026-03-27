"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { 
    Bot, ArrowRight, Minimize2, Layers, CheckCircle2, CircleDashed, Terminal, BrainCircuit, PenTool, Database, MessageSquare
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

function AgentStatusHeader({ step, currentMail }: { step: number, currentMail: Email }) {
    const agents = [
        { name: "PRÜFUNG", desc: currentMail.intent || "Eingang...", icon: BrainCircuit },
        { name: "ERP-SYSTEM", desc: currentMail.api_action || "Datenabgleich...", icon: Database },
        { name: "WISSEN", desc: "Regeln geladen", icon: Terminal },
        { name: "VORBEREITUNG", desc: "Entwurf fertig", icon: PenTool },
    ];

    return (
        <div className="grid grid-cols-4 gap-4 mb-8">
            {agents.map((agent, idx) => {
                const isActive = step === idx;
                const isDone = step > idx;
                const Icon = agent.icon;
                return (
                    <div key={idx} className={`relative p-3 border-2 transition-all duration-500 ${isDone ? 'bg-black border-black text-white' : isActive ? 'bg-[#C38133] border-[#C38133] text-white shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]' : 'bg-white border-black/10 text-black/20'}`}>
                        <div className="flex items-center gap-3">
                            <Icon className={`w-4 h-4 ${isActive ? 'animate-pulse' : ''}`} />
                            <div className="flex flex-col min-w-0">
                                <span className="text-[9px] font-black uppercase tracking-widest leading-tight truncate">{agent.name}</span>
                                <span className={`text-[11px] font-bold truncate ${isActive || isDone ? 'opacity-100' : 'opacity-0'}`}>{agent.desc}</span>
                            </div>
                        </div>
                        {isDone && <CheckCircle2 className="absolute top-1 right-1 w-3 h-3 text-[#C38133]" />}
                    </div>
                )
            })}
        </div>
    );
}

export function EmailFeed({ emails }: { emails: Email[] }) {
    const router = useRouter();
    const [selectedId, setSelectedId] = useState<string | null>(emails.find(e => e.status === 'processing')?.id || emails[0]?.id || null);
    const [actionStatus, setActionStatus] = useState<"idle" | "sending" | "rejecting">("idle");
    const [isMinimized, setIsMinimized] = useState(false);
    const [step, setStep] = useState(0);

    const pendingCount = emails.filter(e => e.status === "processing").length;
    const currentMail = emails.find(e => e.id === selectedId);

    useEffect(() => {
        const interval = setInterval(() => router.refresh(), 10000);
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
        <div className="relative w-full h-screen overflow-hidden flex bg-[#F2EFE6] text-black tracking-tight selection:bg-[#C38133] selection:text-white font-sans">
            
            <div className="flex-1 flex items-center justify-center p-6 lg:p-12 relative z-40 transition-all duration-700">
                <AnimatePresence mode="wait">
                    {!isMinimized ? (
                        <motion.div 
                            key="expanded-focus-mode"
                            initial={{ opacity: 0, scale: 0.99 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 1.01 }}
                            className="w-full max-w-screen-2xl h-[92vh] flex bg-white border-4 border-black shadow-[30px_30px_0px_0px_rgba(0,0,0,1)]"
                        >
                            {/* LEFT SIDEBAR: PENDING */}
                            <div className="w-80 border-r-4 border-black flex flex-col bg-[#F2EFE6]">
                                <div className="p-8 border-b-4 border-black bg-white">
                                    <h1 className="text-4xl font-black uppercase tracking-tighter leading-none mb-2">PETULIA</h1>
                                    <div className="text-[10px] font-bold text-[#C38133] uppercase tracking-widest flex items-center gap-2">
                                        <div className="w-2 h-2 bg-[#C38133] animate-pulse" />
                                        {pendingCount} NEUE MAILS
                                    </div>
                                </div>
                                <div className="flex-1 overflow-y-auto custom-scrollbar">
                                    {emails.slice(0, 30).map(email => (
                                        <button 
                                            key={email.id}
                                            onClick={() => setSelectedId(email.id)}
                                            className={`w-full text-left p-6 border-b-2 border-black/5 transition-all duration-200 ${selectedId === email.id ? "bg-black text-white" : "hover:bg-white bg-transparent"}`}
                                        >
                                            <div className="text-[12px] font-bold uppercase truncate mb-1 tracking-tight leading-tight">{email.betreff || "Kein Betreff"}</div>
                                            <div className={`text-[10px] font-bold uppercase tracking-widest opacity-50`}>{new Date(email.received_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} UHR</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* MAIN DECISION ENGINE */}
                            <div className="flex-1 flex flex-col min-w-0 bg-white">
                                {currentMail ? (
                                    <div className="flex-1 flex flex-col overflow-hidden">
                                        {/* HEADER BAR */}
                                        <div className="flex items-center justify-between px-10 py-6 border-b-4 border-black bg-white">
                                            <div className="flex items-center gap-6">
                                                <div className="px-4 py-2 border-2 border-black bg-white text-[12px] font-black uppercase tracking-widest">
                                                    {currentMail.agent_logs?.target_hotel || "HAUPTHAUS"}
                                                </div>
                                                <div className="text-[14px] font-black uppercase italic text-black/40">Zentrale Ansicht</div>
                                            </div>
                                            <button className="hover:rotate-90 transition-transform duration-500" title="Bildschirmschoner" onClick={() => setIsMinimized(true)}>
                                                <Minimize2 className="w-8 h-8" />
                                            </button>
                                        </div>

                                        <div className="flex-1 grid grid-cols-12 min-h-0">
                                            {/* LEFT: ORIGINAL (SMALLER) */}
                                            <div className="col-span-4 border-r-4 border-black bg-[#F2EFE6]/30 flex flex-col overflow-y-auto custom-scrollbar p-8">
                                                <div className="flex items-center gap-2 mb-6 opacity-30">
                                                    <MessageSquare className="w-4 h-4" />
                                                    <span className="text-[10px] font-black uppercase tracking-[0.4em]">E-Mail Verlauf</span>
                                                </div>
                                                
                                                {/* Actual Mail Content */}
                                                <div className="mb-10 bg-white p-6 border-2 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,0.1)]">
                                                    <h2 className="text-lg font-bold uppercase tracking-tight mb-4 leading-tight">{currentMail.betreff}</h2>
                                                    {currentMail.body_html ? (
                                                        <div className="prose prose-sm opacity-90 max-w-none break-words overflow-hidden" dangerouslySetInnerHTML={{ __html: currentMail.body_html }} />
                                                    ) : (
                                                        <div className="text-sm italic opacity-80">&quot;{currentMail.body_text}&quot;</div>
                                                    )}
                                                </div>

                                                {/* Simplified Thread/Context View */}
                                                {currentMail.agent_logs?.relevant_context ? (
                                                    <div className="mt-4 flex flex-col gap-4">
                                                        <div className="h-px bg-black/10 w-full" />
                                                        <span className="text-[9px] font-black uppercase tracking-widest text-black/40">Zusatz-Infos / Verlauf:</span>
                                                        <div className="text-[13px] text-black/70 italic leading-relaxed bg-black/5 p-4 rounded-lg border border-black/5">
                                                            {currentMail.agent_logs.relevant_context}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="mt-4 text-[11px] uppercase font-bold text-black/20 text-center py-10 border-2 border-dashed border-black/10">
                                                        Kein weiterer Verlauf gefunden
                                                    </div>
                                                )}
                                            </div>

                                            {/* RIGHT: RESOLUTION (PRIMARY) */}
                                            <div className="col-span-8 flex flex-col p-8 bg-white overflow-hidden">
                                                <AgentStatusHeader step={step} currentMail={currentMail} />
                                                
                                                <div className="flex-1 flex flex-col min-h-0">
                                                    <div className="flex items-center justify-between mb-4">
                                                        <span className="text-[10px] font-black uppercase tracking-[0.4em] text-[#C38133]">Antwort-Entwurf (Testphase):</span>
                                                        <div className="px-3 py-1 bg-[#C38133]/10 text-[#C38133] text-[9px] font-black uppercase rounded-full">Nur zur Ansicht</div>
                                                    </div>
                                                    
                                                    <motion.div 
                                                        initial={{ opacity: 0, y: 30 }}
                                                        animate={{ opacity: step >= 4 ? 1 : 0.05, y: step >= 4 ? 0 : 10 }}
                                                        className="flex-1 p-10 border-4 border-black bg-black text-white overflow-y-auto custom-scrollbar shadow-[15px_15px_0px_0px_#C38133]"
                                                    >
                                                        <div className="text-[22px] lg:text-[24px] font-bold leading-relaxed whitespace-pre-wrap tracking-wide font-serif selection:bg-[#C38133] selection:text-white">
                                                            {currentMail.draft_reply || "KI berechnet Antwort..."}
                                                        </div>
                                                    </motion.div>

                                                    {/* MASTER APPROVAL ACTION */}
                                                    {currentMail.status === "processing" && (
                                                        <motion.div 
                                                            initial={{ opacity: 0, scale: 0.9 }}
                                                            animate={{ opacity: step >= 4 ? 1 : 0, scale: step >= 4 ? 1 : 0.95 }}
                                                            className="mt-8 flex gap-6 h-28 shrink-0"
                                                        >
                                                            <button 
                                                                onClick={() => handleAction("completed")} disabled={actionStatus !== "idle" || step < 4}
                                                                className="flex-[3] bg-black text-white hover:bg-[#C38133] border-4 border-black transition-all text-2xl font-black uppercase tracking-[0.3em] flex items-center justify-center gap-8 group disabled:opacity-30 active:translate-y-2 active:shadow-none shadow-[12px_12px_0px_0px_rgba(0,0,0,0.1)]"
                                                            >
                                                                ENTWURF BESTÄTIGEN
                                                                <ArrowRight className="w-10 h-10 group-hover:translate-x-4 transition-transform" />
                                                            </button>
                                                            <button 
                                                                onClick={() => handleAction("rejected")} disabled={actionStatus !== "idle"}
                                                                className="flex-1 border-4 border-black hover:bg-rose-600 hover:text-white transition-all text-[14px] font-black uppercase tracking-widest flex items-center justify-center opacity-40 hover:opacity-100"
                                                            >
                                                                ABLEHNEN
                                                            </button>
                                                        </motion.div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex-1 flex flex-col items-center justify-center bg-[#F2EFE6]">
                                        <Layers className="w-24 h-24 text-black/10 animate-pulse" />
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div 
                            key="screensaver-editorial"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-[#F2EFE6] border-4 border-black px-16 py-20 lg:px-32 lg:py-24 shadow-[20px_20px_0px_0px_rgba(0,0,0,1)] cursor-pointer hover:-translate-y-2 transition-transform duration-300"
                            onClick={() => setIsMinimized(false)}
                        >
                            <h1 className="text-[100px] lg:text-[180px] font-black leading-none text-black uppercase tracking-tighter m-0 p-0">PETULIA</h1>
                            <div className="flex items-center gap-6 mt-8">
                                <div className="h-1 flex-1 bg-black" />
                                <p className="text-[16px] lg:text-[24px] uppercase font-bold tracking-[0.2em] text-[#C38133] m-0">ASSISTENT BEREIT</p>
                                <div className="h-1 flex-1 bg-black" />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
            
        </div>
    );
}

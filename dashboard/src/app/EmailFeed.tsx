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
    const hotelName = currentMail.agent_logs?.target_hotel || "UNKLAR";
    const erpDesc = hotelName === "UNKLAR" ? "Hotel unklar" : `Prüfe ${hotelName}`;
    
    const agents = [
        { name: "PRÜFUNG", desc: currentMail.intent || "Eingang...", icon: BrainCircuit },
        { name: "HOTEL-SYSTEM", desc: erpDesc, icon: Database },
        { name: "WISSEN", desc: "Regeln geladen", icon: Terminal },
        { name: "VORBEREITUNG", desc: "Entwurf fertig", icon: PenTool },
    ];

    return (
        <div className="grid grid-cols-4 gap-4 mb-10">
            {agents.map((agent, idx) => {
                const isActive = step === idx;
                const isDone = step > idx;
                const Icon = agent.icon;
                const isWarning = agent.name === "HOTEL-SYSTEM" && hotelName === "UNKLAR" && (isActive || isDone);

                return (
                    <div key={idx} className={`relative p-3 border-2 rounded-none transition-all duration-500 ${isDone ? 'bg-[#444444] border-[#444444] text-white' : isActive ? 'bg-[#6082B6] border-[#6082B6] text-white shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]' : 'bg-white border-black/10 text-black/20'} ${isWarning ? 'border-[#E2001A] !text-[#E2001A]' : ''}`}>
                        <div className="flex items-center gap-3">
                            <Icon className={`w-4 h-4 ${isActive ? 'animate-pulse' : ''}`} />
                            <div className="flex flex-col min-w-0">
                                <span className="text-[9px] font-black uppercase tracking-widest leading-tight truncate">{agent.name}</span>
                                <span className={`text-[11px] font-bold truncate ${isActive || isDone ? 'opacity-100' : 'opacity-0'}`}>{agent.desc}</span>
                            </div>
                        </div>
                        {isDone && !isWarning && <CheckCircle2 className="absolute top-1 right-1 w-3 h-3 text-white/50" />}
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
        <div className="relative w-full h-screen overflow-hidden flex bg-[#F9F9F9] text-black tracking-tight selection:bg-[#6082B6] selection:text-white font-sans">
            
            <div className="flex-1 flex items-center justify-center p-6 lg:p-10 relative z-40 transition-all duration-700">
                <AnimatePresence mode="wait">
                    {!isMinimized ? (
                        <motion.div 
                            key="expanded-focus-mode"
                            initial={{ opacity: 0, scale: 1 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 1 }}
                            className="w-full max-w-screen-2xl h-[94vh] flex bg-white border-2 border-black/10 shadow-[40px_40px_80px_0px_rgba(0,0,0,0.1)] rounded-none overflow-hidden"
                        >
                            {/* LEFT SIDEBAR: PENDING */}
                            <div className="w-80 border-r border-black/10 flex flex-col bg-[#444444] text-white">
                                <div className="p-8 pb-4 bg-[#444444]">
                                    <div className="flex flex-col mb-4">
                                        <h1 className="text-3xl font-serif tracking-widest leading-none mb-1">APART HOTELS</h1>
                                        <span className="text-2xl font-light italic lowercase opacity-80" style={{ fontFamily: 'serif' }}>petul</span>
                                    </div>
                                    
                                    {/* Brand Spectrum Bar */}
                                    <div className="flex h-1 w-full mb-6">
                                        <div className="flex-1 bg-[#E2001A]" />
                                        <div className="flex-1 bg-[#F39200]" />
                                        <div className="flex-1 bg-[#009697]" />
                                        <div className="flex-1 bg-[#6082B6]" />
                                    </div>

                                    <div className="text-[10px] font-bold text-[#F39200] uppercase tracking-widest flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 bg-[#F39200] rounded-full animate-pulse" />
                                        {pendingCount} POSTEINGÄNGE
                                    </div>
                                </div>
                                <div className="flex-1 overflow-y-auto custom-scrollbar px-4">
                                    {emails.slice(0, 30).map(email => (
                                        <button 
                                            key={email.id}
                                            onClick={() => setSelectedId(email.id)}
                                            className={`w-full text-left p-5 mb-2 rounded-none transition-all duration-200 border-l-4 ${selectedId === email.id ? "bg-white/10 border-[#6082B6] text-white" : "hover:bg-white/5 border-transparent text-white/60"}`}
                                        >
                                            <div className="text-[12px] font-bold uppercase truncate mb-1 tracking-tight leading-tight">{email.betreff || "Kein Betreff"}</div>
                                            <div className={`text-[10px] font-bold uppercase tracking-widest opacity-40`}>{new Date(email.received_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} UHR</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* MAIN DECISION ENGINE */}
                            <div className="flex-1 flex flex-col min-w-0 bg-[#F9F9F9]">
                                {currentMail ? (
                                    <div className="flex-1 flex flex-col overflow-hidden">
                                        {/* HEADER BAR */}
                                        <div className="flex items-center justify-between px-10 py-6 border-b border-black/10 bg-white">
                                            <div className="flex items-center gap-6">
                                                <div className="px-4 py-2 border border-black/10 bg-[#F2F2F2] text-[12px] font-bold uppercase tracking-widest">
                                                    {currentMail.agent_logs?.target_hotel || "HAUPTHAUS"}
                                                </div>
                                                <div className="text-[12px] font-bold uppercase tracking-widest text-[#6082B6]">Petulia Decision Hub</div>
                                            </div>
                                            <button className="hover:rotate-90 transition-transform duration-500 text-[#444444]" title="Bildschirmschoner" onClick={() => setIsMinimized(true)}>
                                                <Minimize2 className="w-6 h-6" />
                                            </button>
                                        </div>

                                        <div className="flex-1 grid grid-cols-12 min-h-0">
                                            {/* LEFT: ORIGINAL (WIDER) */}
                                            <div className="col-span-5 border-r-4 border-black bg-[#F2EFE6]/30 flex flex-col overflow-y-auto custom-scrollbar p-8">
                                                <div className="flex items-center gap-2 mb-6 opacity-30">
                                                    <MessageSquare className="w-4 h-4" />
                                                    <span className="text-[10px] font-black uppercase tracking-[0.4em]">E-Mail Verlauf</span>
                                                </div>
                                                
                                                {/* Actual Mail Content */}
                                                <div className="mb-10 bg-white p-8 border border-black/5 shadow-sm rounded-none">
                                                    <h2 className="text-xl font-bold tracking-tight mb-5 leading-tight">{currentMail.betreff}</h2>
                                                    {currentMail.body_html ? (
                                                        <div className="prose prose-sm opacity-90 max-w-none break-words overflow-hidden" dangerouslySetInnerHTML={{ __html: currentMail.body_html }} />
                                                    ) : (
                                                        <div className="text-sm italic opacity-80 leading-relaxed">&quot;{currentMail.body_text}&quot;</div>
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

                                            {/* RIGHT: RESOLUTION */}
                                            <div className="col-span-7 flex flex-col p-8 bg-white overflow-hidden">
                                                <AgentStatusHeader step={step} currentMail={currentMail} />
                                                
                                                <div className="flex-1 flex flex-col min-h-0">
                                                    <div className="flex items-center justify-between mb-4">
                                                        <span className="text-[10px] font-bold uppercase tracking-[0.4em] text-[#6082B6]">Antwort-Entwurf:</span>
                                                        <div className="px-3 py-1 bg-[#6082B6]/10 text-[#6082B6] text-[9px] font-black uppercase rounded-none">Vorschlag</div>
                                                    </div>
                                                    
                                                    <motion.div 
                                                        initial={{ opacity: 0, y: 30 }}
                                                        animate={{ opacity: step >= 4 ? 1 : 0.05, y: step >= 4 ? 0 : 10 }}
                                                        className="flex-1 p-10 border border-black/10 bg-white text-black overflow-y-auto custom-scrollbar shadow-inner rounded-none"
                                                    >
                                                        <div className="text-[17px] lg:text-[19px] font-medium leading-relaxed whitespace-pre-wrap tracking-wide font-sans selection:bg-[#6082B6] selection:text-white h-full flex flex-col justify-center">
                                                            {currentMail.status === "ignored" || currentMail.intent === "Spam/Irrelevant" ? (
                                                                <div className="flex flex-col items-center justify-center text-[#E2001A] gap-4 py-12">
                                                                    <div className="w-16 h-16 border-2 border-[#E2001A] flex items-center justify-center font-bold text-3xl rounded-none">!</div>
                                                                    <div className="text-xl font-bold uppercase tracking-widest text-center leading-tight">
                                                                        SPAM / IRRELEVANT<br/>
                                                                        <span className="text-xs font-medium opacity-60 tracking-normal capitalize">Petulia hat diese Nachricht als nicht relevant eingestuft.</span>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                currentMail.draft_reply || "Petulia erstellt Antwortvorschlag..."
                                                            )}
                                                        </div>
                                                    </motion.div>

                                                    {/* MASTER APPROVAL ACTION */}
                                                    {currentMail.status === "processing" && (
                                                        <motion.div 
                                                            initial={{ opacity: 0, scale: 0.9 }}
                                                            animate={{ opacity: step >= 4 ? 1 : 0, scale: step >= 4 ? 1 : 0.95 }}
                                                            className="mt-8 flex gap-6 h-24 shrink-0"
                                                        >
                                                            <button 
                                                                onClick={() => handleAction("completed")} disabled={actionStatus !== "idle" || step < 4}
                                                                className="flex-[3] bg-[#6082B6] text-white hover:bg-[#444444] border-0 rounded-none transition-all text-xl font-bold uppercase tracking-[0.2em] flex items-center justify-center gap-6 group disabled:opacity-30 active:translate-y-1 shadow-lg"
                                                            >
                                                                JETZT BESTÄTIGEN
                                                                <ArrowRight className="w-8 h-8 group-hover:translate-x-2 transition-transform" />
                                                            </button>
                                                            <button 
                                                                onClick={() => handleAction("rejected")} disabled={actionStatus !== "idle"}
                                                                className="flex-1 border border-black/10 bg-white hover:bg-[#E2001A] hover:text-white rounded-none transition-all text-[12px] font-bold uppercase tracking-widest flex items-center justify-center text-black/40 hover:opacity-100 shadow-sm"
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
                            initial={{ opacity: 0, scale: 1 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 1 }}
                            className="bg-white border border-black/10 px-16 py-20 lg:px-24 lg:py-20 shadow-2xl rounded-none cursor-pointer hover:shadow-3xl transition-all duration-300"
                            onClick={() => setIsMinimized(false)}
                        >
                            <div className="flex flex-col mb-10 items-center">
                                <h1 className="text-[60px] lg:text-[100px] font-serif tracking-widest leading-none text-[#444444] uppercase m-0 p-0 text-center">APART HOTELS</h1>
                                <span className="text-[50px] lg:text-[80px] font-light italic lowercase text-[#444444] opacity-80 -mt-4" style={{ fontFamily: 'serif' }}>petul</span>
                            </div>
                            <div className="flex items-center gap-6 mt-8">
                                <div className="h-0.5 flex-1 bg-[#E2001A]" />
                                <div className="h-0.5 flex-1 bg-[#F39200]" />
                                <div className="h-0.5 flex-1 bg-[#009697]" />
                                <div className="h-0.5 flex-1 bg-[#6082B6]" />
                            </div>
                            <p className="text-center mt-8 text-[12px] uppercase font-bold tracking-[0.4em] text-[#6082B6] m-0">Petulia bereit zur Bearbeitung</p>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
            
        </div>
    );
}

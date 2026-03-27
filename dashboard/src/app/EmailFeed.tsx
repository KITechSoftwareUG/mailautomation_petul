"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { 
    Bot, ArrowRight, Minimize2, Layers, CheckCircle2, CircleDashed, Terminal, BrainCircuit, PenTool
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

function AgentWorkflow({ intent, draft_reply }: { intent?: string, draft_reply?: string}) {
    const [step, setStep] = useState(0);

    useEffect(() => {
        setStep(0);
        const t1 = setTimeout(() => setStep(1), 800);
        const t2 = setTimeout(() => setStep(2), 1800);
        const t3 = setTimeout(() => setStep(3), 2500);
        return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
    }, [draft_reply]);

    const agents = [
        { name: "ROUTER AGENT", desc: `Intention analysiert: ${intent || "Unbekannt"}`, icon: BrainCircuit },
        { name: "KNOWLEDGE AGENT", desc: "Hotel-Richtlinien & Kontext geladen", icon: Terminal },
        { name: "RESOLUTION AGENT", desc: "Antwort-Logik & Draft erstellt", icon: PenTool },
    ];

    return (
        <div className="flex flex-col gap-8 h-full">
            {/* Agent Pipeline */}
            <div className="flex flex-col gap-4">
                <div className="text-[10px] font-black text-[#C38133] uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
                    <Bot className="w-4 h-4" /> ACTIVE AGENTS
                </div>
                {agents.map((agent, idx) => {
                    const isActive = step === idx;
                    const isDone = step > idx;
                    const Icon = agent.icon;
                    return (
                        <motion.div 
                            key={idx}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: step >= idx ? 1 : 0.3, x: 0 }}
                            className={`flex items-start gap-4 p-4 border transition-all duration-500 ${isActive ? 'bg-white/10 border-white/40 shadow-lg' : 'border-white/10 bg-transparent'}`}
                        >
                            <div className="mt-1">
                                {isDone ? <CheckCircle2 className="w-5 h-5 text-[#C38133]" /> : (isActive ? <CircleDashed className="w-5 h-5 text-white animate-spin" /> : <CircleDashed className="w-5 h-5 text-white/20" />)}
                            </div>
                            <div className="flex flex-col">
                                <span className={`text-[12px] font-bold uppercase tracking-widest ${isActive ? 'text-white' : 'text-white/50'}`}>{agent.name}</span>
                                <span className={`text-[14px] font-serif italic mt-1 transition-all ${isDone || isActive ? 'text-white/80' : 'text-transparent'}`}>{agent.desc}</span>
                            </div>
                        </motion.div>
                    )
                })}
            </div>

            {/* Final Resolution */}
            <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: step >= 3 ? 1 : 0, y: step >= 3 ? 0 : 20 }}
                className="flex-1 flex flex-col mt-2 border-t-2 border-white/20 pt-6 relative min-h-0 overflow-hidden"
            >
                <div className="text-[10px] font-black text-[#C38133] uppercase tracking-[0.2em] mb-4 shrink-0">
                    FINAL RESOLUTION
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar pb-4 pr-2">
                    <div className="text-[15px] lg:text-[17px] font-medium leading-relaxed whitespace-pre-wrap tracking-wide text-white/95 font-serif relative z-10 selection:bg-[#C38133]">
                        {draft_reply || "LÖSUNG WIRD ERSTELLT..."}
                    </div>
                </div>
            </motion.div>
        </div>
    );
}

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
        <div className="relative w-full h-screen overflow-hidden flex bg-[#F2EFE6] text-black tracking-tight selection:bg-[#C38133] selection:text-white font-sans">
            
            <div className="flex-1 flex items-center justify-center p-6 lg:p-12 relative z-40 transition-all duration-700">
                <AnimatePresence mode="wait">
                    {!isMinimized ? (
                        <motion.div 
                            key="expanded-editorial"
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -25 }}
                            className="w-full max-w-screen-2xl h-[90vh] flex bg-white border border-black border-2"
                        >
                            {/* LEFT SIDEBAR: PENDING */}
                            <div className="w-96 border-r-2 border-black flex flex-col bg-[#F2EFE6]">
                                <div className="p-8 flex items-end justify-between border-b-2 border-black bg-white">
                                    <h1 className="text-3xl font-black uppercase tracking-tighter leading-none m-0 p-0">
                                        PETULIA
                                    </h1>
                                    {pendingCount > 0 && (
                                        <div className="text-[12px] font-bold text-[#C38133] uppercase tracking-widest border border-[#C38133] px-3 py-1 rounded-sm">
                                            {pendingCount} PENDING
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 overflow-y-auto custom-scrollbar">
                                    {emails.slice(0, 30).map(email => (
                                        <button 
                                            key={email.id}
                                            onClick={() => setSelectedId(email.id)}
                                            className={`w-full text-left p-6 border-b border-black/10 transition-colors duration-200 ${selectedId === email.id ? "bg-black text-white" : "hover:bg-black/5 bg-transparent"}`}
                                        >
                                            <div className="flex items-center gap-3 mb-2">
                                                <div className={`w-2 h-2 ${email.status === 'processing' ? 'bg-[#C38133]' : 'bg-black/20'}`} />
                                                <span className={`text-[10px] font-bold uppercase tracking-widest ${selectedId === email.id ? "text-white/60" : "text-black/50"}`}>{new Date(email.received_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                                            </div>
                                            <div className="text-[14px] font-bold uppercase truncate mb-1 tracking-tight leading-tight">{email.betreff || "Kein Betreff"}</div>
                                            <div className={`text-[12px] truncate italic tracking-normal ${selectedId === email.id ? "text-white/80" : "text-black/70"}`}>{email.senders?.[0]?.name || email.senders?.[0]?.email}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* MAIN EDITORIAL VIEW */}
                            <div className="flex-1 flex flex-col min-w-0 bg-white">
                                {currentMail ? (
                                    <div className="flex-1 flex flex-col overflow-hidden">
                                        
                                        {/* TOP META BAR */}
                                        <div className="flex items-center justify-between p-6 lg:p-8 border-b-2 border-black bg-[#F2EFE6]">
                                            <div className="flex items-center gap-6">
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] font-bold uppercase tracking-widest text-black/50">HOTEL</span>
                                                    <span className="text-[14px] font-black uppercase tracking-tight text-black">
                                                        {currentMail.agent_logs?.target_hotel || "UNBEKANNT"}
                                                    </span>
                                                </div>
                                                <div className="w-px h-8 bg-black/20" />
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] font-bold uppercase tracking-widest text-black/50">INTENT</span>
                                                    <span className="text-[14px] font-black uppercase tracking-tight text-[#C38133]">
                                                        {currentMail.intent || "ANALYSIERE"}
                                                    </span>
                                                </div>
                                            </div>
                                            <button className="p-3 border-2 border-transparent hover:border-black rounded-sm transition-all text-black hover:bg-[#F2EFE6]" onClick={() => setIsMinimized(true)}>
                                                <Minimize2 className="w-6 h-6" />
                                            </button>
                                        </div>

                                        <div className="flex-1 grid grid-cols-1 lg:grid-cols-5 min-h-0 bg-white">
                                            {/* LEFT COLUMN: ORIGINAL EMAIL */}
                                            <div className="lg:col-span-3 border-r-2 border-black p-6 lg:p-10 flex flex-col overflow-y-auto custom-scrollbar relative">
                                                <div className="absolute top-6 left-8 text-[10px] font-black text-black/30 uppercase tracking-[0.2em]">ORIGINAL</div>
                                                <div className="pt-6">
                                                    <h2 className="text-2xl lg:text-3xl font-black text-black mb-8 uppercase leading-tight tracking-tighter">{currentMail.betreff}</h2>
                                                    {currentMail.body_html ? (
                                                        <div className="prose prose-sm lg:prose-base max-w-none font-sans text-black leading-relaxed" dangerouslySetInnerHTML={{ __html: currentMail.body_html }} />
                                                    ) : (
                                                        <div className="text-base lg:text-lg font-serif text-black/80 leading-relaxed max-w-prose">&quot;{currentMail.body_text}&quot;</div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* RIGHT COLUMN: AI RESPONSE */}
                                            <div className="lg:col-span-2 bg-black text-white p-6 lg:p-10 flex flex-col relative overflow-hidden">
                                                
                                                <div className="flex-1 overflow-hidden min-h-0">
                                                    <AgentWorkflow intent={currentMail.intent} draft_reply={currentMail.draft_reply} />
                                                </div>

                                                {/* ACTION BUTTONS */}
                                                {currentMail.status === "processing" && (
                                                    <div className="flex flex-col gap-4 mt-auto pt-6 border-t border-white/20">
                                                        <button 
                                                            onClick={() => handleAction("completed")} disabled={actionStatus !== "idle"}
                                                            className="w-full py-5 bg-[#C38133] text-white hover:bg-white hover:text-black border-2 border-transparent transition-all text-[16px] font-black uppercase tracking-[0.1em] disabled:opacity-50 flex items-center justify-center gap-4 group"
                                                        >
                                                            FREIGEBEN & ABSENDEN
                                                            <ArrowRight className="w-6 h-6 group-hover:translate-x-2 transition-transform" />
                                                        </button>
                                                        <button 
                                                            onClick={() => handleAction("rejected")} disabled={actionStatus !== "idle"}
                                                            className="w-full py-5 bg-transparent border-2 border-white/30 hover:border-white text-white/70 hover:text-white transition-all text-[14px] font-bold uppercase tracking-[0.1em] disabled:opacity-20 flex items-center justify-center gap-2"
                                                        >
                                                            ABLEHNEN
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex-1 flex flex-col items-center justify-center bg-[#F2EFE6]">
                                        <Layers className="w-16 h-16 text-black/10 animate-pulse" />
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
                                <p className="text-[16px] lg:text-[24px] uppercase font-bold tracking-[0.2em] text-[#C38133] m-0">INBOX SYSTEM</p>
                                <div className="h-1 flex-1 bg-black" />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
            
        </div>
    );
}

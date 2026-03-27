"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { 
    Check, X, Bot, ArrowRight, Zap, Minimize2, Layers
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

                                        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 min-h-0 bg-white">
                                            {/* LEFT COLUMN: ORIGINAL EMAIL */}
                                            <div className="border-r-2 border-black p-8 lg:p-12 flex flex-col overflow-y-auto custom-scrollbar relative">
                                                <div className="absolute top-6 left-12 text-[10px] font-black text-black/30 uppercase tracking-[0.2em]">ORIGINAL</div>
                                                <div className="pt-8">
                                                    <h2 className="text-4xl lg:text-5xl font-black text-black mb-12 uppercase leading-none tracking-tighter">{currentMail.betreff}</h2>
                                                    {currentMail.body_html ? (
                                                        <div className="prose prose-base lg:prose-lg max-w-none font-sans text-black leading-relaxed" dangerouslySetInnerHTML={{ __html: currentMail.body_html }} />
                                                    ) : (
                                                        <div className="text-lg lg:text-xl font-serif text-black/80 leading-relaxed max-w-prose">&quot;{currentMail.body_text}&quot;</div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* RIGHT COLUMN: AI RESPONSE */}
                                            <div className="bg-black text-white p-8 lg:p-12 flex flex-col relative overflow-hidden">
                                                <div className="absolute top-6 left-12 text-[10px] font-black text-[#C38133] uppercase tracking-[0.2em] flex items-center gap-2">
                                                    <Bot className="w-4 h-4" /> LÖSUNG
                                                </div>
                                                
                                                <div className="flex-1 overflow-y-auto custom-scrollbar pt-8 pb-10">
                                                    <div className="text-[18px] lg:text-[20px] font-medium leading-relaxed whitespace-pre-wrap tracking-tight text-white/90 font-serif">
                                                        {currentMail.draft_reply || "ERSTELLE ANTWORT..."}
                                                    </div>
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

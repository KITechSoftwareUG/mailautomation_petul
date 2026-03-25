"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
    Mail, Clock, Bot, Shield, Zap, User, ChevronDown, ChevronUp,
    AlertCircle, CheckCircle2, MessageSquare, FileText, TerminalSquare, RefreshCw, Terminal, XCircle
} from "lucide-react";

type Email = {
    id: string;
    mail_id: string;
    thread_id?: string;
    betreff?: string;
    body_text?: string;
    received_at: string;
    status?: string;
    intent?: string;
    policy_decision_allowed?: boolean | null;
    policy_decision_reason?: string;
    api_action?: string;
    draft_reply?: string;
    agent_logs?: any;
    senders?: { email: string; name?: string }[];
};

export function EmailFeed({ emails }: { emails: Email[] }) {
    const router = useRouter();
    const [lastUpdate, setLastUpdate] = useState(new Date());
    const [spinning, setSpinning] = useState(false);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        const interval = setInterval(() => {
            setSpinning(true);
            router.refresh();
            setLastUpdate(new Date());
            setTimeout(() => setSpinning(false), 600);
        }, 8000);
        return () => clearInterval(interval);
    }, [router]);

    const stats = {
        total: emails.length,
        processing: emails.filter((e) => e.status === "processing").length,
        completed: emails.filter((e) => e.status === "completed").length,
        failed: emails.filter((e) => e.status === "failed").length,
    };

    return (
        <div className="min-h-screen bg-[#f8f9fc] text-slate-900 font-sans">
            {/* Top Nav */}
            <header className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center">
                        <Bot className="w-5 h-5 text-white" />
                    </div>
                    <span className="font-extrabold text-slate-900 text-lg tracking-tight">Petulia’s AI Control</span>
                </div>
                <div className="flex items-center gap-6 flex-1 justify-center">
                    <Link href="/agents" className="flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-indigo-600 transition-colors py-2 px-4 rounded-xl hover:bg-slate-50 border border-transparent hover:border-slate-100">
                        <Terminal className="w-3.5 h-3.5" />
                        KI-Agenten konfigurieren
                    </Link>
                </div>
                <div className="flex items-center gap-4">
                    <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
                        <RefreshCw className={`w-3 h-3 ${spinning ? 'animate-spin text-indigo-500' : 'text-slate-300'}`} />
                        {mounted ? lastUpdate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : "--:--:--"}
                    </span>
                    <div className="flex items-center gap-2 text-xs text-emerald-600 font-semibold bg-emerald-50 border border-emerald-100 px-3 py-1.5 rounded-full">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse inline-block" />
                        Agenten Online
                    </div>
                </div>
            </header>

            <main className="max-w-4xl mx-auto px-4 py-8">
                {/* Stats Row */}
                <div className="grid grid-cols-4 gap-4 mb-8">
                    {[
                        { label: "Gesamt", value: stats.total, color: "text-slate-700", bg: "bg-white" },
                        { label: "In Arbeit", value: stats.processing, color: "text-orange-600", bg: "bg-orange-50" },
                        { label: "Erledigt", value: stats.completed, color: "text-emerald-600", bg: "bg-emerald-50" },
                        { label: "Fehler", value: stats.failed, color: "text-red-500", bg: "bg-red-50" },
                    ].map((s) => (
                        <div key={s.label} className={`${s.bg} rounded-2xl border border-slate-200 p-4 shadow-sm text-center`}>
                            <p className={`text-3xl font-extrabold ${s.color}`}>{s.value}</p>
                            <p className="text-xs text-slate-500 font-semibold mt-1">{s.label}</p>
                        </div>
                    ))}
                </div>

                {/* Mail List */}
                <div className="flex flex-col gap-3">
                    {emails.length === 0 ? (
                        <div className="text-center py-24 border-2 border-dashed border-slate-200 rounded-2xl bg-white">
                            <Mail className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                            <p className="text-slate-400 font-medium">Noch keine E-Mails im System.</p>
                        </div>
                    ) : (
                        emails.map((mail) => <EmailRow key={mail.id} mail={mail} />)
                    )}
                </div>
            </main>
        </div>
    );
}

function EmailRow({ mail }: { mail: Email }) {
    const [expanded, setExpanded] = useState(false);
    const sender = mail.senders?.[0] || { email: "Unbekannt", name: "" };
    const statusInfo = STATUS_MAP[mail.status || "new"] || STATUS_MAP.new;

    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden transition-all hover:border-indigo-200">
            {/* Collapsed Row – always visible */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center gap-4 px-5 py-4 text-left group"
            >
                {/* Status dot */}
                <span className={`flex-shrink-0 w-2.5 h-2.5 rounded-full ${statusInfo.dot}`} />

                {/* Subject + sender */}
                <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900 truncate flex items-center gap-2">
                        {mail.betreff || "(Kein Betreff)"}
                        {mail.agent_logs?.target_hotel && (
                            <span className="bg-amber-100 text-amber-700 text-[9px] font-black uppercase px-2 py-0.5 rounded-full border border-amber-200">
                                {mail.agent_logs.target_hotel}
                            </span>
                        )}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5 truncate">{sender.name || sender.email}</p>
                </div>

                {/* Intent badge (if available) */}
                {mail.intent && (
                    <span className="hidden sm:inline-flex text-[11px] font-bold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100 shrink-0">
                        {mail.intent}
                    </span>
                )}

                {/* Policy badge */}
                {mail.policy_decision_allowed !== null && mail.policy_decision_allowed !== undefined && (
                    <span className={`hidden sm:inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full border shrink-0 ${mail.policy_decision_allowed
                        ? "bg-emerald-50 text-emerald-600 border-emerald-100"
                        : "bg-red-50 text-red-600 border-red-100"
                        }`}>
                        {mail.policy_decision_allowed ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                        {mail.policy_decision_allowed ? "Erlaubt" : "Abgelehnt"}
                    </span>
                )}

                {/* Toggle icon */}
                <span className="text-slate-400 group-hover:text-indigo-500 transition-colors shrink-0">
                    {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </span>
            </button>

            {/* Expanded content */}
            {expanded && (
                <div className="border-t border-slate-100 px-5 pb-6 pt-5 flex flex-col gap-6">
                    {/* Sender Info + Time */}
                    <div className="flex items-center gap-3 bg-slate-50 rounded-xl p-4 border border-slate-100">
                        <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600 flex-shrink-0">
                            <User className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-slate-900">{sender.name || sender.email}</p>
                            <p className="text-xs text-slate-500">
                                Von: <span className="font-medium text-slate-700">{sender.email}</span>
                                <span className="mx-2 text-slate-300">|</span>
                                An: <span className="font-medium text-slate-700 text-indigo-600">{(mail as any).forward_target || (mail as any).empfaenger}</span>
                            </p>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-slate-400">
                            <Clock className="w-3.5 h-3.5" />
                            {new Date(mail.received_at).toLocaleString("de-DE")}
                        </div>
                    </div>

                    {/* Mail Body – optional, collapsed sub-section */}
                    <ToggleSection title="Nachrichteninhalt" icon={<MessageSquare className="w-3.5 h-3.5" />} defaultOpen={false}>
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto italic">
                            {mail.body_text || "(kein Text)"}
                        </div>
                    </ToggleSection>

                    {/* Agent Pipeline Timeline */}
                    <div>
                        <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2">
                            <Zap className="w-3.5 h-3.5" /> KI-Agenten Pipeline
                        </h4>
                        <div className="flex flex-col gap-0">
                            <AgentStep
                                step={1}
                                name="Intent Agent"
                                icon={<Bot className="w-4 h-4" />}
                                active={!!mail.intent}
                                content={mail.intent ? (
                                    <div className="flex flex-wrap gap-2 mt-1">
                                        <span className="bg-indigo-100 text-indigo-700 text-xs font-bold px-2.5 py-1 rounded-full">{mail.intent}</span>
                                        {mail.agent_logs?.intentData?.extracted_entities && Object.entries(mail.agent_logs.intentData.extracted_entities).map(([k, v]) =>
                                            v ? <span key={k} className="bg-slate-100 text-slate-600 text-xs font-medium px-2.5 py-1 rounded-full">{k}: {String(v)}</span> : null
                                        )}
                                    </div>
                                ) : null}
                                emptyText="Absicht noch nicht analysiert."
                            />
                            <AgentStep
                                step={2}
                                name="Policy Agent"
                                icon={<Shield className="w-4 h-4" />}
                                active={mail.policy_decision_allowed !== null && mail.policy_decision_allowed !== undefined}
                                allowed={mail.policy_decision_allowed}
                                content={mail.policy_decision_reason ? (
                                    <p className="text-xs text-slate-600 mt-1 leading-relaxed">{mail.policy_decision_reason}</p>
                                ) : null}
                                emptyText="Hausregeln noch nicht geprüft."
                            />
                            <AgentStep
                                step={3}
                                name="Petulia (Loop & Action)"
                                icon={<Bot className="w-4 h-4 text-violet-500" />}
                                active={!!mail.api_action}
                                isLast
                                content={mail.api_action ? (
                                    <div className="flex flex-col gap-4 mt-3">
                                        <div className="flex items-center gap-2">
                                            <span className="bg-violet-100 text-violet-700 text-[11px] font-black px-3 py-1 rounded-full border border-violet-200 shadow-sm uppercase tracking-wider">
                                                Aktion: {mail.api_action}
                                            </span>
                                        </div>

                                        <div className="space-y-4 relative before:absolute before:inset-0 before:ml-3 before:-translate-x-px before:h-full before:w-0.5 before:bg-slate-200 mt-4">
                                            {(mail.agent_logs?.loop_history || [
                                                {
                                                    attempt: 1,
                                                    thought: mail.agent_logs?.actionData?.reflexion_loop_gedanken || [],
                                                    action: mail.api_action,
                                                    mutation: mail.agent_logs?.actionData?.graphql_mutation,
                                                    variables: mail.agent_logs?.actionData?.graphql_variables,
                                                    success: true
                                                }
                                            ]).map((loop: any, lIdx: number) => (
                                                <div key={lIdx} className="relative pl-8">
                                                    <div className={`absolute left-0 w-6 h-6 rounded-full border-4 border-white shadow-sm flex items-center justify-center -translate-x-1/2 ${loop.success ? 'bg-emerald-500' : 'bg-rose-500'}`}>
                                                        {loop.success ? <CheckCircle2 className="w-3 h-3 text-white" /> : <AlertCircle className="w-3 h-3 text-white" />}
                                                    </div>

                                                    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                                                        <div className="flex items-center justify-between mb-3 text-[10px] font-black uppercase tracking-widest leading-none">
                                                            <span>Versuch #{loop.attempt}</span>
                                                            {loop.success ? (
                                                                <span className="text-emerald-600 ml-2">✓ OK</span>
                                                            ) : (
                                                                <span className="text-rose-600 ml-2">✗ FEHLER KORRIGIERT</span>
                                                            )}
                                                        </div>

                                                        {loop.thought?.length > 0 && (
                                                            <div className="mb-3">
                                                                <ul className="text-xs text-slate-600 list-disc pl-4 space-y-0.5 italic">
                                                                    {loop.thought.map((t: string, ti: number) => <li key={ti}>{t}</li>)}
                                                                </ul>
                                                            </div>
                                                        )}

                                                        {loop.mutation && (
                                                            <div className="bg-slate-900 rounded-xl overflow-hidden border border-slate-800 mt-2">
                                                                <div className="px-3 py-1.5 bg-slate-800 flex items-center justify-between">
                                                                    <span className="text-[9px] font-mono text-emerald-400">{loop.action}()</span>
                                                                </div>
                                                                <div className="p-3">
                                                                    {loop.error && (
                                                                        <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-2 mb-2 text-[10px] text-rose-400 font-mono">
                                                                            ERR: {loop.error}
                                                                        </div>
                                                                    )}
                                                                    <pre className="text-[9px] text-slate-400 font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-32">
                                                                        {loop.mutation}
                                                                    </pre>
                                                                    {loop.variables && (
                                                                        <div className="mt-2 pt-2 border-t border-slate-800 text-[9px]">
                                                                            <p className="text-slate-500 uppercase font-black mb-1">Vars:</p>
                                                                            <pre className="text-amber-500 font-mono italic">
                                                                                {typeof loop.variables === 'string' ? loop.variables : JSON.stringify(loop.variables, null, 2)}
                                                                            </pre>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : null}
                                emptyText="Aktion noch nicht bestimmt."
                            />
                        </div>
                    </div>

                    {/* Draft Reply */}
                    {mail.draft_reply && (
                        <ToggleSection title="Petulias Antwort-Entwurf" icon={<FileText className="w-3.5 h-3.5" />} defaultOpen color="indigo">
                            <div className="bg-indigo-50/60 p-4 rounded-xl border border-indigo-100 text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
                                {mail.draft_reply}
                            </div>
                        </ToggleSection>
                    )}

                    {/* Raw Logs */}
                    {mail.agent_logs && (
                        <ToggleSection title="Rohe Agent-Logs (JSON)" icon={<TerminalSquare className="w-3.5 h-3.5" />} defaultOpen={false}>
                            <div className="bg-slate-900 p-4 rounded-xl text-[10px] font-mono text-emerald-400 overflow-x-auto max-h-64">
                                <pre>{JSON.stringify(mail.agent_logs, null, 2)}</pre>
                            </div>
                        </ToggleSection>
                    )}
                </div>
            )
            }
        </div >
    );
}

// Reusable collapsible section within expanded card
function ToggleSection({
    title, icon, children, defaultOpen = true, color = "slate"
}: {
    title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; color?: "slate" | "indigo";
}) {
    const [open, setOpen] = useState(defaultOpen);
    const titleColor = color === "indigo" ? "text-indigo-600" : "text-slate-500";

    return (
        <div>
            <button
                onClick={() => setOpen(!open)}
                className={`w-full flex items-center gap-2 text-[11px] font-black uppercase tracking-widest ${titleColor} mb-2 hover:opacity-70 transition-opacity`}
            >
                {icon}
                {title}
                <span className="ml-auto">{open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}</span>
            </button>
            {open && children}
        </div>
    );
}

// Pipeline step with connecting line
function AgentStep({
    step, name, icon, active, isLast = false, content, emptyText, allowed
}: {
    step: number; name: string; icon: React.ReactNode;
    active: boolean; isLast?: boolean; content?: React.ReactNode;
    emptyText: string; allowed?: boolean | null;
}) {
    const dotColor = active
        ? (allowed === false ? "bg-red-500 border-red-200" : "bg-emerald-500 border-emerald-200")
        : "bg-slate-200 border-slate-100";

    const textColor = active ? "text-slate-900" : "text-slate-400";

    return (
        <div className="flex gap-4">
            {/* Line + dot */}
            <div className="flex flex-col items-center">
                <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-white font-bold text-[10px] flex-shrink-0 transition-colors ${dotColor}`}>
                    {active ? (allowed === false ? "✗" : "✓") : step}
                </div>
                {!isLast && <div className="w-px flex-1 bg-slate-200 my-1 min-h-[16px]" />}
            </div>

            {/* Content */}
            <div className={`flex-1 pb-4 ${isLast ? "" : ""}`}>
                <div className="flex items-center gap-2">
                    <span className={`${active ? "text-slate-700" : "text-slate-300"} transition-colors`}>{icon}</span>
                    <span className={`text-xs font-bold uppercase tracking-widest ${textColor}`}>{name}</span>
                </div>
                {active && content ? content : (
                    !active && <p className="text-xs text-slate-300 mt-1 italic">{emptyText}</p>
                )}
            </div>
        </div>
    );
}

const STATUS_MAP: Record<string, { dot: string }> = {
    new: { dot: "bg-blue-400" },
    processing: { dot: "bg-orange-400 animate-pulse" },
    completed: { dot: "bg-emerald-500" },
    failed: { dot: "bg-red-500" },
    ignored: { dot: "bg-slate-300" },
};

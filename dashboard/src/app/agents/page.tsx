'use client';

import { useState, useEffect } from 'react';
import { Bot, Save, ChevronLeft, Terminal, FileText, CheckCircle2, Zap } from 'lucide-react';
import Link from 'next/link';
import { getPrompts, savePrompt } from './actions';

export default function AgentConfigPage() {
    const [prompts, setPrompts] = useState<{ name: string, content: string }[]>([]);
    const [selected, setSelected] = useState<number>(0);
    const [editContent, setEditContent] = useState('');
    const [saving, setSaving] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);

    useEffect(() => {
        getPrompts().then(data => {
            setPrompts(data);
            if (data.length > 0) {
                setEditContent(data[0].content);
            }
        });
    }, []);

    const handleSelect = (idx: number) => {
        setSelected(idx);
        setEditContent(prompts[idx].content);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await savePrompt(prompts[selected].name, editContent);
            const newPrompts = [...prompts];
            newPrompts[selected].content = editContent;
            setPrompts(newPrompts);

            setShowSuccess(true);
            setTimeout(() => setShowSuccess(false), 3000);
        } catch (err) {
            alert('Fehler beim Speichern');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#f8f9fc] text-slate-900 font-sans p-6">
            <div className="max-w-6xl mx-auto">
                <header className="mb-8 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-2 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200 group text-slate-500">
                            <ChevronLeft className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform" />
                        </Link>
                        <div>
                            <h1 className="text-2xl font-black tracking-tight flex items-center gap-2 text-slate-900">
                                <Bot className="w-7 h-7 text-indigo-600" />
                                Petulias Fähigkeiten
                            </h1>
                            <p className="text-sm text-slate-500 mt-0.5">Prompt Engineering & Verhaltensregeln der KI-Assistentin Petulia</p>
                        </div>
                    </div>
                    {showSuccess && (
                        <div className="flex items-center gap-2 bg-emerald-50 text-emerald-600 px-4 py-2 rounded-xl border border-emerald-100 animate-in fade-in slide-in-from-top-4">
                            <CheckCircle2 className="w-4 h-4" />
                            <span className="text-sm font-bold">Änderungen gespeichert!</span>
                        </div>
                    )}
                </header>

                <div className="grid grid-cols-12 gap-6 h-[calc(100vh-180px)]">
                    {/* Sidebar: Agent List */}
                    <div className="col-span-2 flex flex-col gap-2 overflow-y-auto">
                        {prompts.map((p, idx) => (
                            <button
                                key={p.name}
                                onClick={() => handleSelect(idx)}
                                className={`w-full p-4 text-left rounded-2xl border transition-all duration-200 flex flex-col gap-1 ${selected === idx
                                    ? 'bg-white border-indigo-200 shadow-sm ring-1 ring-indigo-100'
                                    : 'bg-white/50 border-slate-200 hover:bg-white hover:border-slate-300'
                                    }`}
                            >
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Step {idx + 1}</span>
                                    <Bot className={`w-3.5 h-3.5 ${selected === idx ? 'text-indigo-500' : 'text-slate-300'}`} />
                                </div>
                                <span className={`font-bold text-[13px] ${selected === idx ? 'text-indigo-600' : 'text-slate-700'}`}>
                                    {p.name.replace('.md', '').split('_')[1].toUpperCase()}
                                </span>
                            </button>
                        ))}

                        <div className="mt-auto bg-slate-100/50 rounded-2xl p-5 border border-slate-200/50 italic text-[10px] text-slate-500 leading-relaxed flex flex-col gap-2">
                            <Terminal className="w-4 h-4 text-slate-400" />
                            <span>Änderungen sind sofort aktiv (Hot-Reloading).</span>
                        </div>
                    </div>

                    {/* Editor */}
                    <div className={`${prompts[selected]?.name.includes('action') ? 'col-span-7' : 'col-span-10'} bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden flex flex-col`}>
                        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-white sticky top-0 z-10 shadow-sm">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                                    <FileText className="w-4 h-4 text-indigo-600" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-black uppercase tracking-wider text-slate-800">Prompt-Anweisungen</h3>
                                    <p className="text-[11px] text-slate-400 italic">Bearbeite die System-Fähigkeiten von Petulia</p>
                                </div>
                            </div>
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="flex items-center gap-2 bg-slate-900 hover:bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all hover:shadow-lg disabled:opacity-50"
                            >
                                <Save className="w-4 h-4" />
                                {saving ? 'Speichert...' : 'Fähigkeiten Aktualisieren'}
                            </button>
                        </div>
                        <div className="flex-1 p-0 relative">
                            <textarea
                                value={editContent}
                                onChange={(e) => setEditContent(e.target.value)}
                                className="w-full h-full p-8 font-mono text-sm text-slate-700 bg-slate-50/50 focus:outline-none resize-none leading-relaxed"
                                spellCheck={false}
                                placeholder="Schreibe Petulias Anweisungen hier..."
                            />
                        </div>
                    </div>

                    {/* API Reference Sidebar (only for Action Agent) */}
                    {prompts[selected]?.name.includes('action') && (
                        <div className="col-span-3 overflow-y-auto pr-2 space-y-4">
                            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest px-2 flex items-center gap-2">
                                <Zap className="w-3 h-3 text-amber-500" /> 3RPMS API Referenz
                            </h4>

                            <div className="space-y-6">
                                {[
                                    {
                                        title: "Mutationen (Aktionen)",
                                        color: "indigo",
                                        items: [
                                            { name: "updateRoomStay", desc: "Check-in/out Zeiten ändern." },
                                            { name: "createExternalSale", desc: "Zusatzleistungen buchen (Hund, Frühstück, Parken)." },
                                            { name: "updateReservation", desc: "Status ändern (Aktiv, Storno)." },
                                            { name: "createRoomAccessKey", desc: "Türcodes/QR-Codes generieren." },
                                            { name: "addRoomStayGuest", desc: "Mitreisende hinzufügen." }
                                        ]
                                    },
                                    {
                                        title: "Queries (Daten)",
                                        color: "emerald",
                                        items: [
                                            { name: "room_stays", desc: "Zimmer & Gäste Details abrufen." },
                                            { name: "reservations", desc: "Nach Buchungsnummer/Name suchen." },
                                            { name: "inventory", desc: "Verfügbarkeiten prüfen." }
                                        ]
                                    }
                                ].map((cat, ci) => (
                                    <div key={ci} className="flex flex-col gap-2 pb-2 border-b border-slate-200">
                                        <h5 className={`text-[11px] font-bold text-${cat.color}-600 px-2 uppercase`}>{cat.title}</h5>
                                        {cat.items.map((item, ii) => (
                                            <div key={ii} className="bg-white border border-slate-200 p-3 rounded-2xl shadow-sm hover:border-indigo-300 transition-colors group">
                                                <code className="text-xs font-bold text-slate-900 group-hover:text-indigo-600 block mb-1">
                                                    {item.name}()
                                                </code>
                                                <p className="text-[10px] text-slate-400 leading-tight">
                                                    {item.desc}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                ))}

                                <div className="p-3 bg-amber-50 rounded-2xl border border-amber-100 italic text-[10px] text-amber-700 leading-relaxed shadow-inner">
                                    <p>Tipp: Nutze diese Namen in deinen Anweisungen, damit Petulia weiß, welche Mutation sie generieren soll.</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

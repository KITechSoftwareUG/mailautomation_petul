"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, Check, Loader2 } from "lucide-react";
import { fetchSignatures, saveSignature } from "./actions";

type SignatureRow = {
    id: string;
    hotel_id: string;
    hotel_name: string;
    signature: string;
};

export default function SettingsPage() {
    const router = useRouter();
    const [rows, setRows] = useState<SignatureRow[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [draft, setDraft] = useState("");
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchSignatures().then((data) => {
            if (data) {
                setRows(data);
                setSelectedId(data[0]?.id ?? null);
                setDraft(data[0]?.signature ?? "");
            }
            setLoading(false);
        });
    }, []);

    const currentRow = rows.find((r) => r.id === selectedId);

    const handleSelect = (row: SignatureRow) => {
        setSelectedId(row.id);
        setDraft(row.signature);
        setSaved(false);
    };

    const handleSave = async () => {
        if (!currentRow) return;
        setSaving(true);
        await saveSignature(currentRow.id, draft);
        setRows((prev) => prev.map((r) => (r.id === currentRow.id ? { ...r, signature: draft } : r)));
        setSaving(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    return (
        <div className="w-full h-screen flex bg-white text-black tracking-tight font-sans">
            {/* Sidebar: Hotel-Liste */}
            <div className="w-64 shrink-0 border-r border-black/10 flex flex-col bg-[#444444] text-white">
                <div className="px-5 pt-5 pb-4">
                    <button
                        onClick={() => router.push("/")}
                        className="flex items-center gap-1.5 text-white/50 hover:text-white text-[10px] font-black uppercase tracking-widest transition-colors mb-4"
                    >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        Zurück
                    </button>
                    <h1 className="text-[14px] font-black uppercase tracking-widest">Einstellungen</h1>
                    <p className="text-[10px] text-white/40 mt-1">E-Mail-Signaturen</p>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-3">
                    {rows.map((row) => (
                        <button
                            key={row.id}
                            onClick={() => handleSelect(row)}
                            className={`w-full text-left px-3 py-2.5 mb-0.5 transition-all duration-150 border-l-2 ${
                                selectedId === row.id
                                    ? "bg-white/10 border-[#6082B6] text-white"
                                    : "hover:bg-white/5 border-transparent text-white/45"
                            }`}
                        >
                            <div className="text-[11px] font-bold leading-snug">{row.hotel_name}</div>
                            <div className="text-[9px] uppercase tracking-widest opacity-30 mt-0.5">{row.hotel_id}</div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Editor */}
            <div className="flex-1 flex flex-col min-w-0">
                {loading ? (
                    <div className="flex-1 flex items-center justify-center text-black/20">
                        <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                ) : currentRow ? (
                    <>
                        <div className="shrink-0 px-8 py-4 border-b border-black/8 flex items-center justify-between">
                            <div>
                                <div className="text-[9px] font-black uppercase tracking-widest text-black/25 mb-1">
                                    Signatur bearbeiten
                                </div>
                                <h2 className="text-[16px] font-bold">{currentRow.hotel_name}</h2>
                            </div>
                            <button
                                onClick={handleSave}
                                disabled={saving || draft === currentRow.signature}
                                className="flex items-center gap-2 px-4 py-2 bg-[#6082B6] text-white hover:bg-[#444444] text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-30"
                            >
                                {saving ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : saved ? (
                                    <Check className="w-3.5 h-3.5" />
                                ) : (
                                    <Save className="w-3.5 h-3.5" />
                                )}
                                {saving ? "Speichert..." : saved ? "Gespeichert" : "Speichern"}
                            </button>
                        </div>
                        <div className="flex-1 p-8 overflow-y-auto custom-scrollbar">
                            <p className="text-[11px] text-black/40 mb-4 leading-relaxed max-w-2xl">
                                Diese Signatur wird automatisch an jede gesendete Antwort-Mail dieses Hotels
                                angehängt. Der Gast sieht sie erst in der tatsächlich versendeten E-Mail — im
                                Entwurf zur Freigabe taucht sie nicht auf.
                            </p>
                            <textarea
                                value={draft}
                                onChange={(e) => {
                                    setDraft(e.target.value);
                                    setSaved(false);
                                }}
                                className="w-full h-[60vh] max-w-2xl p-5 border border-black/10 font-mono text-[13px] leading-relaxed resize-none outline-none focus:border-[#6082B6] custom-scrollbar"
                                spellCheck={false}
                                placeholder="Signaturtext eingeben..."
                            />
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center text-black/20 text-[11px] uppercase tracking-widest text-center px-8">
                        Keine Signaturen gefunden — wurde die Migration
                        supabase_migration_signatures.sql schon ausgeführt?
                    </div>
                )}
            </div>
        </div>
    );
}

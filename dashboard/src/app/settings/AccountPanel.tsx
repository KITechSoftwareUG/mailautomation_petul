"use client";

import { useState, FormEvent } from "react";
import { Check, Loader2, KeyRound, AlertTriangle } from "lucide-react";
import { changePassword } from "../auth/actions";

const MIN_LENGTH = 10;

export function AccountPanel() {
    const [current, setCurrent] = useState("");
    const [next, setNext] = useState("");
    const [confirm, setConfirm] = useState("");
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const canSubmit = current.length > 0 && next.length >= MIN_LENGTH && confirm.length > 0 && !saving;

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;

        setSaving(true);
        setError(null);
        setSaved(false);

        const result = await changePassword(current, next, confirm);

        setSaving(false);

        if (!result.ok) {
            setError(result.error ?? "Das Passwort konnte nicht geändert werden.");
            return;
        }

        setCurrent("");
        setNext("");
        setConfirm("");
        setSaved(true);
        setTimeout(() => setSaved(false), 4000);
    };

    const inputClass =
        "w-full border-2 border-black/10 px-4 py-3 text-sm font-medium outline-none transition-all tracking-wide focus:border-[#6082B6]";

    return (
        <>
            <div className="shrink-0 px-8 py-4 border-b border-black/8">
                <div className="text-[9px] font-black uppercase tracking-widest text-black/25 mb-1">
                    Zugang zum Dashboard
                </div>
                <h2 className="text-[16px] font-bold">Passwort ändern</h2>
            </div>

            <div className="flex-1 p-8 overflow-y-auto custom-scrollbar">
                <p className="text-[11px] text-black/40 mb-6 leading-relaxed max-w-2xl">
                    Alle Mitarbeiterinnen melden sich mit demselben Passwort an. Nach einer Änderung werden{" "}
                    <strong className="text-black/60">alle offenen Sitzungen abgemeldet</strong> — auf jedem Rechner
                    muss man sich also einmal neu anmelden. Dieses Gerät hier bleibt eingeloggt.
                </p>

                <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-w-md">
                    <label className="flex flex-col gap-1.5">
                        <span className="text-[9px] font-black uppercase tracking-widest text-black/35">
                            Aktuelles Passwort
                        </span>
                        <input
                            type="password"
                            value={current}
                            onChange={(e) => {
                                setCurrent(e.target.value);
                                setError(null);
                            }}
                            autoComplete="current-password"
                            className={inputClass}
                        />
                    </label>

                    <label className="flex flex-col gap-1.5">
                        <span className="text-[9px] font-black uppercase tracking-widest text-black/35">
                            Neues Passwort
                        </span>
                        <input
                            type="password"
                            value={next}
                            onChange={(e) => {
                                setNext(e.target.value);
                                setError(null);
                            }}
                            autoComplete="new-password"
                            className={inputClass}
                        />
                        <span className="text-[10px] text-black/30">Mindestens {MIN_LENGTH} Zeichen.</span>
                    </label>

                    <label className="flex flex-col gap-1.5">
                        <span className="text-[9px] font-black uppercase tracking-widest text-black/35">
                            Neues Passwort wiederholen
                        </span>
                        <input
                            type="password"
                            value={confirm}
                            onChange={(e) => {
                                setConfirm(e.target.value);
                                setError(null);
                            }}
                            autoComplete="new-password"
                            className={inputClass}
                        />
                    </label>

                    {error && (
                        <div className="flex items-start gap-2 border-l-2 border-[#E2001A] bg-red-50 px-3 py-2.5">
                            <AlertTriangle className="w-3.5 h-3.5 text-[#E2001A] shrink-0 mt-0.5" />
                            <p className="text-[11px] font-medium text-[#E2001A] leading-relaxed">{error}</p>
                        </div>
                    )}

                    {saved && (
                        <div className="flex items-start gap-2 border-l-2 border-[#009697] bg-teal-50 px-3 py-2.5">
                            <Check className="w-3.5 h-3.5 text-[#009697] shrink-0 mt-0.5" />
                            <p className="text-[11px] font-medium text-[#009697] leading-relaxed">
                                Passwort geändert. Alle anderen Geräte müssen sich neu anmelden.
                            </p>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={!canSubmit}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-[#6082B6] text-white hover:bg-[#444444] text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-30 mt-1"
                    >
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                        {saving ? "Speichert..." : "Passwort ändern"}
                    </button>
                </form>
            </div>
        </>
    );
}

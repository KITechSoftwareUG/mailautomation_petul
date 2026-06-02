"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
    const router = useRouter();
    const [password, setPassword] = useState("");
    const [error, setError] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(false);

        const res = await fetch("/api/auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password }),
        });

        if (res.ok) {
            router.push("/");
            router.refresh();
        } else {
            setError(true);
            setPassword("");
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#F9F9F9] flex items-center justify-center font-sans">
            <div className="w-full max-w-sm">
                {/* Logo */}
                <div className="text-center mb-10">
                    <h1 className="text-4xl font-serif tracking-widest text-[#444444] uppercase leading-none">
                        APART HOTELS
                    </h1>
                    <span
                        className="text-3xl font-light italic lowercase text-[#444444] opacity-70"
                        style={{ fontFamily: "serif" }}
                    >
                        petul
                    </span>
                    <div className="flex h-0.5 w-full mt-4">
                        <div className="flex-1 bg-[#E2001A]" />
                        <div className="flex-1 bg-[#F39200]" />
                        <div className="flex-1 bg-[#009697]" />
                        <div className="flex-1 bg-[#6082B6]" />
                    </div>
                </div>

                {/* Card */}
                <div className="bg-white border border-black/10 shadow-[8px_8px_0px_0px_rgba(0,0,0,0.06)] p-8">
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-black/30 mb-6 text-center">
                        Petulia — Interner Zugang
                    </p>

                    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Passwort"
                            autoFocus
                            required
                            className={`w-full border-2 px-4 py-3 text-sm font-medium outline-none transition-all tracking-wide
                                ${error
                                    ? "border-[#E2001A] bg-red-50 placeholder-[#E2001A]/50"
                                    : "border-black/10 focus:border-[#6082B6]"
                                }`}
                        />

                        {error && (
                            <p className="text-[11px] font-bold text-[#E2001A] uppercase tracking-widest text-center">
                                Falsches Passwort
                            </p>
                        )}

                        <button
                            type="submit"
                            disabled={loading || !password}
                            className="w-full bg-[#444444] text-white py-3 text-[11px] font-black uppercase tracking-[0.3em] hover:bg-[#6082B6] transition-colors disabled:opacity-40"
                        >
                            {loading ? "..." : "Einloggen"}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}

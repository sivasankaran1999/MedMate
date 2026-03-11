"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LiveSession,
  type LiveSessionCallbacks,
  type SessionStatus,
  type VoiceState,
} from "@/lib/liveSession";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8080";
const AUTH_KEY = "medmate_elder_id";
const AUTH_DISPLAY_NAME_KEY = "medmate_display_name";

function statusLabel(s: SessionStatus): string {
  switch (s) {
    case "disconnected":
      return "Disconnected";
    case "connecting":
      return "Connecting…";
    case "connected":
      return "Connected";
    case "error":
      return "Connection error";
    default:
      return "Unknown";
  }
}

function voiceLabel(v: VoiceState): string {
  switch (v) {
    case "listening":
      return "Listening…";
    case "speaking":
      return "Speaking…";
    default:
      return "Ready";
  }
}

function StatusPill({
  status,
  voiceState,
}: {
  status: SessionStatus;
  voiceState: VoiceState;
}) {
  const isLive = status === "connected";
  const isError = status === "error";
  const isConnecting = status === "connecting";
  const isListening = voiceState === "listening";
  const isSpeaking = voiceState === "speaking";

  const dotColor = isError
    ? "bg-red-500"
    : isListening
      ? "bg-amber-400 animate-pulse-soft"
      : isSpeaking
        ? "bg-cyan-400 animate-pulse-soft"
        : isLive
          ? "bg-emerald-400"
          : isConnecting
            ? "bg-cyan-400 animate-pulse-soft"
            : "bg-zinc-500";

  return (
    <div className="inline-flex items-center gap-2 rounded-full bg-white/5 border border-white/10 px-4 py-2 backdrop-blur-sm">
      <span className={`h-2 w-2 rounded-full ${dotColor}`} />
      <span className="text-sm font-medium text-zinc-300">
        {statusLabel(status)}
        {voiceState !== "idle" && (
          <span className="text-zinc-500"> · {voiceLabel(voiceState)}</span>
        )}
      </span>
    </div>
  );
}

const httpBase = BACKEND_URL.startsWith("http") ? BACKEND_URL : BACKEND_URL.replace(/^ws/, "http");

type MedEntry = { name: string; strength?: string; quantity?: number };
type Schedule = {
  morning: MedEntry[];
  afternoon: MedEntry[];
  night: MedEntry[];
  timeWindows?: Record<string, { start: string; end: string }>;
};

const SLOTS = ["morning", "afternoon", "night"] as const;
const DEFAULT_TIME_WINDOWS: Record<string, { start: string; end: string }> = {
  morning: { start: "10:00", end: "12:00" },
  afternoon: { start: "14:00", end: "16:00" },
  night: { start: "20:00", end: "23:00" },
};
function time24To12(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = parseInt(hStr ?? "0", 10);
  const m = mStr ?? "00";
  if (h === 0) return `12:${m} AM`;
  if (h === 12) return `12:${m} PM`;
  if (h < 12) return `${h}:${m} AM`;
  return `${h - 12}:${m} PM`;
}
function slotLabel(slot: string, timeWindows?: Record<string, { start: string; end: string }>): string {
  const tw = timeWindows?.[slot] || DEFAULT_TIME_WINDOWS[slot];
  const name = slot.charAt(0).toUpperCase() + slot.slice(1);
  if (!tw) return name;
  return `${name} (${time24To12(tw.start)} – ${time24To12(tw.end)})`;
}

export default function Home() {
  const [elderId, setElderId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [status, setStatus] = useState<SessionStatus>("disconnected");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [cameraOpening, setCameraOpening] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [liveVideoActive, setLiveVideoActive] = useState(false);
  const [session, setSession] = useState<LiveSession | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [showSignUp, setShowSignUp] = useState(false);
  const [registerDisplayName, setRegisterDisplayName] = useState("");
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [registerTimeWindows, setRegisterTimeWindows] = useState<Record<string, { start: string; end: string }>>({
    ...DEFAULT_TIME_WINDOWS,
  });
  const [registerEmergencyName, setRegisterEmergencyName] = useState("");
  const [registerEmergencyEmail, setRegisterEmergencyEmail] = useState("");
  const [registerPharmacistName, setRegisterPharmacistName] = useState("");
  const [registerPharmacistEmail, setRegisterPharmacistEmail] = useState("");
  const [registerPharmacistPhone, setRegisterPharmacistPhone] = useState("");

  const [confirmDoseSlot, setConfirmDoseSlot] = useState<"morning" | "afternoon" | "night">("morning");
  const [confirmDoseLoading, setConfirmDoseLoading] = useState(false);
  const [confirmDoseMessage, setConfirmDoseMessage] = useState<string | null>(null);

  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleSaved, setScheduleSaved] = useState(false);

  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyEmail, setEmergencyEmail] = useState("");
  const [pharmacistName, setPharmacistName] = useState("");
  const [pharmacistEmail, setPharmacistEmail] = useState("");
  const [pharmacistPhone, setPharmacistPhone] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [contactsSaving, setContactsSaving] = useState(false);
  const [contactsSaved, setContactsSaved] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = sessionStorage.getItem(AUTH_KEY);
    const name = sessionStorage.getItem(AUTH_DISPLAY_NAME_KEY);
    if (id) {
      setElderId(id);
      setDisplayName(name || "User");
    }
  }, []);

  useEffect(() => {
    if (!elderId) return;
    setScheduleLoading(true);
    setScheduleError(null);
    fetch(`${httpBase}/elders/${encodeURIComponent(elderId)}/schedule`)
      .then((res) => {
        if (!res.ok) throw new Error("Could not load schedule");
        return res.json();
      })
      .then((data: Schedule) => {
        setSchedule({
          morning: data.morning ?? [],
          afternoon: data.afternoon ?? [],
          night: data.night ?? [],
          timeWindows: data.timeWindows
            ? { ...DEFAULT_TIME_WINDOWS, ...data.timeWindows }
            : DEFAULT_TIME_WINDOWS,
        });
      })
      .catch((err) => setScheduleError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setScheduleLoading(false));
  }, [elderId]);

  useEffect(() => {
    if (!elderId) return;
    setProfileLoading(true);
    fetch(`${httpBase}/elders/${encodeURIComponent(elderId)}/profile`)
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data: { emergencyContact?: { name?: string; email?: string }; pharmacistContact?: { name?: string; email?: string; phone?: string } } | null) => {
        if (data?.emergencyContact) {
          setEmergencyName((data.emergencyContact as { name?: string }).name ?? "");
          setEmergencyEmail((data.emergencyContact as { email?: string }).email ?? "");
        }
        if (data?.pharmacistContact) {
          const pc = data.pharmacistContact as { name?: string; email?: string; phone?: string };
          setPharmacistName(pc.name ?? "");
          setPharmacistEmail(pc.email ?? "");
          setPharmacistPhone(pc.phone ?? "");
        }
      })
      .finally(() => setProfileLoading(false));
  }, [elderId]);

  const saveContacts = useCallback(async () => {
    if (!elderId) return;
    setContactsError(null);
    setContactsSaving(true);
    setContactsSaved(false);
    try {
      const res = await fetch(`${httpBase}/elders/${encodeURIComponent(elderId)}/contacts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emergency_contact_name: emergencyName.trim() || undefined,
          emergency_contact_email: emergencyEmail.trim() || undefined,
          pharmacist_name: pharmacistName.trim() || undefined,
          pharmacist_email: pharmacistEmail.trim() || undefined,
          pharmacist_phone: pharmacistPhone.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { detail?: string }).detail || "Failed to save");
      }
      setContactsSaved(true);
    } catch (e) {
      setContactsError(e instanceof Error ? e.message : "Failed to save contacts");
    } finally {
      setContactsSaving(false);
    }
  }, [elderId, emergencyName, emergencyEmail, pharmacistName, pharmacistEmail, pharmacistPhone]);

  const handleLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoginLoading(true);
    try {
      const res = await fetch(`${httpBase}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || res.statusText || "Login failed");
      }
      const data = await res.json();
      const id = data.elder_id;
      const name = data.display_name || loginEmail.split("@")[0];
      if (!id) throw new Error("No elder_id returned");
      sessionStorage.setItem(AUTH_KEY, id);
      sessionStorage.setItem(AUTH_DISPLAY_NAME_KEY, name);
      setElderId(id);
      setDisplayName(name);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoginLoading(false);
    }
  }, [loginEmail, loginPassword]);

  const handleRegister = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setRegisterError(null);
    setRegisterLoading(true);
    try {
      const res = await fetch(`${httpBase}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: loginEmail.trim(),
          password: loginPassword,
          display_name: registerDisplayName.trim() || undefined,
          time_windows: registerTimeWindows,
          emergency_contact_name: registerEmergencyName.trim() || undefined,
          emergency_contact_email: registerEmergencyEmail.trim() || undefined,
          pharmacist_name: registerPharmacistName.trim() || undefined,
          pharmacist_email: registerPharmacistEmail.trim() || undefined,
          pharmacist_phone: registerPharmacistPhone.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || res.statusText || "Registration failed");
      }
      const data = await res.json();
      const id = data.elder_id;
      const name = data.display_name || loginEmail.split("@")[0];
      if (!id) throw new Error("No elder_id returned");
      sessionStorage.setItem(AUTH_KEY, id);
      sessionStorage.setItem(AUTH_DISPLAY_NAME_KEY, name);
      setElderId(id);
      setDisplayName(name);
    } catch (err) {
      setRegisterError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setRegisterLoading(false);
    }
  }, [
    loginEmail,
    loginPassword,
    registerDisplayName,
    registerTimeWindows,
    registerEmergencyName,
    registerEmergencyEmail,
    registerPharmacistName,
    registerPharmacistEmail,
    registerPharmacistPhone,
  ]);

  const handleLogout = useCallback(() => {
    session?.disconnect();
    setSession(null);
    sessionStorage.removeItem(AUTH_KEY);
    sessionStorage.removeItem(AUTH_DISPLAY_NAME_KEY);
    setElderId(null);
    setDisplayName(null);
    setError(null);
  }, [session]);

  const addMed = useCallback((slot: keyof Schedule) => {
    if (slot === "timeWindows") return;
    setSchedule((s) => {
      if (!s) return s;
      return { ...s, [slot]: [...s[slot], { name: "", strength: "", quantity: 1 }] };
    });
    setScheduleSaved(false);
  }, []);

  const removeMed = useCallback((slot: keyof Schedule, index: number) => {
    if (slot === "timeWindows") return;
    setSchedule((s) => {
      if (!s) return s;
      const list = [...s[slot]];
      list.splice(index, 1);
      return { ...s, [slot]: list };
    });
    setScheduleSaved(false);
  }, []);

  const updateMed = useCallback(
    (slot: keyof Schedule, index: number, field: "name" | "strength" | "quantity", value: string | number) => {
      if (slot === "timeWindows") return;
      setSchedule((s) => {
        if (!s) return s;
        const list = s[slot].map((m, i) =>
          i === index ? { ...m, [field]: field === "quantity" ? (typeof value === "number" ? value : Math.max(1, parseInt(String(value), 10) || 1)) : value } : m
        );
        return { ...s, [slot]: list };
      });
      setScheduleSaved(false);
    },
    []
  );

  const updateTimeWindow = useCallback(
    (slot: string, field: "start" | "end", value: string) => {
      if (slot === "timeWindows") return;
      setSchedule((s) => {
        if (!s) return s;
        const tw = { ...(s.timeWindows || DEFAULT_TIME_WINDOWS) };
        tw[slot] = { ...(tw[slot] || DEFAULT_TIME_WINDOWS[slot]), [field]: value };
        return { ...s, timeWindows: tw };
      });
      setScheduleSaved(false);
    },
    []
  );

  const saveSchedule = useCallback(async () => {
    if (!elderId || !schedule) return;
    setScheduleSaving(true);
    setScheduleError(null);
    try {
      const res = await fetch(`${httpBase}/elders/${encodeURIComponent(elderId)}/schedule`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          morning: schedule.morning.filter((m) => m.name.trim()),
          afternoon: schedule.afternoon.filter((m) => m.name.trim()),
          night: schedule.night.filter((m) => m.name.trim()),
          timeWindows: schedule.timeWindows || DEFAULT_TIME_WINDOWS,
        }),
      });
      if (!res.ok) throw new Error("Could not save schedule");
      setScheduleSaved(true);
      setTimeout(() => setScheduleSaved(false), 3000);
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setScheduleSaving(false);
    }
  }, [elderId, schedule]);

  useEffect(() => {
    const video = cameraVideoRef.current;
    if (!video || !cameraStream) return;
    video.srcObject = cameraStream;
    return () => {
      video.srcObject = null;
    };
  }, [cameraStream]);

  const callbacks: LiveSessionCallbacks = {
    onStatus: setStatus,
    onVoiceState: setVoiceState,
    onError: (msg) => {
      setError(msg);
      setStatus("error");
    },
    onCameraOpening: setCameraOpening,
    onCameraStream: setCameraStream,
    onLiveVideoActive: setLiveVideoActive,
  };

  const connect = useCallback(() => {
    if (!elderId) return;
    setError(null);
    const s = new LiveSession(BACKEND_URL, elderId, callbacks);
    setSession(s);
    s.connect().catch(() => {});
  }, [elderId]);

  const disconnect = useCallback(() => {
    session?.disconnect();
    setSession(null);
  }, [session]);

  const startMic = useCallback(() => {
    session?.startMic();
  }, [session]);

  const stopMic = useCallback(() => {
    session?.stopMic();
  }, [session]);

  const startLiveVideo = useCallback(() => {
    setError(null);
    session?.startLiveVideoFeed();
  }, [session]);

  const stopLiveVideo = useCallback(() => {
    session?.stopLiveVideoFeed();
  }, [session]);

  const confirmDose = useCallback(
    async (taken: boolean) => {
      if (!elderId) return;
      setConfirmDoseMessage(null);
      setConfirmDoseLoading(true);
      try {
        const res = await fetch(`${httpBase}/elders/${encodeURIComponent(elderId)}/confirm-dose`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slot: confirmDoseSlot, taken }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to record");
        setConfirmDoseMessage(taken ? "Recorded: you took it." : "Recorded: not taken. Emergency contact will be emailed if configured.");
      } catch (e) {
        setConfirmDoseMessage(e instanceof Error ? e.message : "Could not record.");
      } finally {
        setConfirmDoseLoading(false);
      }
    },
    [elderId, confirmDoseSlot]
  );

  const isConnected = status === "connected";

  if (elderId === null) {
    return (
      <main className="min-h-screen relative overflow-hidden">
        <div className="absolute inset-0 bg-[#0a0a0f]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(34,211,238,0.15),transparent)]" />
        <div className="relative z-10 min-h-screen flex flex-col items-center justify-center p-6 sm:p-8">
          <div className="w-full max-w-md flex flex-col gap-8">
            <header className="text-center space-y-2">
              <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-white to-zinc-300 bg-clip-text text-transparent">
                MedMate
              </h1>
              <p className="text-zinc-500 text-sm">
                {showSignUp ? "Create an account to get started." : "Sign in to access your medication schedule."}
              </p>
            </header>
            {showSignUp ? (
              <form
                onSubmit={handleRegister}
                className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl p-6 sm:p-8 shadow-2xl space-y-5"
              >
                <div>
                  <label htmlFor="reg-email" className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                    Email
                  </label>
                  <input
                    id="reg-email"
                    type="email"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    required
                    autoComplete="email"
                    className="w-full h-12 px-4 rounded-xl bg-white/5 border border-white/10 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50"
                    placeholder="you@example.com"
                  />
                </div>
                <div>
                  <label htmlFor="reg-name" className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                    Name (optional)
                  </label>
                  <input
                    id="reg-name"
                    type="text"
                    value={registerDisplayName}
                    onChange={(e) => setRegisterDisplayName(e.target.value)}
                    autoComplete="name"
                    className="w-full h-12 px-4 rounded-xl bg-white/5 border border-white/10 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50"
                    placeholder="Your name"
                  />
                </div>
                <div>
                  <label htmlFor="reg-password" className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                    Password
                  </label>
                  <input
                    id="reg-password"
                    type="password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    required
                    minLength={6}
                    autoComplete="new-password"
                    className="w-full h-12 px-4 rounded-xl bg-white/5 border border-white/10 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50"
                    placeholder="••••••••"
                  />
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Emergency contact (we’ll email them if a dose isn’t taken)
                  </p>
                  <input
                    type="text"
                    value={registerEmergencyName}
                    onChange={(e) => setRegisterEmergencyName(e.target.value)}
                    placeholder="Name (e.g. son/daughter)"
                    className="w-full h-11 px-4 rounded-lg bg-white/5 border border-white/10 text-white placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  />
                  <input
                    type="email"
                    value={registerEmergencyEmail}
                    onChange={(e) => setRegisterEmergencyEmail(e.target.value)}
                    placeholder="Their email"
                    className="w-full h-11 px-4 rounded-lg bg-white/5 border border-white/10 text-white placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  />
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Pharmacist contact (optional)
                  </p>
                  <input
                    type="text"
                    value={registerPharmacistName}
                    onChange={(e) => setRegisterPharmacistName(e.target.value)}
                    placeholder="Name or pharmacy"
                    className="w-full h-11 px-4 rounded-lg bg-white/5 border border-white/10 text-white placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  />
                  <input
                    type="email"
                    value={registerPharmacistEmail}
                    onChange={(e) => setRegisterPharmacistEmail(e.target.value)}
                    placeholder="Email"
                    className="w-full h-11 px-4 rounded-lg bg-white/5 border border-white/10 text-white placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  />
                  <input
                    type="tel"
                    value={registerPharmacistPhone}
                    onChange={(e) => setRegisterPharmacistPhone(e.target.value)}
                    placeholder="Phone"
                    className="w-full h-11 px-4 rounded-lg bg-white/5 border border-white/10 text-white placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    When do you take your meds? (optional)
                  </p>
                  {SLOTS.map((slot) => (
                    <div key={slot} className="flex items-center gap-2">
                      <span className="text-xs text-zinc-400 w-20 capitalize">{slot}</span>
                      <input
                        type="time"
                        value={registerTimeWindows[slot]?.start ?? "10:00"}
                        onChange={(e) =>
                          setRegisterTimeWindows((tw) => ({
                            ...tw,
                            [slot]: { ...tw[slot], start: e.target.value },
                          }))
                        }
                        className="h-9 px-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                      />
                      <span className="text-zinc-500">to</span>
                      <input
                        type="time"
                        value={registerTimeWindows[slot]?.end ?? "12:00"}
                        onChange={(e) =>
                          setRegisterTimeWindows((tw) => ({
                            ...tw,
                            [slot]: { ...tw[slot], end: e.target.value },
                          }))
                        }
                        className="h-9 px-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                      />
                    </div>
                  ))}
                </div>
                {(registerError || loginError) && (
                  <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
                    {registerError || loginError}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={registerLoading}
                  className="h-14 w-full rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-600 text-white font-semibold text-lg shadow-lg shadow-cyan-500/25 hover:from-cyan-400 hover:to-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 focus:ring-offset-[#0a0a0f] disabled:opacity-70 disabled:cursor-wait transition-all"
                >
                  {registerLoading ? "Creating account…" : "Create account"}
                </button>
                <p className="text-center text-sm text-zinc-400">
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() => { setShowSignUp(false); setRegisterError(null); setLoginError(null); }}
                    className="text-cyan-400 hover:text-cyan-300 underline focus:outline-none"
                  >
                    Sign in
                  </button>
                </p>
              </form>
            ) : (
              <form
                onSubmit={handleLogin}
                className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl p-6 sm:p-8 shadow-2xl space-y-5"
              >
                <div>
                  <label htmlFor="login-email" className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                    Email
                  </label>
                  <input
                    id="login-email"
                    type="email"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    required
                    autoComplete="email"
                    className="w-full h-12 px-4 rounded-xl bg-white/5 border border-white/10 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50"
                    placeholder="you@example.com"
                  />
                </div>
                <div>
                  <label htmlFor="login-password" className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                    Password
                  </label>
                  <input
                    id="login-password"
                    type="password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="w-full h-12 px-4 rounded-xl bg-white/5 border border-white/10 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50"
                    placeholder="••••••••"
                  />
                </div>
                {loginError && (
                  <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
                    {loginError}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={loginLoading}
                  className="h-14 w-full rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-600 text-white font-semibold text-lg shadow-lg shadow-cyan-500/25 hover:from-cyan-400 hover:to-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 focus:ring-offset-[#0a0a0f] disabled:opacity-70 disabled:cursor-wait transition-all"
                >
                  {loginLoading ? "Signing in…" : "Sign in"}
                </button>
                <p className="text-center text-sm text-zinc-400">
                  New user?{" "}
                  <button
                    type="button"
                    onClick={() => { setShowSignUp(true); setLoginError(null); setRegisterError(null); }}
                    className="text-cyan-400 hover:text-cyan-300 underline focus:outline-none"
                  >
                    Create account
                  </button>
                </p>
              </form>
            )}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-[#0a0a0f]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(34,211,238,0.15),transparent)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_80%_50%,rgba(139,92,246,0.08),transparent)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0%,rgba(10,10,15,0.8)_70%)]" />

      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center p-6 sm:p-8">
        <div className="w-full max-w-lg flex flex-col gap-10">
          {/* Header */}
          <header className="text-center space-y-2">
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
              MedMate
            </h1>
            <p className="text-zinc-500 text-sm sm:text-base font-medium">
              Voice + vision. One session.
            </p>
          </header>

          {/* Main card */}
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl p-6 sm:p-8 shadow-2xl shadow-black/20 space-y-6">
            {/* Signed-in user */}
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-zinc-400">
                Signed in as <span className="text-zinc-200 font-medium">{displayName ?? "User"}</span>
              </p>
              <button
                type="button"
                onClick={handleLogout}
                className="text-sm text-zinc-500 hover:text-zinc-300 underline focus:outline-none focus:ring-2 focus:ring-cyan-500/50 rounded px-2 py-1"
              >
                Sign out
              </button>
            </div>

            {/* My medications — so the agent knows what you take and when */}
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
                My medications
              </h2>
              <p className="text-xs text-zinc-500">
                Add your meds below. MedMate uses this when you ask &quot;What do I take in the morning?&quot; or show a pill.
              </p>
              {scheduleLoading ? (
                <p className="text-sm text-zinc-500">Loading…</p>
              ) : scheduleError ? (
                <p className="text-sm text-red-400">{scheduleError}</p>
              ) : schedule ? (
                <>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                      Schedule times (when you take meds)
                    </p>
                    {SLOTS.map((slot) => (
                      <div key={slot} className="flex items-center gap-2">
                        <span className="text-xs text-zinc-400 w-20 capitalize">{slot}</span>
                        <input
                          type="time"
                          value={(schedule.timeWindows || DEFAULT_TIME_WINDOWS)[slot]?.start ?? "10:00"}
                          onChange={(e) => updateTimeWindow(slot, "start", e.target.value)}
                          className="h-9 px-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                        />
                        <span className="text-zinc-500">to</span>
                        <input
                          type="time"
                          value={(schedule.timeWindows || DEFAULT_TIME_WINDOWS)[slot]?.end ?? "12:00"}
                          onChange={(e) => updateTimeWindow(slot, "end", e.target.value)}
                          className="h-9 px-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                        />
                      </div>
                    ))}
                  </div>
                  {SLOTS.map((slot) => (
                    <div key={slot} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-zinc-400">{slotLabel(slot, schedule.timeWindows)}</span>
                        <button
                          type="button"
                          onClick={() => addMed(slot)}
                          className="text-xs text-cyan-400 hover:text-cyan-300"
                        >
                          + Add
                        </button>
                      </div>
                      <ul className="space-y-2">
                        {schedule[slot].map((med, i) => (
                          <li key={i} className="flex flex-wrap gap-2 items-center">
                            <input
                              type="text"
                              value={med.name}
                              onChange={(e) => updateMed(slot, i, "name", e.target.value)}
                              placeholder="Medication name"
                              className="flex-1 min-w-[100px] h-9 px-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                            />
                            <input
                              type="text"
                              value={med.strength ?? ""}
                              onChange={(e) => updateMed(slot, i, "strength", e.target.value)}
                              placeholder="e.g. 10 mg"
                              className="w-20 h-9 px-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                            />
                            <label className="flex items-center gap-1 text-xs text-zinc-400">
                              Qty
                              <input
                                type="number"
                                min={1}
                                value={med.quantity ?? 1}
                                onChange={(e) => updateMed(slot, i, "quantity", e.target.value)}
                                className="w-12 h-9 px-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => removeMed(slot, i)}
                              className="text-zinc-500 hover:text-red-400 text-sm"
                              aria-label="Remove"
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  <div className="flex items-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={saveSchedule}
                      disabled={scheduleSaving}
                      className="h-10 px-4 rounded-xl bg-cyan-500/20 text-cyan-400 font-medium text-sm hover:bg-cyan-500/30 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 disabled:opacity-70"
                    >
                      {scheduleSaving ? "Saving…" : scheduleSaved ? "Saved" : "Save schedule"}
                    </button>
                    {scheduleError && <span className="text-xs text-red-400">{scheduleError}</span>}
                  </div>
                </>
              ) : null}
            </div>

            {/* Emergency & pharmacist contacts — editable after signup */}
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
                Emergency & pharmacist contacts
              </h2>
              <p className="text-xs text-zinc-500">
                Who to notify if you don’t take a dose. You can update these anytime.
              </p>
              {profileLoading ? (
                <p className="text-sm text-zinc-500">Loading…</p>
              ) : (
                <>
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-zinc-500">Emergency contact (e.g. family)</p>
                    <input
                      type="text"
                      value={emergencyName}
                      onChange={(e) => setEmergencyName(e.target.value)}
                      placeholder="Name"
                      className="w-full h-10 px-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                    />
                    <input
                      type="email"
                      value={emergencyEmail}
                      onChange={(e) => setEmergencyEmail(e.target.value)}
                      placeholder="Email (we’ll email them if a dose isn’t taken)"
                      className="w-full h-10 px-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                    />
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-zinc-500">Pharmacist (optional)</p>
                    <input
                      type="text"
                      value={pharmacistName}
                      onChange={(e) => setPharmacistName(e.target.value)}
                      placeholder="Name or pharmacy"
                      className="w-full h-10 px-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                    />
                    <input
                      type="email"
                      value={pharmacistEmail}
                      onChange={(e) => setPharmacistEmail(e.target.value)}
                      placeholder="Email"
                      className="w-full h-10 px-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                    />
                    <input
                      type="tel"
                      value={pharmacistPhone}
                      onChange={(e) => setPharmacistPhone(e.target.value)}
                      placeholder="Phone"
                      className="w-full h-10 px-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                    />
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={saveContacts}
                      disabled={contactsSaving}
                      className="h-9 px-4 rounded-lg bg-cyan-500/20 text-cyan-400 font-medium text-sm hover:bg-cyan-500/30 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 disabled:opacity-70"
                    >
                      {contactsSaving ? "Saving…" : contactsSaved ? "Saved" : "Save contacts"}
                    </button>
                    {contactsError && <span className="text-xs text-red-400">{contactsError}</span>}
                  </div>
                </>
              )}
            </div>

            {/* Tablet taken? — record dose and optionally notify emergency contact */}
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
                Tablet taken?
              </h2>
              <p className="text-xs text-zinc-500">
                Say which dose (morning / afternoon / night), then record whether you took it. If you didn’t, we’ll email your emergency contact when configured.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={confirmDoseSlot}
                  onChange={(e) => {
                    setConfirmDoseSlot(e.target.value as "morning" | "afternoon" | "night");
                    setConfirmDoseMessage(null);
                  }}
                  className="h-10 px-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                >
                  {SLOTS.map((s) => (
                    <option key={s} value={s} className="bg-[#0a0a0f] text-white">
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => confirmDose(true)}
                  disabled={confirmDoseLoading}
                  className="h-10 px-4 rounded-lg bg-emerald-500/20 text-emerald-400 font-medium text-sm hover:bg-emerald-500/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 disabled:opacity-70"
                >
                  I took it
                </button>
                <button
                  type="button"
                  onClick={() => confirmDose(false)}
                  disabled={confirmDoseLoading}
                  className="h-10 px-4 rounded-lg bg-amber-500/20 text-amber-400 font-medium text-sm hover:bg-amber-500/30 focus:outline-none focus:ring-2 focus:ring-amber-500/50 disabled:opacity-70"
                >
                  I didn’t take it
                </button>
              </div>
              {confirmDoseMessage && (
                <p className="text-xs text-zinc-400">{confirmDoseMessage}</p>
              )}
            </div>

            {/* Status */}
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={status} voiceState={voiceState} />
              </div>
              {error && (
                <div
                  className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400 font-medium"
                  role="alert"
                >
                  {error}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-3 pt-2">
              {!isConnected ? (
                <button
                  type="button"
                  onClick={connect}
                  className="h-14 w-full rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-600 text-white font-semibold text-lg shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 hover:from-cyan-400 hover:to-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 focus:ring-offset-[#0a0a0f] active:scale-[0.98] transition-all duration-200"
                  aria-label="Start session"
                >
                  Start session
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={voiceState === "listening" ? stopMic : startMic}
                    className={`h-14 w-full rounded-xl font-semibold text-lg shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#0a0a0f] active:scale-[0.98] transition-all duration-200 ${
                      voiceState === "listening"
                        ? "bg-red-500/90 hover:bg-red-500 text-white shadow-red-500/25"
                        : "bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-emerald-500/25 hover:shadow-emerald-500/40 hover:from-emerald-400 hover:to-emerald-500"
                    }`}
                    aria-label={
                      voiceState === "listening"
                        ? "Stop microphone"
                        : "Start microphone"
                    }
                    aria-pressed={voiceState === "listening"}
                  >
                    {voiceState === "listening"
                      ? "Stop microphone"
                      : "Start microphone"}
                  </button>
                  {cameraStream && (
                    <div className="relative rounded-xl overflow-hidden border border-white/10 bg-black aspect-video max-h-48 flex items-center justify-center">
                      <video
                        ref={cameraVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover"
                        aria-label="Camera preview"
                      />
                      <p className="absolute bottom-2 left-2 right-2 text-center text-xs text-white/80 bg-black/60 px-2 py-1 rounded">
                        {liveVideoActive ? "Sending live feed at 1 FPS…" : "Position pill or bottle, then we'll capture…"}
                      </p>
                    </div>
                  )}
                  {!liveVideoActive ? (
                    <button
                      type="button"
                      onClick={startLiveVideo}
                      disabled={cameraOpening}
                      className="h-14 w-full rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white font-semibold text-lg shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 hover:from-violet-400 hover:to-purple-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-[#0a0a0f] active:scale-[0.98] transition-all duration-200 disabled:opacity-70 disabled:cursor-wait"
                      aria-label="Start live video feed"
                    >
                      {cameraOpening ? "Opening camera…" : "Start live video"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={stopLiveVideo}
                      className="h-14 w-full rounded-xl bg-red-500/90 hover:bg-red-500 text-white font-semibold text-lg shadow-lg shadow-red-500/25 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-[#0a0a0f] active:scale-[0.98] transition-all duration-200"
                      aria-label="Stop live video feed"
                    >
                      Stop live video
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={disconnect}
                    className="h-14 w-full rounded-xl border border-white/20 bg-white/5 text-zinc-300 font-semibold text-lg hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/20 focus:ring-offset-2 focus:ring-offset-[#0a0a0f] active:scale-[0.98] transition-all duration-200"
                    aria-label="End session"
                  >
                    End session
                  </button>
                </>
              )}
            </div>
          </section>

          <p className="text-center text-xs text-zinc-600 font-medium">
            Allow mic & camera when prompted. You can interrupt anytime.
          </p>
          <p className="text-center text-xs text-zinc-600 mt-1" title="Backend for API and WebSocket">
            Backend: {BACKEND_URL}
          </p>
        </div>
      </div>
    </main>
  );
}

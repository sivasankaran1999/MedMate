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

function SectionTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-1 text-xs text-zinc-500 leading-relaxed">{subtitle}</p>
        ) : null}
      </div>
      <div className="shrink-0 rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-zinc-400">
        Secure
      </div>
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

type Slot = "morning" | "afternoon" | "night";

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

function minutesSinceMidnight(hhmm: string): number {
  const [hStr, mStr] = hhmm.split(":");
  const h = parseInt(hStr ?? "0", 10);
  const m = parseInt(mStr ?? "0", 10);
  return h * 60 + m;
}

function formatNow12h(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function windowDecision(nowM: number, startM: number, endM: number, crossesMidnight: boolean): { status: "in" | "late_ok" | "skip" | "before"; lateByMin?: number } {
  if (startM <= nowM && nowM <= endM) return { status: "in" };
  let past = -1;
  if (nowM > endM) past = nowM - endM;
  else if (crossesMidnight && nowM < startM && nowM <= 6 * 60) past = 1440 - endM + nowM;
  if (past >= 0) {
    if (past <= 60) return { status: "late_ok", lateByMin: past };
    return { status: "skip", lateByMin: past };
  }
  return { status: "before" };
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

  const [dashboardTab, setDashboardTab] = useState<"session" | "schedule">("session");

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

  type InsightsData = {
    taken7d: number;
    missed7d: number;
    taken30d: number;
    missed30d: number;
    adherence7d: number | null;
    adherence30d: number | null;
    scheduledDosesPerDay: number;
    lastRecorded: Record<string, { at?: string; taken?: boolean }>;
  };
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);

  const [nearbyPharmaciesSlot, setNearbyPharmaciesSlot] = useState<"morning" | "afternoon" | "night">("morning");
  const [nearbyPharmaciesLoading, setNearbyPharmaciesLoading] = useState(false);
  const [nearbyPharmaciesError, setNearbyPharmaciesError] = useState<string | null>(null);
  type PharmacyRow = { name: string; address?: string | null; lat: number; lon: number; distance_km: number; phone?: string | null };
  const [pharmaciesList, setPharmaciesList] = useState<Array<PharmacyRow> | null>(null);

  const [nowTime, setNowTime] = useState<Date>(() => new Date());
  const [interruptionFlag, setInterruptionFlag] = useState(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const [transcript, setTranscript] = useState<Array<{ role: "user" | "assistant" | "system"; text: string; ts: number }>>([]);
  // Show user speech transcript by default (comes from server-side input transcription).
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [assistantDraft, setAssistantDraft] = useState<string>("");

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

  useEffect(() => {
    if (!elderId) return;
    setInsightsLoading(true);
    fetch(`${httpBase}/elders/${encodeURIComponent(elderId)}/insights`)
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data: InsightsData | null) => {
        if (data) setInsights(data);
      })
      .finally(() => setInsightsLoading(false));
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
    onAssistantText: (text) => {
      // The server can stream partial transcripts; accumulate and finalize on turnComplete.
      setAssistantDraft((prev) => {
        const next = text.trim();
        if (!next) return prev;
        if (!prev) return next;
        // If we receive the full transcript repeatedly, prefer the longer one.
        if (next.startsWith(prev)) return next;
        if (prev.startsWith(next)) return prev;
        // Otherwise treat as a delta chunk.
        return `${prev} ${next}`.replace(/\s+/g, " ").trim();
      });
    },
    onUserText: (text) => {
      if (!captionsEnabled) return;
      setTranscript((t) => [...t, { role: "user", text, ts: Date.now() }]);
    },
    onInterrupted: () => {
      setInterruptionFlag(true);
      setTranscript((t) => [...t, { role: "system", text: "Interrupted — MedMate paused to listen.", ts: Date.now() }]);
      setTimeout(() => setInterruptionFlag(false), 2000);
    },
    onTurnComplete: () => {
      setAssistantDraft((draft) => {
        const finalText = draft.trim();
        if (finalText) {
          setTranscript((t) => {
            const last = t[t.length - 1];
            if (last?.role === "assistant" && last.text.trim() === finalText) return t;
            return [...t, { role: "assistant", text: finalText, ts: Date.now() }];
          });
        }
        return "";
      });
    },
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

  // Update "Now" clock every 10s.
  useEffect(() => {
    const id = setInterval(() => setNowTime(new Date()), 10000);
    return () => clearInterval(id);
  }, []);

  // Auto-scroll transcript to bottom.
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [transcript, assistantDraft]);

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
        fetch(`${httpBase}/elders/${encodeURIComponent(elderId)}/insights`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data: InsightsData | null) => { if (data) setInsights(data); });
      } catch (e) {
        setConfirmDoseMessage(e instanceof Error ? e.message : "Could not record.");
      } finally {
        setConfirmDoseLoading(false);
      }
    },
    [elderId, confirmDoseSlot]
  );

  const findNearbyPharmacies = useCallback(async () => {
    setNearbyPharmaciesError(null);
    setPharmaciesList(null);
    if (!navigator.geolocation) {
      setNearbyPharmaciesError("Location is not supported by your browser.");
      return;
    }
    setNearbyPharmaciesLoading(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 15000, maximumAge: 60000 });
      });
      const { latitude, longitude } = position.coords;
      const res = await fetch(
        `${httpBase}/api/nearby-pharmacies?lat=${encodeURIComponent(latitude)}&lng=${encodeURIComponent(longitude)}&radius=5000`
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { detail?: string }).detail || "Could not load pharmacies");
      }
      const data = (await res.json()) as { pharmacies: Array<PharmacyRow> };
      setPharmaciesList(data.pharmacies || []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to get location or pharmacies.";
      setNearbyPharmaciesError(msg);
    } finally {
      setNearbyPharmaciesLoading(false);
    }
  }, []);

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
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(34,211,238,0.18),transparent)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_80%_45%,rgba(139,92,246,0.12),transparent)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_55%_45%_at_15%_60%,rgba(16,185,129,0.08),transparent)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(10,10,15,0.35)_0%,rgba(10,10,15,0.85)_70%)]" />

      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-3xl flex flex-col gap-8">
          {/* Header */}
          <header className="text-center space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs text-zinc-400 backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
              Gemini Live · Voice + Vision medication companion
            </div>
            <h1 className="text-4xl sm:text-6xl font-bold tracking-tight bg-gradient-to-r from-white via-zinc-100 to-zinc-400 bg-clip-text text-transparent">
              MedMate
            </h1>
            <p className="text-zinc-400 text-sm sm:text-base font-medium leading-relaxed">
              A calm, clear assistant that helps you take the right tablets at the right time—and find nearby pharmacies when you run out.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-zinc-400">Schedule-aware</span>
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-zinc-400">Late-window safe</span>
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-zinc-400">Refill nearby</span>
            </div>
          </header>

          {/* Safety mode banner */}
          <div className="w-full rounded-xl border-2 border-cyan-500/40 bg-cyan-500/15 px-5 py-4 flex items-center gap-4 border-l-4 border-l-cyan-400">
            <span className="text-xs font-bold uppercase tracking-wider text-cyan-300">Notice</span>
            <p className="text-sm sm:text-base font-medium text-cyan-100">
              This is not medical advice. Always confirm with your pharmacist or doctor.
            </p>
          </div>

          {/* Main card */}
          <section className="relative rounded-3xl border border-white/10 bg-white/[0.03] backdrop-blur-xl p-6 sm:p-8 shadow-2xl shadow-black/30 space-y-6 overflow-hidden">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(34,211,238,0.10),transparent_60%)]" />
            {/* Signed-in user */}
            <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <p className="text-sm text-zinc-400">
                Signed in as <span className="text-zinc-200 font-medium">{displayName ?? "User"}</span>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={status} voiceState={voiceState} />
                <button
                  type="button"
                  onClick={handleLogout}
                  className="h-9 px-4 rounded-xl border border-white/10 bg-white/[0.03] text-sm text-zinc-300 hover:bg-white/[0.06] hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                >
                  Sign out
                </button>
              </div>
            </div>

            {/* Tabs */}
            <div className="relative flex rounded-xl border border-white/10 bg-white/[0.02] p-1">
              <button
                type="button"
                onClick={() => setDashboardTab("session")}
                className={`flex-1 rounded-lg py-2.5 text-sm font-medium transition-colors ${
                  dashboardTab === "session"
                    ? "bg-cyan-500/20 text-cyan-200 shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Session
              </button>
              <button
                type="button"
                onClick={() => setDashboardTab("schedule")}
                className={`flex-1 rounded-lg py-2.5 text-sm font-medium transition-colors ${
                  dashboardTab === "schedule"
                    ? "bg-cyan-500/20 text-cyan-200 shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Schedule & more
              </button>
            </div>

            {dashboardTab === "session" ? (
            <>
            {/* Now — always-on summary */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-3">
              <SectionTitle
                title="Now"
                subtitle="At-a-glance: current time, window status, and what MedMate will recommend right now."
              />
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-zinc-200">
                  <span className="text-zinc-500">Time</span>
                  <span className="font-semibold">{formatNow12h(nowTime)}</span>
                </span>
                {interruptionFlag && (
                  <span className="inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                    Listening (interrupted)
                  </span>
                )}
              </div>
              {schedule ? (() => {
                const tw = schedule.timeWindows || DEFAULT_TIME_WINDOWS;
                const nowHHMM = nowTime.toTimeString().slice(0, 5);
                const nowM = minutesSinceMidnight(nowHHMM);
                const slots: Array<{ slot: Slot; decision: ReturnType<typeof windowDecision> }> = (["morning","afternoon","night"] as Slot[]).map((slot) => {
                  const w = tw[slot] || DEFAULT_TIME_WINDOWS[slot];
                  const startM = minutesSinceMidnight(w.start);
                  const endM = minutesSinceMidnight(w.end);
                  return { slot, decision: windowDecision(nowM, startM, endM, slot === "night") };
                });
                const active = slots.find((s) => s.decision.status === "in") || slots.find((s) => s.decision.status === "late_ok");
                const next = slots.find((s) => s.decision.status === "before") || null;
                const currentSlot = active?.slot;
                const meds = currentSlot ? schedule[currentSlot] : [];
                const d = active?.decision;
                const statusChip =
                  !currentSlot ? (
                    <span className="inline-flex items-center rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-zinc-300">
                      Not in a window. Next: {next ? slotLabel(next.slot, tw) : "—"}
                    </span>
                  ) : d?.status === "in" ? (
                    <span className="inline-flex items-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                      In window: {slotLabel(currentSlot, tw)}
                    </span>
                  ) : d?.status === "late_ok" ? (
                    <span className="inline-flex items-center rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                      Late by {d.lateByMin} min (still OK): {slotLabel(currentSlot, tw)}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                      Window passed (skip): {slotLabel(currentSlot, tw)}
                    </span>
                  );
                return (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">{statusChip}</div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">What to take now</p>
                      {!currentSlot ? (
                        <p className="mt-2 text-sm text-zinc-300">
                          You&apos;re not in a medication window right now. Next window:{" "}
                          <span className="font-semibold text-zinc-100">{next ? slotLabel(next.slot, tw) : "—"}</span>
                        </p>
                      ) : meds.length === 0 ? (
                        <p className="mt-2 text-sm text-zinc-300">No medications set for {currentSlot}.</p>
                      ) : (
                        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                          {meds.map((m, i) => (
                            <li key={i} className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
                              <p className="text-sm font-semibold text-zinc-100">
                                {m.name}{" "}
                                {m.quantity && m.quantity > 1 ? <span className="text-zinc-400 font-medium">×{m.quantity}</span> : null}
                              </p>
                              {m.strength ? <p className="text-xs text-zinc-500">{m.strength}</p> : null}
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="mt-3 text-xs text-zinc-500">
                        Tip: ask “What should I take now?” — MedMate will answer using your schedule and this clock.
                      </p>
                    </div>
                  </div>
                );
              })() : null}
            </div>

            {/* Live transcript */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-3">
              <SectionTitle
                title="Live transcript"
                subtitle="What you said (speech-to-text) and what MedMate decided (Gemini Live TEXT)."
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCaptionsEnabled((v) => !v)}
                  className={`h-9 px-4 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/40 ${
                    captionsEnabled
                      ? "border-cyan-500/30 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/20"
                      : "border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.06]"
                  }`}
                >
                  {captionsEnabled ? "Captions: ON" : "Captions: OFF"}
                </button>
                <span className="text-xs text-zinc-500">
                  If MedMate stops responding, turn captions OFF (some browsers can’t share the mic).
                </span>
              </div>
              <div className="max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-3 space-y-2">
                {transcript.length === 0 && !assistantDraft ? (
                  <p className="text-sm text-zinc-500">
                    Start the microphone to see MedMate&apos;s transcript here.
                    {captionsEnabled ? " (Your speech captions will also appear when available.)" : ""}
                  </p>
                ) : (
                  <>
                    {transcript.map((m, idx) => (
                      <div key={idx} className={`flex ${m.role === "assistant" ? "justify-start" : m.role === "user" ? "justify-end" : "justify-center"}`}>
                        <div
                          className={
                            m.role === "assistant"
                              ? "max-w-[90%] rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-zinc-200"
                              : m.role === "user"
                                ? "max-w-[90%] rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100"
                                : "max-w-[90%] rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
                          }
                        >
                          {m.text}
                        </div>
                      </div>
                    ))}
                    {assistantDraft ? (
                      <div className="flex justify-start">
                        <div className="max-w-[90%] rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-200 opacity-80">
                          {assistantDraft}
                        </div>
                      </div>
                    ) : null}
                    <div ref={transcriptEndRef} />
                  </>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTranscript([])}
                  className="h-9 px-4 rounded-xl border border-white/10 bg-white/[0.03] text-sm text-zinc-300 hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                >
                  Clear transcript
                </button>
                <span className="text-xs text-zinc-500">
                  Interruption demo: start talking while MedMate is speaking — you’ll see “Interrupted”.
                </span>
              </div>
            </div>

            {/* Tablet taken? — in Session tab so user can record without switching */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-3">
              <SectionTitle
                title="Tablet taken?"
                subtitle="Pick the dose (morning / afternoon / night) and record whether you took it. If you didn't, we can email your emergency contact."
              />
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={confirmDoseSlot}
                  onChange={(e) => {
                    setConfirmDoseSlot(e.target.value as "morning" | "afternoon" | "night");
                    setConfirmDoseMessage(null);
                  }}
                  className="h-11 px-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/40"
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
                  className="h-11 px-5 rounded-xl bg-emerald-500/15 text-emerald-200 font-semibold text-sm hover:bg-emerald-500/20 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:opacity-70"
                >
                  I took it
                </button>
                <button
                  type="button"
                  onClick={() => confirmDose(false)}
                  disabled={confirmDoseLoading}
                  className="h-11 px-5 rounded-xl bg-amber-500/15 text-amber-200 font-semibold text-sm hover:bg-amber-500/20 focus:outline-none focus:ring-2 focus:ring-amber-500/40 disabled:opacity-70"
                >
                  I didn't take it
                </button>
              </div>
              {confirmDoseMessage && (
                <p className="text-xs text-zinc-400">{confirmDoseMessage}</p>
              )}
            </div>

            {/* Status */}
            <div className="flex flex-col gap-3">
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
            </>
            ) : (
            <>
            <p className="text-sm text-zinc-400">
              Use the <button type="button" onClick={() => setDashboardTab("session")} className="text-cyan-400 hover:text-cyan-300 underline font-medium">Session</button> tab to talk to MedMate and control the mic.
            </p>

            {/* Insights */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
                Insights
              </h2>
              <p className="text-xs text-zinc-500">
                Track how often you take or miss doses. Record with &quot;I took it&quot; / &quot;I didn&apos;t take it&quot; below to update.
              </p>
              {insightsLoading ? (
                <p className="text-sm text-zinc-500">Loading…</p>
              ) : insights ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
                    <p className="text-xs text-zinc-500 uppercase tracking-wide">Taken (7d)</p>
                    <p className="text-xl font-bold text-emerald-200">{insights.taken7d}</p>
                  </div>
                  <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3">
                    <p className="text-xs text-zinc-500 uppercase tracking-wide">Missed (7d)</p>
                    <p className="text-xl font-bold text-red-200">{insights.missed7d}</p>
                  </div>
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
                    <p className="text-xs text-zinc-500 uppercase tracking-wide">Taken (30d)</p>
                    <p className="text-xl font-bold text-emerald-200">{insights.taken30d}</p>
                  </div>
                  <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3">
                    <p className="text-xs text-zinc-500 uppercase tracking-wide">Missed (30d)</p>
                    <p className="text-xl font-bold text-red-200">{insights.missed30d}</p>
                  </div>
                  {(insights.adherence7d != null || insights.adherence30d != null) && (
                    <>
                      <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3">
                        <p className="text-xs text-zinc-500 uppercase tracking-wide">Adherence (7d)</p>
                        <p className="text-xl font-bold text-cyan-200">{insights.adherence7d ?? "—"}%</p>
                      </div>
                      <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3">
                        <p className="text-xs text-zinc-500 uppercase tracking-wide">Adherence (30d)</p>
                        <p className="text-xl font-bold text-cyan-200">{insights.adherence30d ?? "—"}%</p>
                      </div>
                    </>
                  )}
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 col-span-2 sm:col-span-4">
                    <p className="text-xs text-zinc-500 uppercase tracking-wide">Scheduled doses per day</p>
                    <p className="text-lg font-semibold text-zinc-200">{insights.scheduledDosesPerDay}</p>
                  </div>
                  {Object.keys(insights.lastRecorded).length > 0 && (
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 col-span-2 sm:col-span-4 space-y-1">
                      <p className="text-xs text-zinc-500 uppercase tracking-wide">Last recorded</p>
                      {(["morning", "afternoon", "night"] as const).map((slot) => {
                        const r = insights.lastRecorded[slot];
                        if (!r) return null;
                        const at = r.at ? new Date(r.at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "";
                        return (
                          <p key={slot} className="text-sm text-zinc-300">
                            <span className="capitalize">{slot}</span>: {r.taken ? "Taken" : "Missed"}{at ? ` at ${at}` : ""}
                          </p>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-zinc-500">No insights yet. Record &quot;I took it&quot; or &quot;I didn&apos;t take it&quot; to start tracking.</p>
              )}
            </div>

            {/* My medications — so the agent knows what you take and when */}
            <div className="relative rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-4">
              <SectionTitle
                title="My medications"
                subtitle="Add your meds below. MedMate uses this when you ask “What do I take in the morning?” or when you show a pill/bottle."
              />
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
                          className="h-9 px-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/40"
                        />
                        <span className="text-zinc-500">to</span>
                        <input
                          type="time"
                          value={(schedule.timeWindows || DEFAULT_TIME_WINDOWS)[slot]?.end ?? "12:00"}
                          onChange={(e) => updateTimeWindow(slot, "end", e.target.value)}
                          className="h-9 px-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/40"
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
                          className="h-8 px-3 rounded-lg border border-cyan-500/20 bg-cyan-500/10 text-xs text-cyan-300 hover:bg-cyan-500/15 hover:text-cyan-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                        >
                          + Add
                        </button>
                      </div>
                      <ul className="space-y-2">
                        {schedule[slot].map((med, i) => (
                          <li key={i} className="flex flex-wrap gap-2 items-center rounded-xl border border-white/10 bg-white/[0.03] p-3">
                            <input
                              type="text"
                              value={med.name}
                              onChange={(e) => updateMed(slot, i, "name", e.target.value)}
                              placeholder="Medication name"
                              className="flex-1 min-w-[140px] h-10 px-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/40"
                            />
                            <input
                              type="text"
                              value={med.strength ?? ""}
                              onChange={(e) => updateMed(slot, i, "strength", e.target.value)}
                              placeholder="e.g. 10 mg"
                              className="w-24 h-10 px-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/40"
                            />
                            <label className="flex items-center gap-1 text-xs text-zinc-400">
                              Qty
                              <input
                                type="number"
                                min={1}
                                value={med.quantity ?? 1}
                                onChange={(e) => updateMed(slot, i, "quantity", e.target.value)}
                                className="w-14 h-10 px-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/40"
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => removeMed(slot, i)}
                              className="ml-auto h-10 w-10 inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/[0.02] text-zinc-400 hover:bg-red-500/10 hover:text-red-300 focus:outline-none focus:ring-2 focus:ring-red-500/40"
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
                      className="h-11 px-5 rounded-xl bg-gradient-to-r from-cyan-500/25 to-violet-500/15 text-cyan-200 font-semibold text-sm hover:from-cyan-500/30 hover:to-violet-500/20 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 disabled:opacity-70"
                    >
                      {scheduleSaving ? "Saving…" : scheduleSaved ? "Saved" : "Save schedule"}
                    </button>
                    {scheduleError && <span className="text-xs text-red-400">{scheduleError}</span>}
                  </div>
                </>
              ) : null}
            </div>

            {/* Emergency & pharmacist contacts — editable after signup */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-3">
              <SectionTitle
                title="Emergency & pharmacist contacts"
                subtitle="Who to notify if you don’t take a dose. You can update these anytime."
              />
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
                      className="w-full h-11 px-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/40"
                    />
                    <input
                      type="email"
                      value={emergencyEmail}
                      onChange={(e) => setEmergencyEmail(e.target.value)}
                      placeholder="Email (we’ll email them if a dose isn’t taken)"
                      className="w-full h-11 px-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/40"
                    />
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-zinc-500">Pharmacist (optional)</p>
                    <input
                      type="text"
                      value={pharmacistName}
                      onChange={(e) => setPharmacistName(e.target.value)}
                      placeholder="Name or pharmacy"
                      className="w-full h-11 px-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/40"
                    />
                    <input
                      type="email"
                      value={pharmacistEmail}
                      onChange={(e) => setPharmacistEmail(e.target.value)}
                      placeholder="Email"
                      className="w-full h-11 px-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/40"
                    />
                    <input
                      type="tel"
                      value={pharmacistPhone}
                      onChange={(e) => setPharmacistPhone(e.target.value)}
                      placeholder="Phone"
                      className="w-full h-11 px-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/40"
                    />
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={saveContacts}
                      disabled={contactsSaving}
                      className="h-11 px-5 rounded-xl bg-gradient-to-r from-cyan-500/20 to-violet-500/15 text-cyan-200 font-semibold text-sm hover:from-cyan-500/25 hover:to-violet-500/20 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 disabled:opacity-70"
                    >
                      {contactsSaving ? "Saving…" : contactsSaved ? "Saved" : "Save contacts"}
                    </button>
                    {contactsError && <span className="text-xs text-red-400">{contactsError}</span>}
                  </div>
                </>
              )}
            </div>

            {/* Refill flow — guided: out of [slot] tablets → select slot → Find pharmacies → 3 best options + CTAs */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-4">
              <SectionTitle
                title="Refill: nearby pharmacies"
                subtitle="You're out of tablets → select the time → find pharmacies → pick from the best options."
              />
              <p className="text-sm font-medium text-cyan-200/90">
                You're out of <span className="text-white">{nearbyPharmaciesSlot.charAt(0).toUpperCase() + nearbyPharmaciesSlot.slice(1)}</span> tablets
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-zinc-500">Step 1 — Select:</span>
                <select
                  value={nearbyPharmaciesSlot}
                  onChange={(e) => setNearbyPharmaciesSlot(e.target.value as "morning" | "afternoon" | "night")}
                  className="h-11 px-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/40"
                >
                  {SLOTS.map((s) => (
                    <option key={s} value={s} className="bg-[#0a0a0f] text-white">
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-zinc-500">Step 2 —</span>
                <button
                  type="button"
                  onClick={findNearbyPharmacies}
                  disabled={nearbyPharmaciesLoading}
                  className="h-11 px-5 rounded-xl bg-gradient-to-r from-cyan-500/20 to-violet-500/15 text-cyan-200 font-semibold text-sm hover:from-cyan-500/25 hover:to-violet-500/20 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 disabled:opacity-70 disabled:cursor-wait"
                >
                  {nearbyPharmaciesLoading ? "Finding…" : "Find pharmacies near me"}
                </button>
              </div>
              {schedule && (
                <p className="text-xs text-zinc-500">
                  Refilling: {schedule[nearbyPharmaciesSlot].length
                    ? schedule[nearbyPharmaciesSlot].map((m) => `${m.name}${m.strength ? ` ${m.strength}` : ""}`).join(", ")
                    : "No meds set for this time."}
                </p>
              )}
              {nearbyPharmaciesError && (
                <p className="text-xs text-red-400">{nearbyPharmaciesError}</p>
              )}
              {pharmaciesList && pharmaciesList.length > 0 && (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Step 3 — 3 best options</p>
                  <ul className="space-y-3">
                    {pharmaciesList.slice(0, 3).map((p, i) => {
                      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.lat},${p.lon}`)}`;
                      const shareText = `I need to refill my ${nearbyPharmaciesSlot} medications. Nearest option: ${p.name}${p.address ? `, ${p.address}` : ""}. ${mapsUrl}`;
                      const shareWithCaregiver = async () => {
                        if (typeof navigator !== "undefined" && navigator.share) {
                          try {
                            await navigator.share({ title: "MedMate refill", text: shareText });
                          } catch {
                            await navigator.clipboard.writeText(shareText);
                          }
                        } else {
                          await navigator.clipboard.writeText(shareText);
                        }
                      };
                      return (
                        <li
                          key={i}
                          className="flex flex-col gap-2 rounded-xl bg-white/[0.04] border border-white/10 p-4 text-sm"
                        >
                          <span className="font-medium text-zinc-200">{p.name}</span>
                          {p.address && <span className="text-xs text-zinc-500">{p.address}</span>}
                          <span className="text-xs text-zinc-400">{p.distance_km} km away</span>
                          <div className="flex flex-wrap gap-2 mt-1">
                            <a
                              href={mapsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-cyan-500/20 text-cyan-200 text-xs font-medium hover:bg-cyan-500/30"
                            >
                              Open in Maps
                            </a>
                            <a
                              href={p.phone ? `tel:${p.phone.replace(/\s/g, "")}` : `https://www.google.com/search?q=${encodeURIComponent(`${p.name} ${p.address || ""} phone number`)}`}
                              target={p.phone ? undefined : "_blank"}
                              rel={p.phone ? undefined : "noopener noreferrer"}
                              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-emerald-500/20 text-emerald-200 text-xs font-medium hover:bg-emerald-500/30"
                              title={p.phone ? "Call pharmacy" : "Search for phone number"}
                            >
                              Call
                            </a>
                            <button
                              type="button"
                              onClick={shareWithCaregiver}
                              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-violet-500/20 text-violet-200 text-xs font-medium hover:bg-violet-500/30"
                            >
                              Share with caregiver
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
              {pharmaciesList && pharmaciesList.length === 0 && (
                <p className="text-xs text-zinc-500">No pharmacies found within 5 km. Try a different area or increase radius.</p>
              )}
            </div>

            </>
            )}
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

"use client";

import { useCallback, useState } from "react";
import {
  LiveSession,
  type LiveSessionCallbacks,
  type SessionStatus,
  type VoiceState,
} from "@/lib/liveSession";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8080";
const DEFAULT_ELDER_ID = "elder-demo";

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

export default function Home() {
  const [elderId, setElderId] = useState(DEFAULT_ELDER_ID);
  const [status, setStatus] = useState<SessionStatus>("disconnected");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [imageSent, setImageSent] = useState(false);
  const [session, setSession] = useState<LiveSession | null>(null);

  const callbacks: LiveSessionCallbacks = {
    onStatus: setStatus,
    onVoiceState: setVoiceState,
    onError: (msg) => {
      setError(msg);
      setStatus("error");
    },
    onImageSent: () => setImageSent(true),
  };

  const connect = useCallback(() => {
    setError(null);
    setImageSent(false);
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

  const showPill = useCallback(() => {
    setImageSent(false);
    session?.sendImageFromCamera();
  }, [session]);

  const isConnected = status === "connected";

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
            {/* Profile */}
            <div>
              <label
                htmlFor="elder-id"
                className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2"
              >
                Profile
              </label>
              <select
                id="elder-id"
                value={elderId}
                onChange={(e) => setElderId(e.target.value)}
                disabled={isConnected}
                className="w-full h-12 px-4 rounded-xl bg-white/5 border border-white/10 text-white font-medium focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 disabled:opacity-50 transition-all cursor-pointer"
                aria-label="Select profile"
              >
                <option value="elder-demo" className="bg-zinc-900 text-white">
                  Demo Elder
                </option>
              </select>
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
              {imageSent && (
                <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-sm text-emerald-400 font-medium">
                  Image sent. MedMate is looking at it.
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
                  <button
                    type="button"
                    onClick={showPill}
                    className="h-14 w-full rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white font-semibold text-lg shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 hover:from-violet-400 hover:to-purple-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-[#0a0a0f] active:scale-[0.98] transition-all duration-200"
                    aria-label="Show pill or bottle to camera"
                  >
                    Show pill or bottle
                  </button>
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
        </div>
      </div>
    </main>
  );
}

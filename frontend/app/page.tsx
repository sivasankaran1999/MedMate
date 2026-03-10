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
    <main className="min-h-screen bg-[#f0f4f8] text-[#1a365d] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md flex flex-col gap-8">
        <header className="text-center">
          <h1 className="text-2xl font-semibold text-[#2c5282] tracking-tight">
            MedMate
          </h1>
          <p className="mt-1 text-base text-[#4a5568]">
            Voice-first companion for your medications
          </p>
        </header>

        <section className="bg-white rounded-2xl shadow-sm border border-[#e2e8f0] p-6 space-y-5">
          <div>
            <label
              htmlFor="elder-id"
              className="block text-sm font-medium text-[#4a5568] mb-2"
            >
              Who is using MedMate?
            </label>
            <select
              id="elder-id"
              value={elderId}
              onChange={(e) => setElderId(e.target.value)}
              disabled={isConnected}
              className="w-full min-h-[48px] px-4 rounded-xl border border-[#cbd5e0] text-base bg-white text-[#1a365d] focus:outline-none focus:ring-2 focus:ring-[#4299e1] focus:border-transparent disabled:opacity-60"
              aria-label="Select profile"
            >
              <option value="elder-demo">Demo Elder</option>
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-[#4a5568]">
              Status: {statusLabel(status)}
              {voiceState !== "idle" && ` · ${voiceLabel(voiceState)}`}
            </p>
            {error && (
              <p className="text-sm text-[#c53030] bg-[#fff5f5] p-3 rounded-lg" role="alert">
                {error}
              </p>
            )}
            {imageSent && (
              <p className="text-sm text-[#276749] bg-[#f0fff4] p-3 rounded-lg">
                Image sent. MedMate is looking at it.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-4 pt-2">
            {!isConnected ? (
              <button
                type="button"
                onClick={connect}
                className="min-h-[48px] w-full rounded-xl bg-[#2b6cb0] text-white font-medium text-lg shadow-sm hover:bg-[#2c5282] focus:outline-none focus:ring-2 focus:ring-[#4299e1] focus:ring-offset-2 active:scale-[0.98] transition"
                aria-label="Start session"
              >
                Start session
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={voiceState === "listening" ? stopMic : startMic}
                  className="min-h-[48px] w-full rounded-xl font-medium text-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 active:scale-[0.98] transition disabled:opacity-60"
                  style={{
                    backgroundColor: voiceState === "listening" ? "#c53030" : "#2f855a",
                    color: "white",
                  }}
                  aria-label={voiceState === "listening" ? "Stop microphone" : "Start microphone"}
                  aria-pressed={voiceState === "listening"}
                >
                  {voiceState === "listening" ? "Stop microphone" : "Start microphone"}
                </button>
                <button
                  type="button"
                  onClick={showPill}
                  className="min-h-[48px] w-full rounded-xl bg-[#805ad5] text-white font-medium text-lg shadow-sm hover:bg-[#6b46c1] focus:outline-none focus:ring-2 focus:ring-[#9f7aea] focus:ring-offset-2 active:scale-[0.98] transition"
                  aria-label="Show pill or bottle to camera"
                >
                  Show pill or bottle
                </button>
                <button
                  type="button"
                  onClick={disconnect}
                  className="min-h-[48px] w-full rounded-xl border-2 border-[#cbd5e0] text-[#4a5568] font-medium text-lg hover:bg-[#edf2f7] focus:outline-none focus:ring-2 focus:ring-[#a0aec0] focus:ring-offset-2 active:scale-[0.98] transition"
                  aria-label="End session"
                >
                  End session
                </button>
              </>
            )}
          </div>
        </section>

        <p className="text-center text-sm text-[#718096]">
          Allow microphone and camera when asked. You can interrupt MedMate anytime.
        </p>
      </div>
    </main>
  );
}

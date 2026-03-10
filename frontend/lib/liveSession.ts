/**
 * MedMate Live Session: WebSocket to backend, audio capture/playback, send image.
 * Backend sends setup; we only send realtime_input (audio/image) and optional client_content.
 */

const SAMPLE_RATE_CAPTURE = 16000;
const SAMPLE_RATE_PLAYBACK = 24000;

function float32ToPCM16(float32: Float32Array): ArrayBuffer {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s * 0x7fff;
  }
  return int16.buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  // PCM 16-bit: need an even number of bytes (Int16Array requires buffer length % 2 === 0)
  const evenByteLength = bytes.length - (bytes.length % 2);
  if (evenByteLength === 0) return new Float32Array(0);
  const int16 = new Int16Array(bytes.buffer.slice(0, evenByteLength));
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
  return float32;
}

export type SessionStatus = "disconnected" | "connecting" | "connected" | "error";
export type VoiceState = "idle" | "listening" | "speaking";

export interface LiveSessionCallbacks {
  onStatus?: (status: SessionStatus) => void;
  onVoiceState?: (state: VoiceState) => void;
  onError?: (message: string) => void;
  onImageSent?: () => void;
}

export class LiveSession {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private captureNode: AudioWorkletNode | null = null;
  private playbackNode: AudioWorkletNode | null = null;
  private gainNode: GainNode | null = null;
  private mediaStream: MediaStream | null = null;
  private isCapturing = false;
  private playbackContext: AudioContext | null = null;
  private callbacks: LiveSessionCallbacks;
  private backendUrl: string;
  private elderId: string;
  /** Set when we already showed an error from a server message, so onclose doesn't overwrite it */
  private errorShownFromMessage = false;

  constructor(backendUrl: string, elderId: string, callbacks: LiveSessionCallbacks = {}) {
    this.backendUrl = backendUrl.replace(/^http/, "ws").replace(/\/$/, "");
    this.elderId = elderId;
    this.callbacks = callbacks;
  }

  async connect(): Promise<void> {
    this.errorShownFromMessage = false;
    this.callbacks.onStatus?.("connecting");

    const httpBase = this.backendUrl.replace(/^ws/, "http");
    let healthOk = false;
    try {
      const res = await fetch(`${httpBase}/health`, { method: "GET" });
      healthOk = res.ok;
    } catch {
      // fetch failed: backend unreachable (not running, wrong host, or network)
    }

    if (!healthOk) {
      this.callbacks.onStatus?.("error");
      this.callbacks.onError?.(
        `Backend not reachable at ${httpBase}. Start it with: cd backend && uvicorn main:app --reload --port 8080`
      );
      return Promise.reject(new Error("Backend not reachable"));
    }

    const url = `${this.backendUrl}/ws?elder_id=${encodeURIComponent(this.elderId)}`;
    const CONNECT_TIMEOUT_MS = 15000;

    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          this.callbacks.onStatus?.("error");
          this.callbacks.onError?.(err.message);
          reject(err);
        }
      };

      const timer = setTimeout(() => {
        if (this.ws?.readyState === WebSocket.CONNECTING) {
          this.ws.close();
          this.ws = null;
          settle(
            new Error(
              "Connection timed out. Make sure the backend is running (e.g. port 8080) and that nothing is blocking WebSocket connections."
            )
          );
        }
      }, CONNECT_TIMEOUT_MS);

      try {
        this.ws = new WebSocket(url);
      } catch (e) {
        clearTimeout(timer);
        this.callbacks.onStatus?.("error");
        this.callbacks.onError?.("Could not open WebSocket. Check the backend URL.");
        reject(e);
        return;
      }
      this.ws.onopen = () => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        this.callbacks.onStatus?.("connected");
        resolve();
      };
      this.ws.onerror = () => {
        if (!settled) {
          this.callbacks.onStatus?.("error");
          this.callbacks.onError?.(
            `WebSocket failed at ${this.backendUrl}. Backend is up but the session endpoint failed — check backend logs.`
          );
          settle(new Error("WebSocket error"));
        }
      };
      this.ws.onclose = (ev) => {
        clearTimeout(timer);
        this.callbacks.onStatus?.("disconnected");
        if (!settled && ev.code !== 1000 && ev.code !== 1005) {
          if (!this.errorShownFromMessage) {
            const reason =
              ev.reason ||
              (ev.code === 4000 || ev.code === 4010
                ? "Backend reported an error. Check the terminal where uvicorn is running for the real message."
                : "Connection closed.");
            this.callbacks.onError?.(reason);
          }
          settle(new Error(reason));
        }
      };
      this.ws.onmessage = (ev) => this.handleMessage(ev);
    });
  }

  private handleMessage(ev: MessageEvent): void {
    if (ev.data instanceof Blob) {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        if (base64) this.playAudioChunk(base64);
      };
      reader.readAsDataURL(ev.data);
      return;
    }
    try {
      const msg = JSON.parse(ev.data as string);
      if (msg.error) {
        this.errorShownFromMessage = true;
        this.callbacks.onError?.(msg.error);
        return;
      }
      if (msg.setupComplete != null) {
        // Ready for input
      }
      const sc = msg.serverContent;
      if (sc) {
        if (sc.interrupted) {
        this.playbackNode?.port.postMessage("interrupt");
        this.callbacks.onVoiceState?.("idle");
      }
        if (sc.modelTurn?.parts?.length) {
          this.callbacks.onVoiceState?.("speaking");
          for (const part of sc.modelTurn.parts) {
            if (part?.inlineData?.data) {
              this.playAudioChunk(part.inlineData.data);
            }
          }
        }
        if (sc.turnComplete) this.callbacks.onVoiceState?.("idle");
      }
    } catch {
      // ignore parse errors
    }
  }

  private send(obj: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  private playAudioChunk(base64: string): void {
    if (typeof window === "undefined") return;
    this.initPlayback().then(() => {
      if (!this.playbackNode) return;
      const float32 = base64ToFloat32(base64);
      if (float32.length === 0) return;
      this.playbackNode.port.postMessage(float32);
    });
  }

  private async initPlayback(): Promise<void> {
    if (this.playbackNode) return;
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)({
      sampleRate: SAMPLE_RATE_PLAYBACK,
    });
    this.playbackContext = ctx;
    await ctx.audioWorklet.addModule("/audio-processors/playback.worklet.js");
    this.playbackNode = new AudioWorkletNode(ctx, "pcm-processor");
    this.gainNode = ctx.createGain();
    this.gainNode.gain.value = 1;
    this.playbackNode.connect(this.gainNode);
    this.gainNode.connect(ctx.destination);
  }

  async startMic(): Promise<void> {
    if (this.isCapturing || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: SAMPLE_RATE_CAPTURE, echoCancellation: true, noiseSuppression: true },
      });
    } catch (e) {
      this.callbacks.onError?.("Microphone not available. Please allow mic access.");
      return;
    }
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)({
      sampleRate: SAMPLE_RATE_CAPTURE,
    });
    this.audioContext = ctx;
    await ctx.audioWorklet.addModule("/audio-processors/capture.worklet.js");
    this.captureNode = new AudioWorkletNode(ctx, "audio-capture-processor");
    this.captureNode.port.onmessage = (e) => {
      if (e.data?.type === "audio" && e.data.data && this.isCapturing && this.ws?.readyState === WebSocket.OPEN) {
        const pcm = float32ToPCM16(e.data.data as Float32Array);
        const base64 = arrayBufferToBase64(pcm);
        this.send({ realtime_input: { media_chunks: [{ mime_type: "audio/pcm", data: base64 }] } });
      }
    };
    const src = ctx.createMediaStreamSource(this.mediaStream);
    src.connect(this.captureNode);
    this.isCapturing = true;
    this.callbacks.onVoiceState?.("listening");
  }

  stopMic(): void {
    this.isCapturing = false;
    this.callbacks.onVoiceState?.("idle");
    this.captureNode?.disconnect();
    this.captureNode = null;
    this.audioContext?.close();
    this.audioContext = null;
    this.mediaStream?.getTracks().forEach((t) => t.stop());
    this.mediaStream = null;
  }

  async sendImageFromCamera(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } } });
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      } catch (e) {
        this.callbacks.onError?.("Camera not available. Please allow camera access.");
        return;
      }
    }
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => {
        video.play().then(resolve).catch(reject);
      };
      video.onerror = () => reject(new Error("Video load failed"));
    });
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    ctx.drawImage(video, 0, 0);
    stream.getTracks().forEach((t) => t.stop());
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(",")[1];
          if (base64) {
            this.send({ realtime_input: { media_chunks: [{ mime_type: "image/jpeg", data: base64 }] } });
            this.callbacks.onImageSent?.();
          }
        };
        reader.readAsDataURL(blob);
      },
      "image/jpeg",
      0.85
    );
  }

  disconnect(): void {
    this.stopMic();
    this.ws?.close();
    this.ws = null;
    this.playbackNode?.port.postMessage("interrupt");
    this.playbackContext?.close();
    this.playbackNode = null;
    this.playbackContext = null;
    this.gainNode = null;
    this.callbacks.onStatus?.("disconnected");
    this.callbacks.onVoiceState?.("idle");
  }
}

/**
 * MedMate Live Session: WebSocket to backend, audio capture/playback, send image.
 * Backend sends setup; we only send realtime_input (audio/image) and optional client_content.
 */

const SAMPLE_RATE_CAPTURE = 16000;
const SAMPLE_RATE_PLAYBACK = 24000;
/** Pre-buffer before starting playback to avoid distorted first few words (especially on first agent response). */
const MIN_PLAYBACK_BUFFER_MS = 280;
const MIN_PLAYBACK_BUFFER_SAMPLES = Math.round((SAMPLE_RATE_PLAYBACK * MIN_PLAYBACK_BUFFER_MS) / 1000);

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

/** Decode PCM 16-bit little-endian bytes to float32 at 24kHz (API spec). */
function pcmBytesToFloat32LE(bytes: Uint8Array): Float32Array {
  const evenByteLength = bytes.length - (bytes.length % 2);
  if (evenByteLength === 0) return new Float32Array(0);
  const slice = bytes.subarray(0, evenByteLength);
  const int16 = new Int16Array(slice.buffer, slice.byteOffset, slice.length / 2);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
  return float32;
}

function base64ToFloat32LE(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return pcmBytesToFloat32LE(bytes);
}

// API spec: 24kHz, 16-bit PCM little-endian
function base64ToFloat32(base64: string): Float32Array {
  return base64ToFloat32LE(base64);
}

export type SessionStatus = "disconnected" | "connecting" | "connected" | "error";
export type VoiceState = "idle" | "listening" | "speaking";

export interface LiveSessionCallbacks {
  onStatus?: (status: SessionStatus) => void;
  onVoiceState?: (state: VoiceState) => void;
  onError?: (message: string) => void;
  onImageSent?: () => void;
  onCameraOpening?: (opening: boolean) => void;
  /** Called with the live stream so the UI can show a preview; called with null when done. */
  onCameraStream?: (stream: MediaStream | null) => void;
  /** Called when live video feed starts or stops. */
  onLiveVideoActive?: (active: boolean) => void;
  /** Optional: assistant text transcript (when response_modalities includes TEXT). */
  onAssistantText?: (text: string) => void;
  /** Optional: emitted when server indicates the turn was interrupted. */
  onInterrupted?: () => void;
  /** Optional: input audio transcription from the server (user speech). */
  onUserText?: (text: string) => void;
  /** Optional: emitted when the server completes a turn. */
  onTurnComplete?: () => void;
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
  /** Pre-buffer the first chunk(s) to avoid distorted start; flush when we have enough. */
  private playbackBuffer: Float32Array[] = [];
  private playbackBufferSamples = 0;
  private playbackFlushed = false;
  private inModelTurn = false;
  private callbacks: LiveSessionCallbacks;
  private backendUrl: string;
  private elderId: string;
  /** Set when we already showed an error from a server message, so onclose doesn't overwrite it */
  private errorShownFromMessage = false;
  /** Guard against duplicate turnComplete events. */
  private turnCompleteFired = false;
  /** Keep "speaking" (orb visible) until playback can finish; server sends turnComplete when it finishes generating, not when client finishes playing. */
  private idleAfterTurnCompleteTimer: ReturnType<typeof setTimeout> | null = null;
  /** Total samples received this agent turn (for estimating playback duration so orb stays blue until done). */
  private turnPlaybackSamplesTotal = 0;
  /** Live video feed: interval and stream so we can stop. */
  private liveVideoIntervalId: ReturnType<typeof setInterval> | null = null;
  private liveVideoStream: MediaStream | null = null;
  private liveVideoVideoEl: HTMLVideoElement | null = null;

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

    const timezone = typeof Intl !== "undefined" && Intl.DateTimeFormat
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "";
    const url = `${this.backendUrl}/ws?elder_id=${encodeURIComponent(this.elderId)}${timezone ? `&timezone=${encodeURIComponent(timezone)}` : ""}`;
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
          const reason =
            ev.reason ||
            (ev.code === 4000 || ev.code === 4010
              ? "Backend reported an error. Check the terminal where uvicorn is running for the real message."
              : "Connection closed.");
          if (!this.errorShownFromMessage) {
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
      return; // Backend sends only JSON (binary frames decoded to JSON); no Blob audio
    }
    try {
      const msg = JSON.parse(ev.data as string);
      if (msg.error) {
        this.errorShownFromMessage = true;
        this.callbacks.onError?.(msg.error);
        return;
      }
      if (msg.setupComplete != null || msg.setup_complete != null) {
        // Ready for input
      }
      const sc = msg.serverContent ?? msg.server_content;
      if (sc) {
        const extractText = (v: unknown): string | null => {
          if (!v) return null;
          if (typeof v === "string") return v.trim() || null;
          if (Array.isArray(v)) {
            const parts = v.map(extractText).filter(Boolean) as string[];
            return parts.length ? parts.join(" ").trim() : null;
          }
          if (typeof v === "object") {
            const o = v as Record<string, unknown>;
            const t =
              (o.text as string | undefined) ??
              (o.transcript as string | undefined) ??
              (o.transcription as string | undefined);
            if (typeof t === "string" && t.trim()) return t.trim();
            // Some payloads use nested shapes; try common keys.
            const nested =
              o.result ?? o.results ?? o.alternatives ?? o.alternative ?? o.data ?? o.content;
            const n = extractText(nested);
            if (n) return n;
          }
          return null;
        };

        const inTr =
          sc.inputTranscription ??
          sc.input_transcription ??
          sc.inputAudioTranscription ??
          sc.input_audio_transcription;
        const outTr =
          sc.outputTranscription ??
          sc.output_transcription ??
          sc.outputAudioTranscription ??
          sc.output_audio_transcription;

        const inText = extractText(inTr);
        const outText = extractText(outTr);
        if (inText) this.callbacks.onUserText?.(inText);
        if (outText) this.callbacks.onAssistantText?.(outText);

        if (sc.interrupted) {
          if (this.idleAfterTurnCompleteTimer != null) {
            clearTimeout(this.idleAfterTurnCompleteTimer);
            this.idleAfterTurnCompleteTimer = null;
          }
          this.playbackBuffer = [];
          this.playbackBufferSamples = 0;
          this.playbackFlushed = false;
          this.inModelTurn = false;
          this.playbackNode?.port.postMessage("interrupt");
          this.callbacks.onVoiceState?.("idle");
          this.callbacks.onInterrupted?.();
        }
        const modelTurn = sc.modelTurn ?? sc.model_turn;
        const parts = modelTurn?.parts;
        if (parts?.length) {
          if (this.idleAfterTurnCompleteTimer != null) {
            clearTimeout(this.idleAfterTurnCompleteTimer);
            this.idleAfterTurnCompleteTimer = null;
          }
          if (!this.inModelTurn) {
            this.inModelTurn = true;
            this.turnPlaybackSamplesTotal = 0;
            this.playbackBuffer = [];
            this.playbackBufferSamples = 0;
            this.playbackFlushed = false;
          }
          this.turnCompleteFired = false;
          this.callbacks.onVoiceState?.("speaking");
          for (const part of parts) {
            const inlineData = part?.inlineData ?? part?.inline_data;
            const data = inlineData?.data;
            if (data) this.playAudioChunk(data);
          }
        }
        if (sc.turnComplete ?? sc.turn_complete) {
          this.inModelTurn = false;
          this.flushPlaybackBuffer();
          if (this.idleAfterTurnCompleteTimer != null) {
            clearTimeout(this.idleAfterTurnCompleteTimer);
            this.idleAfterTurnCompleteTimer = null;
          }
          const durationMs = Math.round((this.turnPlaybackSamplesTotal / SAMPLE_RATE_PLAYBACK) * 1000);
          const PLAYBACK_GRACE_MS = Math.min(25000, Math.max(2000, durationMs));
          this.idleAfterTurnCompleteTimer = setTimeout(() => {
            this.idleAfterTurnCompleteTimer = null;
            this.callbacks.onVoiceState?.(this.isCapturing ? "listening" : "idle");
          }, PLAYBACK_GRACE_MS);
          if (!this.turnCompleteFired) {
            this.turnCompleteFired = true;
            this.callbacks.onTurnComplete?.();
          }
        }
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

  /** Send a user text message to the agent (e.g. when user clicks End session). Set turnComplete true so the model generates an audio response. */
  sendUserText(text: string, turnComplete = false): void {
    if (!text.trim()) return;
    const payload: { client_content: { turns: Array<{ role: string; parts: Array<{ text: string }> }>; turn_complete?: boolean } } = {
      client_content: {
        turns: [{ role: "user", parts: [{ text: text.trim() }] }],
      },
    };
    if (turnComplete) payload.client_content.turn_complete = true;
    this.send(payload);
  }

  /** Send any buffered audio to the worklet so short responses still play. */
  private flushPlaybackBuffer(): void {
    if (!this.playbackNode || this.playbackBuffer.length === 0) return;
    for (const buf of this.playbackBuffer) this.playbackNode.port.postMessage(buf);
    this.playbackBuffer = [];
    this.playbackBufferSamples = 0;
    this.playbackFlushed = true;
  }

  private playAudioChunk(data: string | number[] | Uint8Array): void {
    if (typeof window === "undefined") return;
    let float32: Float32Array;
    if (typeof data === "string") {
      float32 = base64ToFloat32(data);
    } else if (Array.isArray(data)) {
      float32 = pcmBytesToFloat32LE(new Uint8Array(data));
    } else if (data instanceof Uint8Array) {
      float32 = pcmBytesToFloat32LE(data);
    } else {
      return;
    }
    if (float32.length === 0) return;
    this.turnPlaybackSamplesTotal += float32.length;

    this.initPlayback().then(async () => {
      if (!this.playbackNode) return;
      // Must await resume—otherwise first playback can be choppy when context was suspended
      if (this.playbackContext?.state === "suspended") {
        await this.playbackContext.resume();
      }
      if (this.playbackFlushed) {
        this.playbackNode.port.postMessage(float32);
        return;
      }
      this.playbackBuffer.push(float32);
      this.playbackBufferSamples += float32.length;
      if (this.playbackBufferSamples >= MIN_PLAYBACK_BUFFER_SAMPLES) {
        for (const buf of this.playbackBuffer) this.playbackNode.port.postMessage(buf);
        this.playbackBuffer = [];
        this.playbackBufferSamples = 0;
        this.playbackFlushed = true;
      }
    });
  }

  private async initPlayback(): Promise<void> {
    if (this.playbackNode) return;
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)({
      sampleRate: SAMPLE_RATE_PLAYBACK,
    });
    this.playbackContext = ctx;
    if (ctx.state === "suspended") await ctx.resume();
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
    const ctx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)({
      sampleRate: SAMPLE_RATE_CAPTURE,
    });
    this.audioContext = ctx;
    const src = ctx.createMediaStreamSource(this.mediaStream);

    // Some browsers / environments can throw:
    // "AudioWorkletNode cannot be created: No execution context available."
    // In that case, fall back to ScriptProcessorNode for capture so the demo still works.
    try {
      // Ensure the context is running (required in many browsers before creating worklets)
      if (ctx.state === "suspended") await ctx.resume();
      if (!ctx.audioWorklet) throw new Error("AudioWorklet not available");
      await ctx.audioWorklet.addModule("/audio-processors/capture.worklet.js");
      this.captureNode = new AudioWorkletNode(ctx, "audio-capture-processor");
      this.captureNode.port.onmessage = (e) => {
        if (e.data?.type === "audio" && e.data.data && this.isCapturing && this.ws?.readyState === WebSocket.OPEN) {
          const pcm = float32ToPCM16(e.data.data as Float32Array);
          const base64 = arrayBufferToBase64(pcm);
          this.send({ realtime_input: { media_chunks: [{ mime_type: "audio/pcm", data: base64 }] } });
        }
      };
      src.connect(this.captureNode);
    } catch (err) {
      // Fallback: ScriptProcessorNode (deprecated but widely supported)
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const silence = ctx.createGain();
      silence.gain.value = 0;
      processor.onaudioprocess = (ev) => {
        if (!this.isCapturing || this.ws?.readyState !== WebSocket.OPEN) return;
        const input = ev.inputBuffer.getChannelData(0);
        // Copy buffer because underlying storage is reused by the browser
        const copy = new Float32Array(input.length);
        copy.set(input);
        const pcm = float32ToPCM16(copy);
        const base64 = arrayBufferToBase64(pcm);
        this.send({ realtime_input: { media_chunks: [{ mime_type: "audio/pcm", data: base64 }] } });
      };
      src.connect(processor);
      processor.connect(silence);
      silence.connect(ctx.destination);
      this.callbacks.onError?.(
        `Mic capture fell back to compatibility mode (AudioWorklet unavailable). If this persists, reload the page.`
      );
    }

    this.isCapturing = true;
    this.callbacks.onVoiceState?.("listening");

    // Pre-warm playback context now (user gesture) so first agent response is clear
    void this.initPlayback().then(async () => {
      if (this.playbackContext?.state === "suspended") {
        await this.playbackContext.resume();
      }
    });
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
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.callbacks.onError?.("Not connected. Start a session first.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      this.callbacks.onError?.(
        "Camera not supported in this browser. Use HTTPS or localhost and a modern browser (Chrome, Safari, Edge)."
      );
      return;
    }
    this.callbacks.onCameraOpening?.(true);
    this.callbacks.onCameraStream?.(null);
    let stream: MediaStream;
    try {
      // Request video without facingMode so Mac/laptop camera works (environment = back camera, often fails on desktop)
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
      });
    } catch (e) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      } catch (e2) {
        this.callbacks.onCameraOpening?.(false);
        const err = (e2 ?? e) as DOMException & { message?: string };
        const name = err?.name ?? "";
        const msg = err?.message ?? String(e2 ?? e);
        if (name === "NotAllowedError" || msg.includes("Permission") || msg.includes("denied")) {
          this.callbacks.onError?.(
            "Camera access denied. Click “Show pill or bottle” again and choose Allow when the browser asks. On Mac: System Settings → Privacy & Security → Camera → enable for this browser."
          );
        } else if (name === "NotFoundError" || msg.includes("not found")) {
          this.callbacks.onError?.("No camera found. Connect a camera and try again.");
        } else {
          this.callbacks.onError?.(`Camera error: ${msg || name || "unknown"}. Use localhost or HTTPS.`);
        }
        return;
      }
    }
    // Show stream in UI so user sees camera is on and can allow permission if prompted
    this.callbacks.onCameraStream?.(stream);
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => {
          video.play().then(resolve).catch(reject);
        };
        video.onerror = () => reject(new Error("Video load failed"));
      });
      // Wait for the camera to deliver a real frame (avoid black frame)
      await new Promise<void>((resolve) => {
        if (video.readyState >= 2) {
          resolve();
          return;
        }
        video.onloadeddata = () => resolve();
        setTimeout(resolve, 300);
      });
    } catch (e) {
      this.callbacks.onCameraStream?.(null);
      this.callbacks.onCameraOpening?.(false);
      stream.getTracks().forEach((t) => t.stop());
      this.callbacks.onError?.("Camera stream failed. Please allow camera access and try again.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      this.callbacks.onCameraStream?.(null);
      this.callbacks.onCameraOpening?.(false);
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    ctx.drawImage(video, 0, 0);
    this.callbacks.onCameraStream?.(null);
    stream.getTracks().forEach((t) => t.stop());
    canvas.toBlob(
      (blob) => {
        this.callbacks.onCameraOpening?.(false);
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

  /** Start sending live video feed at ~1 FPS (per Vertex Live API recommendation). */
  async startLiveVideoFeed(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.callbacks.onError?.("Not connected. Start a session first.");
      return;
    }
    if (this.liveVideoIntervalId != null) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.callbacks.onError?.("Camera not supported. Use HTTPS or localhost.");
      return;
    }
    this.callbacks.onCameraOpening?.(true);
    this.callbacks.onCameraStream?.(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
      });
    } catch (e) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      } catch (e2) {
        this.callbacks.onCameraOpening?.(false);
        this.callbacks.onError?.("Camera access denied or not found.");
        return;
      }
    }
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => video.play().then(resolve).catch(reject);
        video.onerror = () => reject(new Error("Video load failed"));
        setTimeout(() => reject(new Error("Timeout")), 5000);
      });
      await new Promise<void>((r) => {
        if (video.readyState >= 2) r();
        else video.onloadeddata = () => r();
        setTimeout(r, 500);
      });
    } catch (e) {
      this.callbacks.onCameraOpening?.(false);
      stream.getTracks().forEach((t) => t.stop());
      this.callbacks.onError?.("Camera stream failed.");
      return;
    }
    this.liveVideoStream = stream;
    this.liveVideoVideoEl = video;
    this.callbacks.onCameraStream?.(stream);
    this.callbacks.onCameraOpening?.(false);
    this.callbacks.onLiveVideoActive?.(true);

    const LIVE_FPS_INTERVAL_MS = 1000;
    this.liveVideoIntervalId = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.liveVideoVideoEl) return;
      const v = this.liveVideoVideoEl;
      if (v.readyState < 2 || v.videoWidth === 0) return;
      const canvas = document.createElement("canvas");
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(v, 0, 0);
      canvas.toBlob(
        (blob) => {
          if (!blob || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = (reader.result as string)?.split(",")[1];
            if (base64) this.send({ realtime_input: { media_chunks: [{ mime_type: "image/jpeg", data: base64 }] } });
          };
          reader.readAsDataURL(blob);
        },
        "image/jpeg",
        0.85
      );
    }, LIVE_FPS_INTERVAL_MS);
  }

  stopLiveVideoFeed(): void {
    if (this.liveVideoIntervalId != null) {
      clearInterval(this.liveVideoIntervalId);
      this.liveVideoIntervalId = null;
    }
    if (this.liveVideoStream) {
      this.liveVideoStream.getTracks().forEach((t) => t.stop());
      this.liveVideoStream = null;
    }
    this.liveVideoVideoEl = null;
    this.callbacks.onCameraStream?.(null);
    this.callbacks.onLiveVideoActive?.(false);
  }

  disconnect(): void {
    if (this.idleAfterTurnCompleteTimer != null) {
      clearTimeout(this.idleAfterTurnCompleteTimer);
      this.idleAfterTurnCompleteTimer = null;
    }
    this.stopMic();
    this.stopLiveVideoFeed();
    this.ws?.close();
    this.ws = null;
    this.playbackNode?.port.postMessage("interrupt");
    this.playbackContext?.close();
    this.playbackNode = null;
    this.playbackContext = null;
    this.gainNode = null;
    this.playbackBuffer = [];
    this.playbackBufferSamples = 0;
    this.playbackFlushed = false;
    this.inModelTurn = false;
    this.callbacks.onStatus?.("disconnected");
    this.callbacks.onVoiceState?.("idle");
  }
}

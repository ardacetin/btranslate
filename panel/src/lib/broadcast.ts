import { getToken, type Direction, type Settings } from './api';

/**
 * Live broadcast controller (framework-free, React subscribes to it).
 *
 * Owns everything the host side of a live event does:
 *   - the host WebSocket (first-message auth, ownership/close codes, backoff),
 *   - DeepL engine: browser speech recognition → transcript messages, with
 *     sentence/word/silence flushing,
 *   - OpenAI engine: raw PCM16 @24 kHz microphone streaming,
 *   - microphone selection and the live input-level meter.
 *
 * This is a port of the previous host page logic; protocol and behaviour are
 * unchanged.
 */

export const EVENT_CODE = 'LIVE';

export type TranslatorState = 'unknown' | 'connected' | 'disconnected' | 'reconnecting';

export interface Mic { id: string; label: string; }

export interface BroadcastState {
  running: boolean;          // user pressed start and hasn't stopped
  live: boolean;             // server confirmed + capture running
  statusText: string;
  engine: 'deepl' | 'openai';
  translator: TranslatorState;
  participants: number;
  level: number;             // 0..100 input level
  monitoring: boolean;
  mics: Mic[];
  micId: string;
  directions: Direction[];
  directionIndex: number;
}

type FlushCfg = Pick<Settings, 'flush_on_punctuation' | 'max_words' | 'silence_ms'>;

const DEFAULT_DIRECTIONS: Direction[] = [
  { id: 'tr-en', source: 'tr', target: 'en', label: 'Türkçe → İngilizce' },
  { id: 'en-tr', source: 'en', target: 'tr', label: 'İngilizce → Türkçe' },
];
const SENTENCE_END = /[.!?…]["'’”)\]]?\s*$/;

// Minimal Web Speech API typings (not in lib.dom for all TS versions).
interface SRAlternative { transcript: string }
interface SRResult { isFinal: boolean; 0: SRAlternative; length: number }
interface SREvent { resultIndex: number; results: ArrayLike<SRResult> }
interface SpeechRecognitionLike {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void;
}
type SRCtor = new () => SpeechRecognitionLike;
function srCtor(): SRCtor | null {
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

type Listener = () => void;

export class BroadcastController {
  private state: BroadcastState;
  private listeners = new Set<Listener>();

  /** Hooks the UI provides. */
  onToast: (msg: string, status?: 'error' | 'success' | 'neutral') => void = () => {};
  onAuthExpired: () => void = () => {};
  /** Current event name (empty on a resumed session = server keeps its title). */
  getEventName: () => string = () => '';
  onServerTitle: (title: string) => void = () => {};

  private socket: WebSocket | null = null;
  private manualStop = false;
  private retry = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private captureStarted = false;
  private flush: FlushCfg = { flush_on_punctuation: true, max_words: 12, silence_ms: 500 };

  // speech recognition
  private recognition: SpeechRecognitionLike | null = null;
  private recognizing = false;
  private flushing = false;
  private silenceTimer: ReturnType<typeof setTimeout> | undefined;
  private lastRecogError = '';
  private recogBackoff = 0;

  // OpenAI audio capture
  private micStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private audioNodes: AudioNode[] = [];

  // level monitor
  private monStream: MediaStream | null = null;
  private monCtx: AudioContext | null = null;
  private monRaf = 0;

  constructor() {
    let micId = '';
    let directionIndex = 0;
    try {
      micId = localStorage.getItem('bt_mic') || '';
      const saved = localStorage.getItem('bt_direction');
      const i = DEFAULT_DIRECTIONS.findIndex((d) => d.id === saved);
      if (i >= 0) directionIndex = i;
    } catch { /* ignore */ }
    this.state = {
      running: false, live: false, statusText: 'Yayına hazır', engine: 'deepl',
      translator: 'unknown', participants: 0, level: 0, monitoring: false,
      mics: [], micId, directions: DEFAULT_DIRECTIONS, directionIndex,
    };
    navigator.mediaDevices?.addEventListener?.('devicechange', () => { void this.refreshMics(); });
  }

  // ── store plumbing ────────────────────────────────────────────────────
  subscribe = (fn: Listener) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getState = () => this.state;
  private set(patch: Partial<BroadcastState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  // ── configuration ─────────────────────────────────────────────────────
  setFlushConfig(cfg: FlushCfg) { this.flush = cfg; }

  setDirections(list: Direction[]) {
    if (!list.length) return;
    let saved = '';
    try { saved = localStorage.getItem('bt_direction') || ''; } catch { /* ignore */ }
    const i = Math.max(0, list.findIndex((d) => d.id === saved));
    this.set({ directions: list, directionIndex: i });
  }

  get direction(): Direction { return this.state.directions[this.state.directionIndex] || DEFAULT_DIRECTIONS[0]; }

  selectDirection(id: string) {
    const directionIndex = this.state.directions.findIndex((d) => d.id === id);
    if (directionIndex < 0 || directionIndex === this.state.directionIndex) return;
    this.set({ directionIndex });
    try { localStorage.setItem('bt_direction', this.direction.id); } catch { /* ignore */ }
    if (this.socketOpen()) {
      this.socket!.send(JSON.stringify({ type: 'direction', source: this.direction.source, target: this.direction.target }));
      this.restartRecognition();
    }
  }

  // ── host socket ───────────────────────────────────────────────────────
  private socketOpen() { return this.socket !== null && this.socket.readyState === WebSocket.OPEN; }

  start() {
    this.manualStop = false;
    this.captureStarted = false;
    this.retry = 0;
    this.set({ running: true, statusText: 'Bağlanıyor…' });
    this.openSocket();
  }

  private openSocket() {
    clearTimeout(this.reconnectTimer);
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    // The token goes in the first message, never in the URL (URLs end up in proxy logs).
    const ws = new WebSocket(`${proto}//${location.host}/ws/host/${EVENT_CODE}`);
    this.socket = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token: getToken() }));
      this.set({ statusText: 'Başlatılıyor…' });
    };
    ws.onmessage = (e) => {
      let m: Record<string, unknown>;
      try { m = JSON.parse(String(e.data)); } catch { return; }
      switch (m.type) {
        case 'auth_ok': {
          this.retry = 0;
          const d = this.direction;
          ws.send(JSON.stringify({ type: 'start', title: this.getEventName().trim(), source: d.source, target: d.target }));
          clearInterval(this.pingTimer);
          this.pingTimer = setInterval(() => { if (this.socketOpen()) this.socket!.send(JSON.stringify({ type: 'ping' })); }, 25000);
          break;
        }
        case 'participants':
          this.set({ participants: Number(m.count) || 0 });
          break;
        case 'config':
          this.set({ engine: m.engine === 'openai' ? 'openai' : 'deepl' });
          if (typeof m.title === 'string' && m.title) this.onServerTitle(m.title);
          this.startCapture();
          break;
        case 'status':
        case 'service':
          if (typeof m.connected === 'boolean') this.set({ translator: m.connected ? 'connected' : 'disconnected' });
          break;
        case 'reconnecting':
          this.set({ translator: 'reconnecting' });
          break;
        case 'error':
          if (m.code === 'start_failed') { this.onToast('Yayın başlatılamadı (sunucu hatası). Tekrar deneyin.', 'error'); this.stop(); }
          break;
        default:
          break;
      }
    };
    ws.onclose = (ev) => {
      if (this.socket !== ws) return; // an older socket closing after we moved on
      clearInterval(this.pingTimer);
      if (this.manualStop) return;
      if (ev.code === 4401) { // token revoked / expired: retrying can't help
        this.stop();
        this.onToast('Oturumunuz sona erdi, lütfen tekrar giriş yapın.', 'error');
        setTimeout(() => this.onAuthExpired(), 1500);
        return;
      }
      if (ev.code === 4409) { // another host panel took over the event
        this.stop('Yayın başka bir panelden devralındı');
        this.onToast('Yayın başka bir yönetim panelinden devralındı.', 'neutral');
        return;
      }
      this.set({ live: false, statusText: 'Bağlantı yeniden kuruluyor…' });
      // Exponential backoff with jitter (1 s → 30 s).
      const delay = Math.min(30000, 1000 * 2 ** this.retry) + Math.floor(Math.random() * 500);
      this.retry = Math.min(this.retry + 1, 5);
      this.reconnectTimer = setTimeout(() => { if (!this.manualStop) this.openSocket(); }, delay);
    };
    ws.onerror = () => {};
  }

  stop(statusText = 'Yayın durduruldu') {
    this.manualStop = true;
    this.captureStarted = false;
    clearInterval(this.pingTimer);
    clearTimeout(this.reconnectTimer);
    this.retry = 0;
    this.stopRecognition();
    this.stopAudioCapture();
    const ws = this.socket;
    this.socket = null;
    if (ws) {
      try { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' })); } catch { /* ignore */ }
      ws.close();
    }
    this.set({ running: false, live: false, statusText, translator: 'unknown', level: 0 });
  }

  // ── capture ───────────────────────────────────────────────────────────
  private startCapture() {
    if (this.captureStarted) return; // don't double-start on reconnect
    this.captureStarted = true;
    this.stopMonitor();
    if (this.state.engine === 'openai') {
      this.startAudioCapture()
        .then(() => this.set({ live: true, statusText: 'Dinleniyor…' }))
        .catch(() => { this.onToast('Mikrofon erişimi reddedildi', 'error'); this.stop(); });
    } else {
      if (!srCtor()) {
        this.onToast('Bu tarayıcı konuşma tanımayı desteklemiyor. OpenAI motorunu seçin ya da Chrome/Edge kullanın.', 'error');
        this.stop();
        return;
      }
      this.set({ live: true, statusText: 'Dinleniyor…' });
      this.startRecognition();
    }
  }

  private recognitionLang() { return this.direction.source === 'tr' ? 'tr-TR' : 'en-US'; }

  private startRecognition() {
    const SR = srCtor();
    if (!SR) return;
    const rec = new SR();
    this.recognition = rec;
    rec.lang = this.recognitionLang();
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (event) => {
      let interim = '';
      let finalChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalChunk += r[0].transcript; else interim += r[0].transcript;
      }
      if (!this.socketOpen()) return;
      this.recogBackoff = 0;
      if (interim.trim()) {
        this.set({ statusText: 'Konuşma algılandı' });
        this.socket!.send(JSON.stringify({ type: 'transcript', final: false, text: interim }));
        // Flush sentence-by-sentence: on a sentence ending, or once the phrase
        // gets long, so the audience never waits on a whole paragraph.
        const t = interim.trim();
        const byPunct = this.flush.flush_on_punctuation && SENTENCE_END.test(t);
        const byWords = this.flush.max_words > 0 && t.split(/\s+/).length >= this.flush.max_words;
        if (byPunct || byWords) this.flushSegment(); else this.armSilenceTimer();
      }
      if (finalChunk.trim()) {
        this.clearSilenceTimer();
        this.socket!.send(JSON.stringify({ type: 'transcript', final: true, text: finalChunk }));
        this.set({ statusText: 'Dinleniyor…' });
      }
    };
    rec.onerror = (e) => {
      this.lastRecogError = e.error || 'unknown';
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.onToast('Mikrofon izni reddedildi.', 'error');
        this.stop();
      }
    };
    rec.onend = () => {
      this.recognizing = false;
      this.flushing = false;
      if (this.manualStop || this.recognition !== rec) return;
      // 'no-speech'/'aborted' are routine (our own flushes end this way):
      // restart at once. Real failures (network, audio-capture…) back off.
      const failed = this.lastRecogError && this.lastRecogError !== 'no-speech' && this.lastRecogError !== 'aborted';
      this.lastRecogError = '';
      if (!failed) {
        this.recogBackoff = 0;
        try { rec.start(); this.recognizing = true; } catch { /* already started */ }
        return;
      }
      this.recogBackoff = Math.min(8000, Math.max(500, this.recogBackoff * 2));
      this.set({ statusText: 'Konuşma tanıma yeniden deneniyor…' });
      setTimeout(() => {
        if (!this.manualStop && this.recognition === rec) {
          try { rec.start(); this.recognizing = true; } catch { /* ignore */ }
        }
      }, this.recogBackoff);
    };
    try { rec.start(); this.recognizing = true; } catch { /* ignore */ }
  }

  /** Force the engine to emit its final result now (flushes the current phrase). */
  private flushSegment() {
    this.clearSilenceTimer();
    if (this.flushing || !this.recognizing || !this.recognition) return;
    this.flushing = true;
    try { this.recognition.stop(); } catch { this.flushing = false; }
  }
  private armSilenceTimer() {
    this.clearSilenceTimer();
    this.silenceTimer = setTimeout(() => this.flushSegment(), this.flush.silence_ms || 500);
  }
  private clearSilenceTimer() { clearTimeout(this.silenceTimer); this.silenceTimer = undefined; }
  private stopRecognition() {
    this.clearSilenceTimer();
    const rec = this.recognition;
    this.recognition = null;
    if (rec) { rec.onend = null; try { rec.stop(); } catch { /* ignore */ } }
    this.recognizing = false;
  }
  private restartRecognition() {
    if (!this.recognizing) return;
    this.stopRecognition();
    this.startRecognition();
  }

  // OpenAI engine: raw PCM16 @24 kHz
  private async startAudioCapture() {
    const micId = this.state.micId;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, ...(micId ? { deviceId: { exact: micId } } : {}) },
      video: false,
    });
    this.micStream = stream;
    const ctx = new AudioContext({ sampleRate: 24000 });
    this.audioCtx = ctx;
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const silent = ctx.createGain();
    silent.gain.value = 0.00001;
    src.connect(proc); proc.connect(silent); silent.connect(ctx.destination);
    this.audioNodes = [proc, silent, src];
    proc.onaudioprocess = (e) => {
      if (!this.socketOpen()) return;
      const f32 = e.inputBuffer.getChannelData(0);
      this.reportLevel(f32);
      // On a congested uplink drop audio rather than queueing a growing backlog.
      if (this.socket!.bufferedAmount > 512 * 1024) return;
      const data = ctx.sampleRate === 24000 ? f32 : downsample(f32, ctx.sampleRate, 24000);
      this.socket!.send(floatToPCM16(data).buffer);
    };
  }
  private stopAudioCapture() {
    this.audioNodes.forEach((n) => { try { n.disconnect(); } catch { /* ignore */ } });
    this.audioNodes = [];
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    if (this.audioCtx) { void this.audioCtx.close().catch(() => {}); this.audioCtx = null; }
  }

  private lastLevelAt = 0;
  private reportLevel(samples: Float32Array | number[], scale = 1) {
    const now = performance.now();
    if (now - this.lastLevelAt < 60) return; // ~16 fps is plenty for a meter
    this.lastLevelAt = now;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) { const v = samples[i] * scale; sum += v * v; }
    this.set({ level: Math.min(100, (Math.sqrt(sum / samples.length) / 0.3) * 100) });
  }

  // ── microphones & level monitor ───────────────────────────────────────
  async refreshMics() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices.filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({ id: d.deviceId, label: d.label || `Mikrofon ${i + 1}` }));
      const micId = mics.some((m) => m.id === this.state.micId) ? this.state.micId : '';
      this.set({ mics, micId });
    } catch { /* ignore */ }
  }

  selectMic(micId: string) {
    try { localStorage.setItem('bt_mic', micId); } catch { /* ignore */ }
    this.set({ micId });
    if (this.state.monitoring) void this.startMonitor();
  }

  async toggleMonitor() {
    if (this.state.monitoring) this.stopMonitor(); else await this.startMonitor();
  }

  async startMonitor() {
    this.stopMonitor();
    const micId = this.state.micId;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(micId ? { deviceId: { exact: micId } } : {}) },
        video: false,
      });
    } catch {
      this.onToast('Mikrofona erişilemedi', 'error');
      return;
    }
    this.monStream = stream;
    this.set({ monitoring: true });
    try {
      const ctx = new AudioContext();
      this.monCtx = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const loop = () => {
        if (!this.monCtx) return;
        analyser.getByteTimeDomainData(data);
        const centered = Array.from(data, (v) => (v - 128) / 128);
        this.reportLevel(centered);
        this.monRaf = requestAnimationFrame(loop);
      };
      loop();
    } catch { /* meter is optional */ }
    void this.refreshMics(); // labels become available once permission is granted
  }

  stopMonitor() {
    cancelAnimationFrame(this.monRaf);
    this.monStream?.getTracks().forEach((t) => t.stop());
    this.monStream = null;
    if (this.monCtx) { void this.monCtx.close().catch(() => {}); this.monCtx = null; }
    if (this.state.monitoring || this.state.level) this.set({ monitoring: false, level: this.state.live ? this.state.level : 0 });
  }
}

function downsample(buf: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return buf;
  const r = from / to;
  const n = Math.floor(buf.length / r);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf[Math.floor(i * r)];
  return out;
}

function floatToPCM16(f32: Float32Array): Int16Array {
  const i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return i16;
}

export const broadcast = new BroadcastController();

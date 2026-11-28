/** 外部素材を使わず、Web Audio の波形と自作の音列でスクリーンの音を作る。 */
export type SoundEffect = "join" | "countdown" | "start" | "goal" | "fell";
export interface AudioState {
  ready: boolean;
  muted: boolean;
  unavailable: boolean;
}
export interface ScreenAudio {
  unlock(): void;
  play(effect: SoundEffect): void;
  setPlaying(playing: boolean): void;
  setMuted(muted: boolean): void;
  dispose(): void;
}

// [開始秒, 周波数 Hz, 長さ秒, 終わりの周波数 Hz（滑降音だけ）]
type Note = readonly [number, number, number, number?];
const EFFECTS: Record<SoundEffect, readonly Note[]> = {
  join: [
    [0, 659.25, 0.1],
    [0.1, 880, 0.18],
  ],
  countdown: [[0, 523.25, 0.12]],
  start: [
    [0, 1046.5, 0.3],
    [0, 783.99, 0.3],
  ],
  goal: [
    [0, 523.25, 0.12],
    [0.12, 659.25, 0.12],
    [0.24, 783.99, 0.12],
    [0.36, 1046.5, 0.45],
  ],
  fell: [
    [0, 330, 0.4, 82.41],
    [0.1, 196, 0.35, 65.41],
  ],
};
// 120 BPM、8小節。跳ねる短いメロディーとベースを低い音量で繰り返す。
const MELODY = [
  72, 0, 76, 79, 0, 76, 74, 0, 72, 76, 0, 79, 81, 0, 79, 0, 69, 0, 72, 76, 0, 72, 71, 0, 69, 72, 0,
  76, 79, 0, 76, 0, 65, 0, 69, 72, 0, 74, 72, 0, 69, 72, 0, 77, 76, 0, 72, 0, 67, 0, 71, 74, 0, 76,
  74, 0, 71, 74, 0, 79, 74, 71, 72, 0,
];
const BASS = [48, 45, 41, 43];
const STEP_S = 0.25;
const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

export class SynthAudio implements ScreenAudio {
  private context: AudioContext | undefined;
  private master: GainNode | undefined;
  private readonly voices = new Map<OscillatorNode, { gain: GainNode; bgm: boolean }>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private playing = false;
  private muted = false;
  private disposed = false;
  private resuming = false;
  private step = 0;
  private nextAt = 0;
  private readonly onChange: (state: AudioState) => void;

  constructor(onChange: (state: AudioState) => void = () => {}) {
    this.onChange = onChange;
  }

  // 必ずキー／クリックのハンドラー内で呼ぶ。操作前の出来事は再生予約しない。
  unlock(): void {
    if (this.disposed || this.resuming) return;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = this.muted ? 0 : 0.6;
        this.master.connect(this.context.destination);
        this.context.onstatechange = () => {
          if (this.disposed) return;
          this.notify();
          this.syncMusic();
        };
      }
      if (this.context.state === "running") return;
      this.resuming = true;
      void this.context
        .resume()
        .then(() => {
          this.resuming = false;
          if (this.disposed) return;
          this.notify();
          this.syncMusic();
        })
        .catch(() => {
          this.resuming = false;
          if (!this.disposed) this.notify();
        });
    } catch {
      this.onChange({ ready: false, muted: this.muted, unavailable: true });
    }
  }

  play(effect: SoundEffect): void {
    const ctx = this.context;
    // resume が完了する前でも、最初の操作で始まるカウントダウンは予約する。
    if (!ctx || this.disposed || this.muted || (ctx.state !== "running" && !this.resuming)) return;
    for (const [offset, frequency, duration, end] of EFFECTS[effect]) {
      this.note(ctx.currentTime + offset, frequency, duration, 0.13, false, end);
    }
  }

  setPlaying(playing: boolean): void {
    if (this.disposed || this.playing === playing) return;
    this.playing = playing;
    this.syncMusic();
  }

  setMuted(muted: boolean): void {
    if (this.disposed || this.muted === muted) return;
    this.muted = muted;
    if (this.context && this.master) {
      this.master.gain.setValueAtTime(muted ? 0 : 0.6, this.context.currentTime);
    }
    // ミュート中に予約済みだった効果音を、解除したときに鳴らさない。
    if (muted) this.stopVoices(false);
    this.syncMusic();
    this.notify();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.timer);
    this.stopVoices(false);
    if (this.context) {
      this.context.onstatechange = null;
      void this.context.close().catch(() => {});
    }
  }

  private notify(): void {
    this.onChange({
      ready: this.context?.state === "running",
      muted: this.muted,
      unavailable: false,
    });
  }

  private syncMusic(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.stopVoices(true);
    if (this.disposed || !this.playing || this.muted || this.context?.state !== "running") return;
    this.step = 0;
    this.nextAt = this.context.currentTime + 0.02;
    this.scheduleMusic();
    this.timer = setInterval(() => this.scheduleMusic(), 50);
  }

  private scheduleMusic(): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== "running") return;
    // バックグラウンドから戻ったとき、過去の音をまとめて鳴らさない。
    if (this.nextAt < ctx.currentTime) this.nextAt = ctx.currentTime + 0.02;
    while (this.nextAt < ctx.currentTime + 0.15) {
      const pitch = MELODY[this.step % MELODY.length]!;
      if (pitch) this.note(this.nextAt, hz(pitch), 0.16, 0.035, true);
      if (this.step % 2 === 0) {
        this.note(
          this.nextAt,
          hz(BASS[Math.floor(this.step / 16) % BASS.length]!),
          0.22,
          0.045,
          true,
        );
      }
      this.nextAt += STEP_S;
      this.step++;
    }
  }

  private note(
    at: number,
    frequency: number,
    duration: number,
    volume: number,
    bgm: boolean,
    end?: number,
  ): void {
    const ctx = this.context!;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = bgm ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(frequency, at);
    if (end) oscillator.frequency.exponentialRampToValueAtTime(end, at + duration);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(volume, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain);
    gain.connect(this.master!);
    this.voices.set(oscillator, { gain, bgm });
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      this.voices.delete(oscillator);
    };
    oscillator.start(at);
    oscillator.stop(at + duration + 0.01);
  }

  private stopVoices(onlyMusic: boolean): void {
    for (const [voice, { gain, bgm }] of this.voices) {
      if (onlyMusic && !bgm) continue;
      voice.stop();
      voice.disconnect();
      gain.disconnect();
      this.voices.delete(voice);
    }
  }
}

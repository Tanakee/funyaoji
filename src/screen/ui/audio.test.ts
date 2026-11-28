import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { SynthAudio } from "./audio.ts";

const param = () => ({
  value: 0,
  setValueAtTime: vi.fn(),
  linearRampToValueAtTime: vi.fn(),
  exponentialRampToValueAtTime: vi.fn(),
});
const gainNode = () => ({ gain: param(), connect: vi.fn(), disconnect: vi.fn() });
const oscillatorNode = () => ({
  frequency: param(),
  type: "sine",
  connect: vi.fn(),
  disconnect: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  onended: null,
});
class FakeContext {
  static latest: FakeContext;
  state = "suspended";
  destination = {};
  onstatechange: (() => void) | null = null;
  gains: ReturnType<typeof gainNode>[] = [];
  oscillators: ReturnType<typeof oscillatorNode>[] = [];
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });
  constructor() {
    FakeContext.latest = this;
  }
  get currentTime() {
    return Date.now() / 1000;
  }
  createGain() {
    const gain = gainNode();
    this.gains.push(gain);
    return gain;
  }
  createOscillator() {
    const oscillator = oscillatorNode();
    this.oscillators.push(oscillator);
    return oscillator;
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", FakeContext);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SynthAudio", () => {
  it("操作前の音を捨て、resume 中でも最初のカウント音を予約する", async () => {
    const changed = vi.fn();
    const audio = new SynthAudio(changed);
    audio.play("join");
    expect(changed).not.toHaveBeenCalled();
    audio.unlock();
    const ctx = FakeContext.latest;
    audio.play("countdown");
    expect(ctx.oscillators).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(changed).toHaveBeenLastCalledWith({ ready: true, muted: false, unavailable: false });
    expect(ctx.oscillators).toHaveLength(1);
    audio.dispose();
  });

  it("BGM を重ねず、停止後の予約とタイマーを消す", async () => {
    const audio = new SynthAudio();
    audio.unlock();
    await vi.advanceTimersByTimeAsync(0);
    const ctx = FakeContext.latest;
    audio.setPlaying(true);
    expect(vi.getTimerCount()).toBe(1);
    const first = ctx.oscillators.length;
    audio.setPlaying(true);
    expect(ctx.oscillators).toHaveLength(first);
    await vi.advanceTimersByTimeAsync(17_000); // 16秒の1周を超えて続く
    expect(ctx.oscillators.at(-1)!.start.mock.calls[0]![0]).toBeGreaterThan(ctx.currentTime - 0.3);
    audio.setPlaying(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(ctx.oscillators.every((o) => o.disconnect.mock.calls.length > 0)).toBe(true);
    const stopped = ctx.oscillators.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.oscillators).toHaveLength(stopped);
    audio.dispose();
  });

  it("ミュートは全音を止め、解除時は BGM だけを再開する", async () => {
    const audio = new SynthAudio();
    audio.unlock();
    await vi.advanceTimersByTimeAsync(0);
    const ctx = FakeContext.latest;
    audio.setPlaying(true);
    audio.play("goal");
    audio.setMuted(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(ctx.gains[0]!.gain.setValueAtTime).toHaveBeenLastCalledWith(0, ctx.currentTime);
    expect(ctx.oscillators.every((o) => o.disconnect.mock.calls.length > 0)).toBe(true);
    const muted = ctx.oscillators.length;
    audio.play("join");
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.oscillators).toHaveLength(muted);
    audio.setMuted(false);
    expect(vi.getTimerCount()).toBe(1);
    expect(ctx.oscillators.slice(muted).every((o) => o.type === "triangle")).toBe(true);
    audio.dispose();
    audio.dispose();
    expect(ctx.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("音が利用できない環境でも例外を投げず知らせる", () => {
    vi.stubGlobal("AudioContext", undefined);
    const changed = vi.fn();
    const audio = new SynthAudio(changed);
    expect(() => audio.unlock()).not.toThrow();
    expect(changed).toHaveBeenLastCalledWith({ ready: false, muted: false, unavailable: true });
    expect(() => {
      audio.play("fell");
      audio.setPlaying(true);
      audio.dispose();
    }).not.toThrow();
  });

  it("resume が失敗しても再操作で試せ、破棄後に BGM を再開しない", async () => {
    const audio = new SynthAudio();
    audio.unlock();
    await vi.advanceTimersByTimeAsync(0);
    const ctx = FakeContext.latest;
    ctx.state = "suspended";
    ctx.resume.mockRejectedValueOnce(new Error("blocked"));
    audio.unlock();
    await vi.advanceTimersByTimeAsync(0);
    audio.unlock();
    audio.setPlaying(true);
    audio.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(ctx.close).toHaveBeenCalledOnce();
  });
});

import { describe, expect, it } from "vitest";
import { buildAudioConstraints, resolveAudioMode } from "./audioMode";

describe("audioMode", () => {
  it("resolveAudioMode mengembalikan 'raw' secara bawaan tanpa parameter", () => {
    expect(resolveAudioMode("")).toBe("raw");
    expect(resolveAudioMode("?")).toBe("raw");
    expect(resolveAudioMode("?record=1&debug=1")).toBe("raw");
  });

  it("resolveAudioMode mengembalikan 'default' saat ?std_audio=1 diberikan", () => {
    expect(resolveAudioMode("?std_audio=1")).toBe("default");
    expect(resolveAudioMode("?record=1&std_audio=1")).toBe("default");
  });

  it("resolveAudioMode tetap menerima ?raw_audio=1 dan mengembalikan 'raw'", () => {
    expect(resolveAudioMode("?raw_audio=1")).toBe("raw");
    expect(resolveAudioMode("?record=1&raw_audio=1")).toBe("raw");
  });

  it("resolveAudioMode memenangkan std_audio=1 jika muncul bersamaan dengan raw_audio=1", () => {
    expect(resolveAudioMode("?raw_audio=1&std_audio=1")).toBe("default");
    expect(resolveAudioMode("?std_audio=1&raw_audio=1")).toBe("default");
  });

  it("buildAudioConstraints menghasilkan objek constraint raw (EC/NS/AGC false) atau true untuk default", () => {
    expect(buildAudioConstraints("raw")).toEqual({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
    expect(buildAudioConstraints("default")).toBe(true);
  });
});

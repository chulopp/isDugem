export type AudioMode = "raw" | "default";

export interface RawAudioTrackConstraints {
  echoCancellation: false;
  noiseSuppression: false;
  autoGainControl: false;
}

/**
 * Menentukan mode audio dari query string URL (mis. window.location.search).
 * - Bawaan (tanpa parameter) = "raw"
 * - ?std_audio=1 = "default"
 * - ?raw_audio=1 = "raw" (kompatibilitas link lama)
 * - Jika std_audio=1 dan raw_audio=1 muncul bersamaan, std_audio menang ("default")
 */
export function resolveAudioMode(search: string): AudioMode {
  const normalized = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(normalized);
  if (params.get("std_audio") === "1") {
    return "default";
  }
  if (params.get("raw_audio") === "1") {
    return "raw";
  }
  return "raw";
}

/**
 * Membangun nilai constraint `audio` untuk navigator.mediaDevices.getUserMedia({ audio: ... }).
 */
export function buildAudioConstraints(
  mode: AudioMode
): RawAudioTrackConstraints | true {
  if (mode === "default") {
    return true;
  }
  return {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  };
}

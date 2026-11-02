export const EVENT_MIN_GAP_MS = 500;
export const PERIODIC_MIN_GAP_MS = 800;
export const ZONE_HYSTERESIS_DB = 2.0;
export const DB_JUMP_THRESHOLD = 6.0;

export function getAudioZone(db: number): number {
  if (db < 55.0) return 0;
  if (db < 65.0) return 1;
  if (db <= 75.0) return 2;
  if (db <= 80.0) return 3;
  return 4;
}

export interface AudioEventPublishCheckInput {
  effectiveDb: number;
  lastPublishedDb: number;
  lastPublishedZone: number;
  nowMs: number;
  lastPublishMs: number;
}

/**
 * Menentukan apakah perubahan audio pada tick 200 ms harus memicu pengiriman
 * paket telemetri kejadian (event-driven):
 * - zoneChanged hanya dihitung bila zona berbeda DAN |effectiveDb - lastPublishedDb| >= 2.0 dB
 * - dbJump bila |effectiveDb - lastPublishedDb| >= 6.0 dB
 * - jeda minimal terhadap paket terakhir (jenis apa pun): 500 ms
 */
export function shouldPublishOnAudioEvent(
  input: AudioEventPublishCheckInput
): boolean {
  const {
    effectiveDb,
    lastPublishedDb,
    lastPublishedZone,
    nowMs,
    lastPublishMs,
  } = input;

  if (nowMs - lastPublishMs < EVENT_MIN_GAP_MS) {
    return false;
  }

  const currentZone = getAudioZone(effectiveDb);
  const dbDelta = Math.abs(effectiveDb - lastPublishedDb);
  const zoneChanged =
    currentZone !== lastPublishedZone && dbDelta >= ZONE_HYSTERESIS_DB;
  const dbJump = dbDelta >= DB_JUMP_THRESHOLD;

  return zoneChanged || dbJump;
}

/**
 * Menentukan apakah tick timer periodik 1000 ms perlu mengirim paket:
 * dilewati bila sudah ada publish (jenis apa pun) dalam 800 ms terakhir.
 */
export function shouldPublishOnPeriodicTick(
  nowMs: number,
  lastPublishMs: number
): boolean {
  return nowMs - lastPublishMs >= PERIODIC_MIN_GAP_MS;
}

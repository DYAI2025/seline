// Viseme types and mapping from avatar-realtime

export interface VisemeCue {
  time: number;
  shape: string;
  weight: number;
  duration: number;
}

// Rhubarb shape to ARKit blendshape mapping
export const RHUBARB_TO_ARKIT: Record<string, Record<string, number>> = {
  X: {},
  A: { jawOpen: 0, mouthClose: 1 },
  B: { jawOpen: 0.2, mouthClose: 0 },
  C: { jawOpen: 0.5, mouthFunnel: 0.3, mouthOpen: 0.7 },
  D: { jawOpen: 0.8, mouthOpen: 1.0 },
  E: { jawOpen: 0.4, mouthPucker: 0.6 },
  F: { jawOpen: 0.2, mouthPucker: 0.9 },
  G: { jawOpen: 0.1, mouthFunnel: 0.5, mouthClose: 0.3 },
  H: { jawOpen: 0.3, mouthOpen: 0.4 },
};

// Rhubarb JSON output shape
interface RhubarbOutput {
  mouthCues: Array<{ start: number; end: number; value: string }>;
}

export function mapRhubarbToVisemes(rhubarb: RhubarbOutput): VisemeCue[] {
  return rhubarb.mouthCues.map((cue) => ({
    time: cue.start,
    shape: cue.value,
    weight: 1.0,
    duration: cue.end - cue.start,
  }));
}

const LERP_DURATION = 0.08; // 80ms smooth transition

export function interpolateVisemes(
  visemes: VisemeCue[],
  currentTime: number,
): Record<string, number> {
  if (visemes.length === 0) return {};

  // Find current and next cue
  let currentCue: VisemeCue | null = null;
  let nextCue: VisemeCue | null = null;

  for (let i = 0; i < visemes.length; i++) {
    const cue = visemes[i];
    if (currentTime >= cue.time && currentTime < cue.time + cue.duration) {
      currentCue = cue;
      nextCue = visemes[i + 1] ?? null;
      break;
    }
  }

  if (!currentCue) return {};

  const currentShapes = RHUBARB_TO_ARKIT[currentCue.shape] ?? {};

  // Check if we're in the LERP zone near the end of this cue
  if (nextCue) {
    const timeUntilNext = currentCue.time + currentCue.duration - currentTime;
    if (timeUntilNext <= LERP_DURATION) {
      const nextShapes = RHUBARB_TO_ARKIT[nextCue.shape] ?? {};
      const t = 1 - timeUntilNext / LERP_DURATION; // 0->1 blend factor
      return blendShapes(currentShapes, nextShapes, t);
    }
  }

  return { ...currentShapes };
}

function blendShapes(
  a: Record<string, number>,
  b: Record<string, number>,
  t: number,
): Record<string, number> {
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const result: Record<string, number> = {};
  for (const key of allKeys) {
    const va = a[key] ?? 0;
    const vb = b[key] ?? 0;
    result[key] = va + (vb - va) * t;
  }
  return result;
}

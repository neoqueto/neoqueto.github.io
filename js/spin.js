import { TAU, qfromAxisAngle, qmul } from './core.js';
export function spinQuat(b, t) {
  const rot = b.rot || { period: 1e9, tilt: 0, phase: 0 };
  const ang = rot.phase + TAU * ((t / rot.period) % 1);
  const qs = qfromAxisAngle([0, 1, 0], ang);
  const qt = qmul(qfromAxisAngle([0, 0, 1], rot.tilt), qfromAxisAngle([0, 1, 0], (b.seed || 0) % 6.28));
  return qmul(qt, qs);
}

/**
 * KalmanSmoother — 17 independent 1D Kalman filters for COCO keypoints.
 * State: [x, y, vx, vy] per keypoint.
 *
 * Parameters (matching server smoother.py):
 *   Q = 0.01 (process noise)
 *   R = 0.1  (measurement noise)
 *   max_interp = 8 (max frames to interpolate missing keypoints)
 */
export class KalmanSmoother {
  /** @param {number} numKeypoints @param {number} maxInterpolationFrames */
  constructor(numKeypoints = 17, maxInterpolationFrames = 8) {
    this.n = numKeypoints;
    this.maxInterp = maxInterpolationFrames;
    this.dt = 1 / 30;  // assume 30 fps

    // Per-keypoint filter state
    this.filters = Array.from({ length: numKeypoints }, () => ({
      x: new Float64Array(4),       // [x, y, vx, vy]
      P: this._eye4(1.0),           // 4x4 covariance
      initialized: false,
      misses: 0,
    }));

    // Shared matrices
    this.F = this._makeF(this.dt);   // State transition
    this.H = [                       // Observation: extracts [x, y]
      [1, 0, 0, 0],
      [0, 1, 0, 0],
    ];
    this.Q = this._eye4(0.01);      // Process noise
    this.R = [                       // Measurement noise
      [0.1, 0],
      [0, 0.1],
    ];
  }

  _eye4(s) {
    return [[s,0,0,0],[0,s,0,0],[0,0,s,0],[0,0,0,s]];
  }

  _makeF(dt) {
    return [[1,0,dt,0],[0,1,0,dt],[0,0,1,0],[0,0,0,1]];
  }

  // 4x4 matrix multiply
  _mm44(A, B) {
    const C = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++)
        for (let k = 0; k < 4; k++)
          C[i][j] += A[i][k] * B[k][j];
    return C;
  }

  // 4x4 × 4x1 → 4x1
  _mv4(A, v) {
    return [
      A[0][0]*v[0] + A[0][1]*v[1] + A[0][2]*v[2] + A[0][3]*v[3],
      A[1][0]*v[0] + A[1][1]*v[1] + A[1][2]*v[2] + A[1][3]*v[3],
      A[2][0]*v[0] + A[2][1]*v[1] + A[2][2]*v[2] + A[2][3]*v[3],
      A[3][0]*v[0] + A[3][1]*v[1] + A[3][2]*v[2] + A[3][3]*v[3],
    ];
  }

  // Transpose 4x4
  _t44(A) {
    return [
      [A[0][0],A[1][0],A[2][0],A[3][0]],
      [A[0][1],A[1][1],A[2][1],A[3][1]],
      [A[0][2],A[1][2],A[2][2],A[3][2]],
      [A[0][3],A[1][3],A[2][3],A[3][3]],
    ];
  }

  // Add 4x4
  _add44(A, B) {
    return A.map((r, i) => r.map((v, j) => v + B[i][j]));
  }

  // 2x2 inverse
  _inv22(M) {
    const det = M[0][0]*M[1][1] - M[0][1]*M[1][0];
    if (Math.abs(det) < 1e-12) return [[1,0],[0,1]];
    const id = 1 / det;
    return [[M[1][1]*id, -M[0][1]*id], [-M[1][0]*id, M[0][0]*id]];
  }

  /**
   * Update all keypoints for one frame.
   * @param {Float32Array} keypoints  - length 34 (17 × [x,y])
   * @param {Float32Array} confidences - length 17
   * @returns {{ smoothed: Float32Array, occlusionRatio: number }}
   */
  update(keypoints, confidences) {
    const smoothed = new Float32Array(34);
    let occluded = 0;

    for (let k = 0; k < this.n; k++) {
      const f = this.filters[k];
      const conf = confidences[k];
      const mx = keypoints[k * 2];
      const my = keypoints[k * 2 + 1];

      if (conf > 0.3) {
        // ── Observation available → Kalman update ──
        if (!f.initialized) {
          f.x = new Float64Array([mx, my, 0, 0]);
          f.P = this._eye4(1.0);
          f.initialized = true;
        } else {
          // Predict
          const xPred = this._mv4(this.F, Array.from(f.x));
          const PPred = this._add44(
            this._mm44(this._mm44(this.F, f.P), this._t44(this.F)),
            this.Q
          );

          // Innovation: z - H*xPred
          const innovation = [mx - xPred[0], my - xPred[1]];

          // S = H*P*H' + R (2x2)
          const S = [
            [PPred[0][0] + this.R[0][0], PPred[0][1] + this.R[0][1]],
            [PPred[1][0] + this.R[1][0], PPred[1][1] + this.R[1][1]],
          ];
          const Sinv = this._inv22(S);

          // K = P*H'*Sinv (4x2)
          const K = Array.from({ length: 4 }, (_, i) => [
            (PPred[i][0] * Sinv[0][0] + PPred[i][1] * Sinv[1][0]),
            (PPred[i][0] * Sinv[0][1] + PPred[i][1] * Sinv[1][1]),
          ]);

          // Update state
          f.x = new Float64Array([
            xPred[0] + K[0][0]*innovation[0] + K[0][1]*innovation[1],
            xPred[1] + K[1][0]*innovation[0] + K[1][1]*innovation[1],
            xPred[2] + K[2][0]*innovation[0] + K[2][1]*innovation[1],
            xPred[3] + K[3][0]*innovation[0] + K[3][1]*innovation[1],
          ]);

          // Update covariance: P = (I - K*H) * PPred
          const KH = this._mm44(
            K.map(r => [r[0], r[1], 0, 0]),  // Expand K (4x2) to 4x4
            [[1,0,0,0],[0,1,0,0],[0,0,0,0],[0,0,0,0]]
          );
          f.P = this._add44(
            PPred.map((r, i) => r.map((v, j) => v - KH[i][j] * PPred[i][j])),
            this.Q  // Add small process noise for numerical stability
          );
        }
        f.misses = 0;
        smoothed[k * 2]     = f.x[0];
        smoothed[k * 2 + 1] = f.x[1];

      } else if (f.initialized && f.misses < this.maxInterp) {
        // ── Predict only (interpolate) ──
        const xPred = this._mv4(this.F, Array.from(f.x));
        f.x = new Float64Array(xPred);
        f.P = this._add44(
          this._mm44(this._mm44(this.F, f.P), this._t44(this.F)),
          this.Q
        );
        f.misses++;
        smoothed[k * 2]     = f.x[0];
        smoothed[k * 2 + 1] = f.x[1];
        occluded++;

      } else {
        // ── Lost keypoint ──
        smoothed[k * 2]     = NaN;
        smoothed[k * 2 + 1] = NaN;
        occluded++;
      }
    }

    return { smoothed, occlusionRatio: occluded / this.n };
  }

  reset() {
    for (const f of this.filters) {
      f.x = new Float64Array(4);
      f.P = this._eye4(1.0);
      f.initialized = false;
      f.misses = 0;
    }
  }
}

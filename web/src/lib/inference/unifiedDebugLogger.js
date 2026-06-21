export const DEBUG_ENABLED = true;

export class UnifiedDebugLogger {
  constructor(method, exerciseType, cameraAngle) {
    this.method = method;
    this.exerciseType = exerciseType;
    this.cameraAngle = cameraAngle;
    this.sessionId = crypto.randomUUID();
    this.logs = [];
  }

  markFileSelected() {
    this.logs.push({ event: 'file_selected', time: Date.now() });
  }

  async init(file) {
    this.logs.push({ event: 'init', name: file.name, size: file.size, time: Date.now() });
  }

  markSubmitStart() {
    this.logs.push({ event: 'submit_start', time: Date.now() });
  }

  mergeOnDeviceReport(report) {
    this.logs.push({ event: 'on_device_report', report, time: Date.now() });
  }

  setAccuracy(metadata) {
    this.logs.push({ event: 'accuracy_metadata', metadata, time: Date.now() });
  }

  error(code, err) {
    this.logs.push({ event: 'error', code, message: err?.message || String(err), time: Date.now() });
  }

  send() {
    console.log('[DEBUG LOG] Sending telemetry:', this);
  }

  toDownloadUrl() {
    const blob = new Blob([JSON.stringify(this, null, 2)], { type: 'application/json' });
    return URL.createObjectURL(blob);
  }
}

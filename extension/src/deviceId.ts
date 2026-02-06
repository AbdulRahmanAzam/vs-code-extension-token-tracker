import * as os from 'os';
import * as crypto from 'crypto';

/**
 * Generates a unique device fingerprint from MAC address + hostname.
 * Persisted once generated — same machine always gets same ID.
 */
export function generateFingerprint(): string {
  const hostname = os.hostname();
  const platform = os.platform();
  const arch = os.arch();
  const cpus = os.cpus();
  const cpuModel = cpus.length > 0 ? cpus[0].model : 'unknown';

  // Get primary MAC address (first non-internal interface)
  const nets = os.networkInterfaces();
  let mac = 'no-mac';
  for (const name of Object.keys(nets)) {
    const interfaces = nets[name];
    if (!interfaces) continue;
    for (const iface of interfaces) {
      if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
        mac = iface.mac;
        break;
      }
    }
    if (mac !== 'no-mac') break;
  }

  const raw = `${mac}|${hostname}|${platform}|${arch}|${cpuModel}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Returns a friendly device name.
 */
export function getDeviceName(): string {
  const hostname = os.hostname();
  const platform = os.platform();
  const platformNames: Record<string, string> = {
    win32: 'Windows',
    darwin: 'macOS',
    linux: 'Linux',
  };
  return `${hostname} (${platformNames[platform] || platform})`;
}

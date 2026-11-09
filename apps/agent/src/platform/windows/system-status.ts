import os from 'node:os';
import type { Logger } from '../../logger';
import type { StateStore } from '../../state-store';
import { run, runPowerShell } from './exec';

// nvidia-smi ships with the NVIDIA driver; it's usually on PATH, otherwise in one of these.
const NVIDIA_SMI_CANDIDATES = [
  'nvidia-smi',
  'C:\\Windows\\System32\\nvidia-smi.exe',
  'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe',
];

// ACPI thermal zone via WMI. Reports tenths of a Kelvin. Often needs admin rights,
// and many motherboards don't expose a real CPU sensor here, so it's best-effort.
const CPU_TEMP_SCRIPT =
  '(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop | Select-Object -First 1).CurrentTemperature';

const FAST_POLL_MS = 2000; // uptime + CPU %
const GPU_POLL_MS = 5000;
const CPU_TEMP_POLL_MS = 10_000;

type CpuTimes = { idle: number; total: number };

function readCpuTimes(): CpuTimes {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.irq + t.idle;
  }
  return { idle, total };
}

/** Polls uptime, CPU load, CPU temperature and NVIDIA GPU temperature into the store. */
export class SystemStatusPoller {
  private timers: NodeJS.Timeout[] = [];
  private lastCpu = readCpuTimes();
  private nvidiaSmi: string | null = null;

  constructor(
    private readonly store: StateStore,
    private readonly log: Logger,
  ) {}

  async start(): Promise<void> {
    this.pollFast();
    this.timers.push(setInterval(() => this.pollFast(), FAST_POLL_MS));

    this.nvidiaSmi = await this.findNvidiaSmi();
    if (this.nvidiaSmi) {
      this.log.info({ path: this.nvidiaSmi }, 'GPU temperature: using nvidia-smi');
      await this.pollGpu();
      this.timers.push(setInterval(() => void this.pollGpu(), GPU_POLL_MS));
    } else {
      this.log.warn('GPU temperature: nvidia-smi not found, GPU temp will be unavailable');
    }

    const cpuTemp = await this.readCpuTemp();
    if (cpuTemp !== null) {
      this.log.info({ celsius: cpuTemp }, 'CPU temperature: using WMI thermal zone');
      this.setSystem({ cpuTempC: cpuTemp });
      this.timers.push(setInterval(() => void this.pollCpuTemp(), CPU_TEMP_POLL_MS));
    } else {
      this.log.warn('CPU temperature: not exposed via WMI (try running as admin); CPU temp will be unavailable');
    }
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private setSystem(patch: Partial<ReturnType<StateStore['get']>['system']>): void {
    this.store.update('system', (s) => ({ ...s, ...patch }));
  }

  private pollFast(): void {
    // CPU % = share of non-idle time since the previous sample, across all cores.
    const now = readCpuTimes();
    const idle = now.idle - this.lastCpu.idle;
    const total = now.total - this.lastCpu.total;
    this.lastCpu = now;
    const cpuPercent = total > 0 ? Math.round((1 - idle / total) * 100) : null;
    this.setSystem({ uptimeSec: Math.floor(os.uptime()), cpuPercent });
  }

  private async findNvidiaSmi(): Promise<string | null> {
    for (const candidate of NVIDIA_SMI_CANDIDATES) {
      try {
        await run(candidate, ['--query-gpu=temperature.gpu', '--format=csv,noheader,nounits'], 4000);
        return candidate;
      } catch {
        // try the next location
      }
    }
    return null;
  }

  private async pollGpu(): Promise<void> {
    if (!this.nvidiaSmi) return;
    try {
      const out = await run(this.nvidiaSmi, ['--query-gpu=temperature.gpu', '--format=csv,noheader,nounits'], 4000);
      // One line per GPU; we use the first.
      const value = Number.parseInt(out.trim().split(/\r?\n/)[0] ?? '', 10);
      this.setSystem({ gpuTempC: Number.isFinite(value) ? value : null });
    } catch (err) {
      this.log.debug({ err }, 'nvidia-smi failed');
      this.setSystem({ gpuTempC: null });
    }
  }

  private async readCpuTemp(): Promise<number | null> {
    try {
      const raw = Number.parseFloat((await runPowerShell(CPU_TEMP_SCRIPT)).trim());
      if (!Number.isFinite(raw) || raw <= 0) return null;
      return Math.round(raw / 10 - 273.15);
    } catch {
      return null;
    }
  }

  private async pollCpuTemp(): Promise<void> {
    this.setSystem({ cpuTempC: await this.readCpuTemp() });
  }
}

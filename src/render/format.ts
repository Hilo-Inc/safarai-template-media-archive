const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const COUNT = new Intl.NumberFormat('en-US');
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function formatDate(iso: string): string {
  return DATE.format(new Date(iso));
}

export function formatCount(n: number): string {
  return COUNT.format(n);
}

export function formatBytes(n: number): string {
  let value = n;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1).replace(/\.0$/, '')} ${UNITS[unit]}`;
}

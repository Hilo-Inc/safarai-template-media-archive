import type { StoryMonth } from '../schema/index-types';

export const MONTH_RE = /^\d{4}-\d{2}$/;

export interface StoryDay {
  day: number;
  /** The day's first story's time, for its date label. */
  published: string;
  stories: StoryMonth['posts'];
}

export function storyDays(month: StoryMonth): StoryDay[] {
  const days = new Map<number, StoryMonth['posts']>();
  for (const p of month.posts) days.set(p.day, [...(days.get(p.day) ?? []), p]);
  return [...days.entries()].sort(([a], [b]) => a - b).map(([day, stories]) => ({ day, published: stories[0]!.published, stories }));
}

const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' });
const monthYear = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const firstOf = (month: string) => new Date(`${month}-01T00:00:00Z`);

export function monthLabel(month: string): string {
  return monthYear.format(firstOf(month));
}

export function monthsByYear(months: string[], counts: Record<string, number>) {
  const years = new Map<string, { month: string; name: string; count: number | null }[]>();
  for (const month of [...months].sort().reverse()) {
    const year = month.slice(0, 4);
    years.set(year, [...(years.get(year) ?? []), { month, name: monthName.format(firstOf(month)), count: counts[month] ?? null }]);
  }
  return [...years.entries()].map(([year, list]) => ({ year, months: list }));
}

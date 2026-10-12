import { describe, expect, it } from 'vitest';
import { monthLabel, monthsByYear, storyDays } from './stories';

const s = (id: string, day: number, published: string) => ({ id, day, published }) as never;

describe('stories helpers', () => {
  it('groups a month into days, oldest first', () => {
    const days = storyDays({ month: '2024-01', posts: [s('a', 15, '2024-01-15T12:00:00Z'), s('b', 31, '2024-01-31T12:00:00Z'), s('c', 31, '2024-01-31T23:30:00Z')] });
    expect(days.map((d) => [d.day, d.stories.map((x) => x.id)])).toEqual([[15, ['a']], [31, ['b', 'c']]]);
    expect(days[0]!.published).toBe('2024-01-15T12:00:00Z');
  });

  it('names months in UTC and groups them by year, newest first', () => {
    expect(monthLabel('2024-01')).toBe('January 2024');
    expect(monthsByYear(['2023-12', '2024-01', '2024-02'], { '2024-01': 3 })).toEqual([
      { year: '2024', months: [{ month: '2024-02', name: 'February', count: null }, { month: '2024-01', name: 'January', count: 3 }] },
      { year: '2023', months: [{ month: '2023-12', name: 'December', count: null }] },
    ]);
  });
});

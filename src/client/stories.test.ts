import { afterEach, describe, expect, it, vi } from 'vitest';

/** An element stand-in that records its listeners; the viewer only wires itself up on load. */
function fakeElement(extra: Record<string, unknown> = {}) {
  const listeners: string[] = [];
  return {
    listeners,
    dataset: {} as Record<string, string>,
    addEventListener: (type: string) => listeners.push(type),
    querySelector: () => fakeElement(),
    ...extra,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('stories viewer', () => {
  it('takes over the day links of a month page when it loads', async () => {
    const index = { month: '2024-01', posts: [{ id: 'instagram_s1', day: 31 }] };
    const root = fakeElement({ querySelector: () => ({ textContent: JSON.stringify(index) }) });
    root.dataset = { month: '2024-01', months: '["2024-01"]' };
    const dialog = fakeElement();
    vi.stubGlobal('document', {
      querySelector: (selector: string) => (selector === '[data-stories]' ? root : selector === '[data-story-viewer]' ? dialog : null),
      addEventListener: () => {},
    });
    vi.stubGlobal('window', { addEventListener: () => {} });
    vi.stubGlobal('location', { search: '', href: 'http://localhost/stories/2024-01' });

    await import('./stories');

    expect(root.listeners).toContain('click');
  });
});

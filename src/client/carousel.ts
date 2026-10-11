/** Wires each carousel under `root` once: the step buttons, the count and dots, and pausing media that scrolls away. */
export function initCarousels(root: ParentNode = document): void {
  for (const box of root.querySelectorAll<HTMLElement>('[data-carousel]')) {
    if (box.dataset.ready) continue;
    box.dataset.ready = '1';
    const track = box.querySelector<HTMLElement>('.carousel-track')!;
    const index = box.querySelector<HTMLElement>('[data-index]')!;
    const dots = [...box.querySelectorAll<HTMLElement>('.carousel-dots > span')];
    const prev = box.querySelector<HTMLButtonElement>('[data-step="-1"]')!;
    const next = box.querySelector<HTMLButtonElement>('[data-step="1"]')!;
    const count = track.children.length;
    const current = () => Math.round(track.scrollLeft / track.clientWidth);
    const update = () => {
      const i = current();
      index.textContent = String(i + 1);
      dots.forEach((dot, n) => dot.toggleAttribute('data-on', n === i));
      prev.disabled = i === 0;
      next.disabled = i === count - 1;
      [...track.children].forEach((li, n) => {
        if (n !== i) for (const media of li.querySelectorAll<HTMLMediaElement>('video, audio')) media.pause();
      });
    };
    for (const button of [prev, next]) {
      button.addEventListener('click', () => {
        track.scrollTo({ left: (current() + Number(button.dataset.step)) * track.clientWidth, behavior: 'smooth' });
      });
    }
    track.addEventListener('scroll', update, { passive: true });
    update();
  }
}

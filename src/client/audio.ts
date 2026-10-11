import WaveSurfer from 'wavesurfer.js';

/** Adds a waveform above each native audio player under `root`, once, drawn from the precomputed peaks (no audio decoding in the browser). */
export function initAudio(root: ParentNode = document): void {
  for (const box of root.querySelectorAll<HTMLElement>('[data-audio]')) {
    const peaksUrl = box.dataset.peaks;
    const audio = box.querySelector('audio');
    const container = box.querySelector<HTMLElement>('[data-wave]');
    if (!peaksUrl || !audio || !container || box.dataset.ready) continue;
    box.dataset.ready = '1';
    fetch(peaksUrl)
      .then((res) => (res.ok ? (res.json() as Promise<number[]>) : Promise.reject(new Error(String(res.status)))))
      .then((peaks) => {
        WaveSurfer.create({
          container,
          media: audio,
          peaks: [peaks],
          duration: Number(box.dataset.duration) || undefined,
          height: 64,
          barWidth: 2,
          barGap: 1,
          normalize: true,
        });
      })
      .catch(() => {
        // No waveform: the native player still works.
      });
  }
}

import { formatTime } from '../core/highScores';
import type { RoundDirector } from '../siege/rounds';
import type { Hud } from './hud';
import './round.css';

// Drone Siege's round readouts: a big red round counter (tally marks for the first five
// rounds, then numbers, a nod to Zombies) with the drones left to destroy, and a banner
// across the visor when a round starts or is cleared.

export class RoundHud {
  private counter: HTMLElement;
  private mark: HTMLElement;
  private left: HTMLElement;
  private banner: HTMLElement;
  private title: HTMLElement;
  private subtitle: HTMLElement;
  private shownRound = -1;
  private bannerTime = 0;

  constructor(hud: Hud) {
    this.counter = document.createElement('div');
    this.counter.className = 'round-counter';
    this.counter.innerHTML = `<div class="label">ROUND</div><div class="mark"></div><div class="left"></div>`;
    this.mark = this.counter.querySelector('.mark')!;
    this.left = this.counter.querySelector('.left')!;
    hud.addPanel(this.counter);

    this.banner = document.createElement('div');
    this.banner.className = 'round-banner';
    this.banner.innerHTML = `<div class="title"></div><div class="subtitle"></div>`;
    this.title = this.banner.querySelector('.title')!;
    this.subtitle = this.banner.querySelector('.subtitle')!;
    hud.addOverlay(this.banner);
    this.setActive(false);
  }

  setActive(active: boolean) {
    this.counter.style.display = active ? 'block' : 'none';
    this.banner.style.opacity = '0';
    this.bannerTime = 0;
    this.shownRound = -1;
  }

  roundStarted(round: number) {
    this.announce(`ROUND ${round}`, round === 1 ? 'HOSTILE DRONES INBOUND' : 'HOSTILES INBOUND', 2.6);
    this.counter.classList.remove('flash');
    void this.counter.offsetWidth; // restart the animation
    this.counter.classList.add('flash');
  }

  roundEnded(round: number) {
    this.announce(`ROUND ${round} CLEARED`, '', 3);
  }

  update(dt: number, rounds: RoundDirector) {
    if (rounds.round !== this.shownRound) {
      this.shownRound = rounds.round;
      this.mark.innerHTML = rounds.round === 0 ? '' : rounds.round <= 5 ? tally(rounds.round) : `<span>${rounds.round}</span>`;
    }
    if (rounds.state === 'fighting') {
      this.left.textContent = `${rounds.remaining} DRONE${rounds.remaining === 1 ? '' : 'S'} LEFT`;
    } else {
      const seconds = Math.ceil(Math.max(0, rounds.countdown));
      this.left.textContent = `ROUND ${rounds.round + 1} IN ${formatTime(seconds)}`;
      // In the quiet between rounds, the banner counts down the last few seconds.
      if (this.bannerTime <= 0 && rounds.round > 0 && seconds <= 5) {
        this.title.textContent = `ROUND ${rounds.round + 1}`;
        this.subtitle.textContent = `IN ${seconds}`;
        this.banner.style.opacity = '0.85';
      }
    }
    if (this.bannerTime > 0) {
      this.bannerTime -= dt;
      if (this.bannerTime <= 0) this.banner.style.opacity = '0';
    }
  }

  private announce(title: string, subtitle: string, seconds: number) {
    this.title.textContent = title;
    this.subtitle.textContent = subtitle;
    this.banner.style.opacity = '1';
    this.bannerTime = seconds;
  }
}

// Hand-drawn-looking tally strokes: up to four upright, the fifth across them.
function tally(count: number) {
  const jitter = () => (Math.random() - 0.5) * 4;
  const stroke = (x1: number, y1: number, x2: number, y2: number) => {
    const mx = (x1 + x2) / 2 + jitter();
    const my = (y1 + y2) / 2 + jitter();
    return `<polyline points="${x1 + jitter()},${y1} ${mx},${my} ${x2 + jitter()},${y2}" />`;
  };
  let lines = '';
  for (let i = 0; i < Math.min(count, 4); i++) lines += stroke(14 + i * 17, 8, 12 + i * 17, 58);
  if (count >= 5) lines += stroke(2, 50, 78, 14);
  return `<svg viewBox="0 0 84 66">${lines}</svg>`;
}

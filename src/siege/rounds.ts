import { CONFIG } from '../config';

// The rounds of Drone Siege: how many drones each round sends, which kinds, how tough and
// sharp they are, and the rhythm of a fight. Like Zombies: a round ends when every one of
// its drones is destroyed, then there's a short quiet before the next, bigger one. Every
// few rounds is a swarm round (only kamikazes), and every tenth brings a carrier, the boss.

/** The tougher types that join ordinary rounds a few at a time (scouts make up the rest). */
export type ToughType = keyof typeof CONFIG.siege.roster;
export type DroneType = 'scout' | ToughType | 'kamikaze' | 'carrier';
export type RoundKind = 'normal' | 'swarm' | 'carrier';

/** How a drone of a given round flies and fights, compared with round 1. */
export interface DroneStats {
  type: DroneType;
  health: number;
  fireRate: number; // multiplier on how often it fires
  aimSpread: number; // degrees of aim error
  aimLead: number; // 0 aims where you are, 1 where you'll be
}

const rounds = () => CONFIG.siege.rounds;

/** How many drones round n sends in total. */
export function dronesInRound(n: number, kind: RoundKind = 'normal') {
  const r = rounds();
  const special = CONFIG.siege.special;
  if (kind === 'swarm') return Math.round(special.swarmDrones[0] + special.swarmDrones[1] * n);
  const usual = Math.round(r.baseDrones + r.dronesPerRound * (n - 1) + r.dronesGrowth * (n - 1) ** 2);
  // A carrier round: the carrier plus a smaller escort.
  return kind === 'carrier' ? 1 + Math.round(usual * special.carrierEscort) : usual;
}

/** The most drones flying at once in round n. */
export function maxAlive(n: number, kind: RoundKind = 'normal') {
  const r = rounds();
  if (kind === 'swarm') return Math.min(CONFIG.siege.maxDrones, CONFIG.siege.special.swarmAlive);
  return Math.min(CONFIG.siege.maxDrones, Math.round(r.baseAlive + r.alivePerRound * (n - 1)));
}

/** Seconds between drone arrivals in round n. */
export function spawnInterval(n: number, kind: RoundKind = 'normal') {
  const r = rounds();
  if (kind === 'swarm') return CONFIG.siege.special.swarmInterval;
  return Math.max(r.minSpawnInterval, r.spawnInterval * r.spawnIntervalShrink ** (n - 1));
}

/** Health multiplier: a steady climb to round 10, then compounding. */
export function healthScale(n: number) {
  const r = rounds();
  const linear = 1 + r.healthPerRound * (Math.min(n, 10) - 1);
  return linear * r.healthGrowth ** Math.max(0, n - 10);
}

/** Stats for a drone of this type in round n. */
export function droneStats(n: number, type: DroneType): DroneStats {
  const r = rounds();
  const base = CONFIG.siege[type];
  // A carrier's own health doesn't matter: its weak points each have this much.
  const health = type === 'carrier' ? CONFIG.siege.carrier.weakPointHealth : base.health;
  return {
    type,
    health: Math.round(health * healthScale(n)),
    fireRate: Math.min(r.maxFireRate, 1 + r.fireRatePerRound * (n - 1)),
    aimSpread: base.aimSpread * Math.max(r.minSpread, 1 - r.spreadPerRound * (n - 1)),
    aimLead: Math.min(r.maxLead, base.aimLead + r.leadPerRound * (n - 1)),
  };
}

/** How many of a tougher type an ordinary round n sends: none before it unlocks, then a few more each round. */
export function toughCount(n: number, type: ToughType) {
  const entry = CONFIG.siege.roster[type];
  return n < entry.fromRound ? 0 : Math.floor(entry.first + entry.perRound * (n - entry.fromRound));
}

/**
 * The drones round n sends, in the order they come. Mostly scouts, with the round's few
 * tougher drones spaced evenly through it (in a random order), so they never pile up
 * at once. A swarm round is all kamikazes. A carrier round opens with the carrier, and
 * its smaller escort brings its share of the tougher drones (at least one of each).
 */
export function lineup(n: number, kind: RoundKind = 'normal'): DroneType[] {
  const total = dronesInRound(n, kind);
  if (kind === 'swarm') return new Array<DroneType>(total).fill('kamikaze');
  const size = kind === 'carrier' ? total - 1 : total;
  const share = kind === 'carrier' ? CONFIG.siege.special.carrierEscort : 1;
  const tough: DroneType[] = [];
  for (const type of Object.keys(CONFIG.siege.roster) as ToughType[]) {
    const count = Math.ceil(toughCount(n, type) * share);
    for (let k = 0; k < count; k++) tough.push(type);
  }
  shuffle(tough);
  tough.length = Math.min(tough.length, size);
  const order = new Array<DroneType>(size).fill('scout');
  tough.forEach((type, k) => (order[Math.floor(((k + 0.5) / tough.length) * size)] = type));
  return kind === 'carrier' ? ['carrier', ...order] : order;
}

function shuffle<T>(list: T[]) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
}

export type RoundEvent = { kind: 'roundStart' | 'roundEnd'; round: number; special: RoundKind };

/**
 * Runs the rounds: counts down the quiet between them, decides when the next drone of
 * the current round may come in, and notices when the round is cleared.
 */
export class RoundDirector {
  round = 0;
  kind: RoundKind = 'normal';
  state: 'intermission' | 'fighting' = 'intermission';
  /** Seconds until the next round starts (during an intermission). */
  countdown = 0;
  total = 0; // drones in this round
  destroyed = 0; // of this round's drones
  /** Set by update(): send a drone of this type in this frame. */
  wantsSpawn: DroneType | null = null;
  private nextSwarm = 0; // the round the next swarm comes in
  private queue: DroneType[] = []; // this round's drones not sent in yet, in order
  private spawnTimer = 0;
  private events: RoundEvent[] = []; // gathered between updates (a kill can end a round mid-shot)

  start() {
    this.events = [];
    this.round = 0;
    this.kind = 'normal';
    this.nextSwarm = this.swarmAfter(0);
    this.destroyed = 0;
    this.total = 0;
    this.queue = [];
    this.state = 'intermission';
    this.countdown = rounds().firstDelay;
  }

  /** Drones of this round still to destroy. */
  get remaining() {
    return this.total - this.destroyed;
  }

  /**
   * One frame. `alive` counts drones flying plus those about to come out of a spawn point.
   * Returns round events, and sets `wantsSpawn` when a new drone should come in now.
   */
  update(dt: number, alive: number) {
    this.wantsSpawn = null;
    if (this.state === 'intermission') {
      this.countdown -= dt;
      if (this.countdown <= 0) this.beginRound();
    } else {
      this.spawnTimer -= dt;
      if (this.queue.length > 0 && alive < maxAlive(this.round, this.kind) && this.spawnTimer <= 0) {
        this.wantsSpawn = this.queue.shift()!;
        this.spawnTimer = spawnInterval(this.round, this.kind) * (0.7 + Math.random() * 0.6);
      }
    }
    const events = this.events;
    this.events = [];
    return events;
  }

  /** One of this round's drones was destroyed. */
  onDestroyed() {
    this.destroyed++;
    if (this.state === 'fighting' && this.destroyed >= this.total) {
      this.events.push({ kind: 'roundEnd', round: this.round, special: this.kind });
      this.state = 'intermission';
      this.countdown = rounds().intermission;
    }
  }

  /** A carrier launched a scout: it joins this round, which now ends only when it's down too. */
  onLaunched() {
    this.total++;
  }

  /** A drone left without being destroyed (sent back to a spawn point): it'll come in again next. */
  onRecalled(type: DroneType) {
    this.queue.unshift(type);
  }

  /** The spawn couldn't happen after all (no free spawn point): try again shortly. */
  onSpawnFailed(type: DroneType) {
    this.queue.unshift(type);
    this.spawnTimer = 0.5;
  }

  private beginRound() {
    this.round++;
    const every = CONFIG.siege.special.carrierEvery;
    this.kind = this.round % every === 0 ? 'carrier' : this.round === this.nextSwarm ? 'swarm' : 'normal';
    if (this.kind === 'swarm') this.nextSwarm = this.swarmAfter(this.round);
    this.state = 'fighting';
    this.queue = lineup(this.round, this.kind);
    this.total = this.queue.length;
    this.destroyed = 0;
    this.spawnTimer = 0.6;
    this.events.push({ kind: 'roundStart', round: this.round, special: this.kind });
  }

  // The round for the next swarm: 5 to 7 rounds on, but never on a carrier round.
  private swarmAfter(round: number) {
    const [min, max] = CONFIG.siege.special.swarmGap;
    let next = round + min + Math.floor(Math.random() * (max - min + 1));
    if (next % CONFIG.siege.special.carrierEvery === 0) next++;
    return next;
  }
}

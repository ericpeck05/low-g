import { Gun } from './gun';
import type { WeaponSpec } from './weaponSpec';

// The guns you carry. Most modes give you just the range rifle; Drone Siege starts you
// with a sidearm and one empty slot. Switching lowers the gun in hand and raises the
// other, and you can't fire until it's up.

const LOWER_TIME = 0.2; // seconds to put a gun away
const RAISE_TIME = 0.28; // seconds to bring the next one up

export class Loadout {
  slots: (Gun | null)[] = [];
  index = 0;
  private switchTimer = 0; // counts down through lowering, then raising
  private next = 0;
  private incoming: Gun | null = null; // a bought gun, put in its slot once the old one is away

  /** Arm the player: one gun per spec (null for an empty slot), holding the first. */
  equip(specs: (WeaponSpec | null)[]) {
    this.slots = specs.map((spec) => (spec ? new Gun(spec) : null));
    this.index = 0;
    this.switchTimer = 0;
    this.incoming = null;
  }

  get current(): Gun {
    return this.slots[this.index]!;
  }

  /** 0 when the gun is up and ready, 1 when it's fully lowered out of view. */
  get lowered() {
    if (this.switchTimer <= 0) return 0;
    // First half of the timer lowers the old gun, second half raises the new one.
    return this.switchTimer > RAISE_TIME ? 1 - (this.switchTimer - RAISE_TIME) / LOWER_TIME : this.switchTimer / RAISE_TIME;
  }

  get switching() {
    return this.switchTimer > 0;
  }

  /** The gun with this id, if you're carrying one. */
  owns(id: string) {
    return this.slots.find((gun) => gun?.spec.id === id) ?? (this.incoming?.spec.id === id ? this.incoming : null);
  }

  /** Switch to a slot (if there's a gun in it and it isn't the one in hand). */
  select(slot: number) {
    if (slot === this.index || !this.slots[slot] || this.switchTimer > RAISE_TIME) return;
    this.current.holster();
    this.next = slot;
    this.switchTimer = LOWER_TIME + RAISE_TIME;
  }

  /** Scroll wheel: the next or previous gun you're carrying. */
  cycle(direction: number) {
    const count = this.slots.length;
    for (let step = 1; step < count; step++) {
      const slot = (this.index + direction * step + count * 4) % count;
      if (this.slots[slot]) return this.select(slot);
    }
  }

  /** A new gun: into an empty slot if there is one, otherwise it replaces the one in hand. */
  give(spec: WeaponSpec) {
    const empty = this.slots.indexOf(null);
    this.slots[this.index]?.holster();
    this.incoming = new Gun(spec);
    this.next = empty >= 0 ? empty : this.index;
    this.switchTimer = LOWER_TIME + RAISE_TIME;
    return this.incoming;
  }

  update(dt: number) {
    if (this.switchTimer <= 0) return;
    const wasLowering = this.switchTimer > RAISE_TIME;
    this.switchTimer = Math.max(0, this.switchTimer - dt);
    // The new gun comes up once the old one is out of sight.
    if (wasLowering && this.switchTimer <= RAISE_TIME) {
      if (this.incoming) this.slots[this.next] = this.incoming;
      this.incoming = null;
      this.index = this.next;
    }
  }
}

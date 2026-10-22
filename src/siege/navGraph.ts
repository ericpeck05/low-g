import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config';
import { isInsideDome } from '../world/city/dome';
import { terrainHeight } from '../world/terrain';

// A web of open-air points across the inside of the dome, joined wherever a drone could
// fly straight from one to the next. A hunting drone that can't see you finds a way
// along it: around towers, under walkways, through the range hall's doorway. (Outside
// the dome it's open ground, so drones there don't need it.) Built once, at load.

const SPACING = 8; // meters between points across
const LAYERS = [2.5, 6.5, 12, 18, 25, 33]; // heights of the layers of points
const CLEARANCE = 1; // meters of open space a point needs around it

interface Node {
  position: THREE.Vector3;
  links: number[];
}

export class NavGraph {
  private nodes: Node[] = [];
  private byCell = new Map<string, number>(); // "i,j,layer" -> node index
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });

  constructor(
    private world: RAPIER.World,
    private blocks: (collider: RAPIER.Collider) => boolean,
  ) {
    const reach = Math.floor(CONFIG.city.domeRadius / SPACING);
    const ball = new RAPIER.Ball(CLEARANCE);
    const still = { x: 0, y: 0, z: 0, w: 1 };
    for (let l = 0; l < LAYERS.length; l++) {
      for (let i = -reach; i <= reach; i++) {
        for (let j = -reach; j <= reach; j++) {
          const p = new THREE.Vector3(i * SPACING, LAYERS[l], j * SPACING);
          if (p.y < terrainHeight(p.x, p.z) + 2) continue;
          // Inside the dome, with room to spare from the glass.
          if (!isInsideDome(p.clone().multiplyScalar(1.06))) continue;
          if (world.intersectionWithShape(p, still, ball, undefined, undefined, undefined, undefined, blocks)) continue;
          this.byCell.set(`${i},${j},${l}`, this.nodes.length);
          this.nodes.push({ position: p, links: [] });
        }
      }
    }
    // Join each point to its neighbors in the grid (and the layers above and below)
    // wherever the straight line between them is clear.
    for (const [key, index] of this.byCell) {
      const [i, j, l] = key.split(',').map(Number);
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          for (let dl = -1; dl <= 1; dl++) {
            const other = this.byCell.get(`${i + di},${j + dj},${l + dl}`);
            if (other === undefined || other <= index) continue; // each pair once
            if (this.clear(this.nodes[index].position, this.nodes[other].position)) {
              this.nodes[index].links.push(other);
              this.nodes[other].links.push(index);
            }
          }
        }
      }
    }
  }

  get size() {
    return this.nodes.length;
  }

  /**
   * A way from `from` to somewhere that can see `to`, as points to fly through in order
   * (straightened where it can cut corners). Empty if there's no way.
   * ignore: a collider the lines may pass through (the player's own body, around `to`).
   * blocked: links it may not use right now (through a Drone Siege barrier that's up).
   */
  route(from: THREE.Vector3, to: THREE.Vector3, ignore?: RAPIER.Collider, blocked?: (a: THREE.Vector3, b: THREE.Vector3) => boolean) {
    const start = this.nearestVisible(from);
    const goal = this.nearestVisible(to, ignore);
    if (start === null || goal === null) return [];
    const path = this.search(start, goal, blocked);
    if (path.length === 0) return [];
    // String-pulling: skip any point the one before it can see past.
    const points = path.map((n) => this.nodes[n].position);
    const straight: THREE.Vector3[] = [];
    let last = from;
    for (let k = 0; k < points.length; k++) {
      const next = points[k + 1];
      if (next && this.clear(last, next)) continue;
      straight.push(points[k]);
      last = points[k];
    }
    return straight;
  }

  // The closest point that can be reached in a straight line from `p`.
  private nearestVisible(p: THREE.Vector3, ignore?: RAPIER.Collider) {
    const i = Math.round(p.x / SPACING);
    const j = Math.round(p.z / SPACING);
    const candidates: number[] = [];
    for (let di = -2; di <= 2; di++) {
      for (let dj = -2; dj <= 2; dj++) {
        for (let l = 0; l < LAYERS.length; l++) {
          const index = this.byCell.get(`${i + di},${j + dj},${l}`);
          if (index !== undefined) candidates.push(index);
        }
      }
    }
    candidates.sort((a, b) => this.nodes[a].position.distanceToSquared(p) - this.nodes[b].position.distanceToSquared(p));
    for (const index of candidates.slice(0, 12)) if (this.clear(p, this.nodes[index].position, ignore)) return index;
    return null;
  }

  // A* search: the shortest chain of joined points from start to goal.
  private search(start: number, goal: number, blocked?: (a: THREE.Vector3, b: THREE.Vector3) => boolean) {
    const goalPosition = this.nodes[goal].position;
    const cost = new Map<number, number>([[start, 0]]);
    const cameFrom = new Map<number, number>();
    const open = [start];
    const guess = new Map<number, number>([[start, this.nodes[start].position.distanceTo(goalPosition)]]);
    const visited = new Set<number>();
    while (open.length > 0) {
      // Take the open point with the best guess (a plain scan is fast enough for this size).
      let best = 0;
      for (let k = 1; k < open.length; k++) if (guess.get(open[k])! < guess.get(open[best])!) best = k;
      const current = open.splice(best, 1)[0];
      if (current === goal) {
        const path = [current];
        while (cameFrom.has(path[0])) path.unshift(cameFrom.get(path[0])!);
        return path;
      }
      visited.add(current);
      for (const next of this.nodes[current].links) {
        if (visited.has(next)) continue;
        if (blocked?.(this.nodes[current].position, this.nodes[next].position)) continue;
        const through = cost.get(current)! + this.nodes[current].position.distanceTo(this.nodes[next].position);
        if (through >= (cost.get(next) ?? Infinity)) continue;
        cameFrom.set(next, current);
        cost.set(next, through);
        guess.set(next, through + this.nodes[next].position.distanceTo(goalPosition));
        if (!open.includes(next)) open.push(next);
      }
    }
    return [];
  }

  private clear(a: THREE.Vector3, b: THREE.Vector3, ignore?: RAPIER.Collider) {
    const direction = b.clone().sub(a);
    const distance = direction.length();
    if (distance < 1e-6) return true;
    this.ray.origin = a;
    this.ray.dir = direction.divideScalar(distance);
    return this.world.castRay(this.ray, distance, true, undefined, undefined, ignore, undefined, this.blocks) === null;
  }
}

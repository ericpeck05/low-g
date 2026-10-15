// Tracks which keys are held and how far the mouse moved this frame.
// Uses event.code (physical key position) so WASD works on any keyboard layout.

export class Input {
  private held = new Set<string>();
  private pressedThisFrame = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  locked = false;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.locked) return;
      if (!e.repeat) this.pressedThisFrame.add(e.code);
      this.held.add(e.code);
      // Stop Space from scrolling the page.
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));

    // The browser releases the mouse on Esc. Clicking the start screen grabs it again.
        document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      // Forget held keys when the mouse is released, so nothing stays "stuck".
      if (!this.locked) this.held.clear();
    });

    // Mouse buttons are stored like keys: 'Mouse0' is left click, 'Mouse2' is right click.
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.held.add(`Mouse${e.button}`);
      this.pressedThisFrame.add(`Mouse${e.button}`);
    });
    document.addEventListener('mouseup', (e) => this.held.delete(`Mouse${e.button}`));
    // Right click is for aiming, so don't open the browser's menu.
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
  }

  // Returns false if the browser refused (some embedded previews don't allow it).
  async requestLock() {
    if (this.locked) return true;
    try {
      await this.canvas.requestPointerLock();
      return true;
    } catch {
      return false;
    }
  }

  isDown(...codes: string[]) {
    return codes.some((c) => this.held.has(c));
  }

  wasPressed(...codes: string[]) {
    return codes.some((c) => this.pressedThisFrame.has(c));
  }

  // Returns the mouse movement since the last call, then resets it.
  takeMouseDelta() {
    const delta = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return delta;
  }

  // Call once at the end of every frame.
  endFrame() {
    this.pressedThisFrame.clear();
  }
}

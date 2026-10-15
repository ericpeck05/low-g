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
      // Stop the browser from scrolling or doing shortcuts with game keys.
      if (e.code === 'Space' || e.code.startsWith('Control')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));

    // The browser releases the mouse on Esc. Clicking the start screen grabs it again.
        document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      // Forget held keys when the mouse is released, so nothing stays "stuck".
      if (!this.locked) this.held.clear();
    });

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

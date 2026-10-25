import * as THREE from 'three';

/** Decorative assets are optional; a failed download never prevents live traffic. */
export class SceneMaterials {
  readonly metal = this.placeholder(0x9aabb3);
  readonly enamel = this.placeholder(0x172329);
  #disposed = false;
  #loading?: Promise<void>;

  private placeholder(color: number): THREE.Texture {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    context.fillStyle = `#${color.toString(16).padStart(6, '0')}`; context.fillRect(0, 0, 1, 1);
    const texture = new THREE.Texture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  load(panel = false): Promise<void> {
    return this.#loading ??= Promise.all([
      this.loadInto(this.metal, '/scene-materials/arcade-metal-matcap.png'),
      ...(panel ? [this.loadInto(this.enamel, '/scene-materials/arcade-enamel-panel.png')] : []),
    ]).then(() => {});
  }

  private async loadInto(target: THREE.Texture, url: string): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6_000);
    try {
      const response = await fetch(url, { signal: controller.signal, credentials: 'same-origin' });
      if (!response.ok) return;
      const bitmap = await createImageBitmap(await response.blob(), { imageOrientation: 'flipY', colorSpaceConversion: 'none' });
      if (this.#disposed) { bitmap.close(); return; }
      // Retain the already-bound texture so shader defines stay unchanged.
      target.image = bitmap;
      target.flipY = false;
      target.generateMipmaps = true;
      target.minFilter = THREE.LinearMipmapLinearFilter;
      target.magFilter = THREE.LinearFilter;
      target.needsUpdate = true;
    } catch { /* The neutral material remains available offline. */ }
    finally { clearTimeout(timeout); }
  }

  init(gpu: THREE.WebGLRenderer, panel = false): void {
    gpu.initTexture(this.metal);
    if (panel) gpu.initTexture(this.enamel);
  }

  dispose(): void {
    this.#disposed = true;
    for (const texture of [this.metal, this.enamel]) {
      if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) texture.image.close();
      texture.dispose();
    }
  }
}

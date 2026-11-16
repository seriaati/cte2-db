// Draws an item the way the game's inventory shows it. Most gear is a flat texture, but the pack's
// weapons are small 3D models, which have to be rendered to get the picture the player sees.
import { PNG } from 'pngjs';

type Vec = [number, number, number];
type Axis = 'x' | 'y' | 'z';

interface Face {
  uv?: [number, number, number, number];
  texture: string;
  rotation?: number;
}

interface Element {
  from: Vec;
  to: Vec;
  rotation?: { origin: Vec; axis: Axis; angle: number };
  faces: Record<string, Face>;
}

export interface Model {
  parent?: string;
  textures?: Record<string, string>;
  elements?: Element[];
  display?: { gui?: { rotation?: Vec; translation?: Vec; scale?: Vec } };
}

export const ICON_SIZE = 64;
// A 3D item often reaches past its inventory slot, so its picture takes in a little more than the slot.
const VIEW = 1.25;

// FaceInfo in Minecraft: the corners of each face of a box, as 0 for its `from` side and 1 for its
// `to` side. The face's texture goes on them in this order: top left, bottom left, bottom right, top right.
const CORNERS: Record<string, Vec[]> = {
  down: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]],
  up: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
  north: [[1, 1, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]],
  south: [[0, 1, 1], [0, 0, 1], [1, 0, 1], [1, 1, 1]],
  west: [[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]],
  east: [[1, 1, 1], [1, 0, 1], [1, 0, 0], [1, 1, 0]],
};
// How much light the game gives each side of a model.
const SHADE: Record<string, number> = { down: 0.5, up: 1, north: 0.8, south: 0.8, west: 0.6, east: 0.6 };

function rotate([x, y, z]: Vec, axis: Axis, degrees: number): Vec {
  const [s, c] = [Math.sin((degrees * Math.PI) / 180), Math.cos((degrees * Math.PI) / 180)];
  if (axis === 'x') return [x, y * c - z * s, y * s + z * c];
  if (axis === 'y') return [x * c + z * s, y, z * c - x * s];
  return [x * c - y * s, x * s + y * c, z];
}

// A flat item: the texture's first frame, scaled up in whole pixels.
export function flatIcon(texture: PNG): PNG {
  const icon = new PNG({ width: ICON_SIZE, height: ICON_SIZE });
  for (let y = 0; y < ICON_SIZE; y++) {
    for (let x = 0; x < ICON_SIZE; x++) {
      const from = (Math.floor((y * texture.width) / ICON_SIZE) * texture.width + Math.floor((x * texture.width) / ICON_SIZE)) * 4;
      texture.data.copy(icon.data, (y * ICON_SIZE + x) * 4, from, from + 4);
    }
  }
  return icon;
}

// A 3D item, seen as its inventory slot shows it: ItemTransform.apply with the model's "gui"
// display, then the straight-on view GuiGraphics.renderItem draws, x to the right and y up.
export function modelIcon(elements: Element[], gui: NonNullable<Model['display']>['gui'], textures: Record<string, PNG | undefined>): PNG {
  const icon = new PNG({ width: ICON_SIZE, height: ICON_SIZE });
  const depth = new Float32Array(ICON_SIZE * ICON_SIZE).fill(-Infinity);
  const { rotation = [0, 0, 0], translation = [0, 0, 0], scale = [1, 1, 1] } = gui ?? {};

  const place = (point: Vec): Vec => {
    let p = point.map((v, i) => (v / 16 - 0.5) * scale[i]) as Vec;
    for (const axis of ['z', 'y', 'x'] as const) p = rotate(p, axis, rotation['xyz'.indexOf(axis)]);
    return [((p[0] + translation[0] / 16) / VIEW + 0.5) * ICON_SIZE, (0.5 - (p[1] + translation[1] / 16) / VIEW) * ICON_SIZE, p[2]];
  };

  for (const { from, to, rotation: turn, faces } of elements) {
    for (const [side, face] of Object.entries(faces)) {
      const texture = textures[face.texture.replace('#', '')];
      if (!texture || !face.uv) continue;
      const [u1, v1, u2, v2] = face.uv;
      const uvs = [[u1, v1], [u1, v2], [u2, v2], [u2, v1]];
      const corners = CORNERS[side].map((corner, i) => {
        let p = corner.map((far, axis) => (far ? to : from)[axis]) as Vec;
        if (turn) p = rotate(p.map((v, axis) => v - turn.origin[axis]) as Vec, turn.axis, turn.angle).map((v, axis) => v + turn.origin[axis]) as Vec;
        const [u, v] = uvs[(i + (face.rotation ?? 0) / 90) % 4];
        return [...place(p), u, v];
      });
      // Each face is two triangles; a pixel takes the texture's colour where it is nearest the viewer.
      for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]].map((triangle) => triangle.map((i) => corners[i]))) {
        const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if (Math.abs(area) < 1e-9) continue;
        const xs = [a[0], b[0], c[0]];
        const ys = [a[1], b[1], c[1]];
        for (let y = Math.max(0, Math.floor(Math.min(...ys))); y < Math.min(ICON_SIZE, Math.ceil(Math.max(...ys))); y++) {
          for (let x = Math.max(0, Math.floor(Math.min(...xs))); x < Math.min(ICON_SIZE, Math.ceil(Math.max(...xs))); x++) {
            const [px, py] = [x + 0.5, y + 0.5];
            const wb = ((px - a[0]) * (c[1] - a[1]) - (py - a[1]) * (c[0] - a[0])) / area;
            const wc = ((b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0])) / area;
            const wa = 1 - wb - wc;
            if (wa < 0 || wb < 0 || wc < 0) continue;
            const at = (i: number) => wa * a[i] + wb * b[i] + wc * c[i];
            if (at(2) <= depth[y * ICON_SIZE + x]) continue;
            const tx = Math.min(texture.width - 1, Math.max(0, Math.floor((at(3) / 16) * texture.width)));
            const ty = Math.min(texture.width - 1, Math.max(0, Math.floor((at(4) / 16) * texture.width)));
            const pixel = (ty * texture.width + tx) * 4;
            if (texture.data[pixel + 3] < 128) continue;
            depth[y * ICON_SIZE + x] = at(2);
            for (let i = 0; i < 3; i++) icon.data[(y * ICON_SIZE + x) * 4 + i] = texture.data[pixel + i] * SHADE[side];
            icon.data[(y * ICON_SIZE + x) * 4 + 3] = 255;
          }
        }
      }
    }
  }
  return icon;
}

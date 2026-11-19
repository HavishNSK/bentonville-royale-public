// BENTONVILLE ROYALE — the BHS tiger emblem (an ORIGINAL drawing made for this project, not the
// school's logo artwork): a gold disc in a black ring with a stylised tiger face, black and gold.
// Shared by the 3D look 'emblem' (kit/materials.js) and the "Now entering" banner (entering.js).

/** Draw the emblem into a 2D context, in a 256 x 256 unit space (scale the context first). */
export function drawEmblem(ctx) {
  const c = 128;
  ctx.fillStyle = '#111111';
  ctx.beginPath();
  ctx.arc(c, c, c - 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c9a54a';
  ctx.beginPath();
  ctx.arc(c, c, c - 14, 0, Math.PI * 2);
  ctx.fill();
  // ears
  ctx.fillStyle = '#e0912f';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(c + s * 34, 74);
    ctx.lineTo(c + s * 70, 46);
    ctx.lineTo(c + s * 72, 96);
    ctx.closePath();
    ctx.fill();
  }
  // head
  ctx.beginPath();
  ctx.ellipse(c, 140, 70, 66, 0, 0, Math.PI * 2);
  ctx.fill();
  // muzzle
  ctx.fillStyle = '#f6efe0';
  ctx.beginPath();
  ctx.ellipse(c - 20, 168, 24, 18, 0, 0, Math.PI * 2);
  ctx.ellipse(c + 20, 168, 24, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  // stripes
  ctx.fillStyle = '#141414';
  const stripe = (x, y, a, l) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.quadraticCurveTo(l * 0.6, 0, l, 0);
    ctx.quadraticCurveTo(l * 0.6, 4, 0, 5);
    ctx.fill();
    ctx.restore();
  };
  stripe(c, 80, Math.PI / 2, 30);
  stripe(c - 14, 82, Math.PI / 2 + 0.25, 24);
  stripe(c + 14, 82, Math.PI / 2 - 0.25, 24);
  for (const s of [-1, 1]) {
    stripe(c + s * 70, 130, s < 0 ? 0 : Math.PI, 26);
    stripe(c + s * 68, 150, s < 0 ? 0.15 : Math.PI - 0.15, 22);
    stripe(c + s * 62, 168, s < 0 ? 0.3 : Math.PI - 0.3, 18);
  }
  // eyes + nose
  ctx.fillStyle = '#141414';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(c + s * 26, 126, 11, 7, s * -0.35, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#c9a54a';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(c + s * 26, 126, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#2a1a14';
  ctx.beginPath();
  ctx.moveTo(c - 13, 150);
  ctx.lineTo(c + 13, 150);
  ctx.lineTo(c, 163);
  ctx.closePath();
  ctx.fill();
  }

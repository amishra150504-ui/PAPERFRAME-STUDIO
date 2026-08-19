export function normalizedRotation(value = 0) {
  return ((Number(value) % 360) + 360) % 360;
}

export function rotatedDimensions(width, height, rotation = 0) {
  const radians = normalizedRotation(rotation) * Math.PI / 180;
  const cos = Math.abs(Math.cos(radians)), sin = Math.abs(Math.sin(radians));
  return {
    width: Math.max(1, Math.round(width * cos + height * sin)),
    height: Math.max(1, Math.round(width * sin + height * cos))
  };
}

export function fitImageRect(imageWidth, imageHeight, cellWidth, cellHeight, fit = 'cover', zoom = 1, expandX = 1, expandY = 1) {
  const ratio = imageWidth / imageHeight, cellRatio = cellWidth / cellHeight;
  let width, height;
  const contain = fit === 'contain' || fit === 'smart';
  if ((contain && ratio > cellRatio) || (!contain && ratio < cellRatio)) {
    width = cellWidth * zoom; height = width / ratio;
  } else {
    height = cellHeight * zoom; width = height * ratio;
  }
  return { width: width * expandX, height: height * expandY };
}

function coverCropScore(width, height, cellWidth, cellHeight) {
  const fitted = fitImageRect(width, height, cellWidth, cellHeight, 'cover');
  return (fitted.width * fitted.height) / (cellWidth * cellHeight) - 1;
}

export function smartExpandSettings(photo, cellWidth, cellHeight, { autoRotate = true } = {}) {
  const current = normalizedRotation(photo.rotation);
  const candidates = autoRotate ? [current, normalizedRotation(current + 90)] : [current];
  const best = candidates.map(rotation => {
    const dimensions = rotatedDimensions(photo.width, photo.height, rotation);
    return { rotation, score: coverCropScore(dimensions.width, dimensions.height, cellWidth, cellHeight) };
  }).sort((a, b) => a.score - b.score)[0];
  return { fit: 'smart', zoom: 1, x: 0, y: 0, expandX: 1, expandY: 1, rotation: best.rotation };
}

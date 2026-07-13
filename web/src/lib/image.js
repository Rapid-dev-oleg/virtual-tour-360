// Downscale an uploaded equirectangular photo to keep it inside the browser's
// localStorage quota, and return a JPEG data URL. Equirect images are 2:1.
export function fileToPanoramaDataURL(file, maxWidth = 3200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxWidth / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = url;
  });
}

// Downscale a regular photo (any aspect) to a JPEG data URL for wall/floor/ceiling
// textures. Smaller than panoramas since many photos go into localStorage.
export function fileToPhotoDataURL(file, maxWidth = 1600, quality = 0.8) {
  return fileToPanoramaDataURL(file, maxWidth, quality);
}

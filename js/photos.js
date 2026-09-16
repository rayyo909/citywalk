/* 照片处理：EXIF GPS 提取、拍摄时间、缩略图、对象 URL 缓存 */
const Photos = (() => {
  const urlCache = new Map(); // id -> objectURL（原图）

  function url(ph) {
    if (!urlCache.has(ph.id)) {
      try { urlCache.set(ph.id, URL.createObjectURL(ph.blob)); }
      catch (e) { return ''; }
    }
    return urlCache.get(ph.id);
  }
  function revoke(id) {
    const u = urlCache.get(id);
    if (u) { URL.revokeObjectURL(u); urlCache.delete(id); }
  }

  /* 生成 ~400px 缩略图 dataURL；无法解码时退回原图 */
  async function makeThumb(file) {
    const MAX = 400;
    let bmp = null;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) {
      try { bmp = await createImageBitmap(file); } catch (e2) { bmp = null; }
    }
    if (bmp) {
      try {
        const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(bmp.width * scale));
        c.height = Math.max(1, Math.round(bmp.height * scale));
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        bmp.close && bmp.close();
        return c.toDataURL('image/jpeg', 0.75);
      } catch (e) { /* 走兜底 */ }
    }
    return await new Promise(res => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => res('');
      r.readAsDataURL(file);
    });
  }

  function parseTakenAt(v, fallback) {
    if (v instanceof Date && !isNaN(v)) return v.getTime();
    if (typeof v === 'string') {
      const t = Date.parse(v);
      if (!isNaN(t)) return t;
    }
    return fallback;
  }

  /* 批量入库，返回 {added, noGps, failed} */
  async function addFiles(files) {
    const stat = { added: 0, noGps: 0, failed: 0 };
    for (const file of files) {
      try {
        const gps = await exifr.gps(file).catch(() => null);
        let takenAt = file.lastModified;
        if (/\.jpe?g$|\.heic$|\.heif$|\.tif/i.test(file.name) || file.type === 'image/jpeg') {
          const tags = await exifr.parse(file, ['DateTimeOriginal', 'CreateDate']).catch(() => null);
          for (const k of ['DateTimeOriginal', 'CreateDate']) {
            if (tags && tags[k] != null) { takenAt = parseTakenAt(tags[k], takenAt); break; }
          }
        }
        const hasGps = gps && isFinite(gps.latitude) && isFinite(gps.longitude);
        const ph = {
          id: Util.uid(),
          name: file.name || '照片',
          takenAt,
          lat: hasGps ? +gps.latitude : null,
          lng: hasGps ? +gps.longitude : null,
          thumb: await makeThumb(file),
          blob: file,
          size: file.size,
          createdAt: Date.now(),
        };
        await DB.put('photos', ph);
        stat.added++;
        if (!hasGps) stat.noGps++;
      } catch (e) {
        console.warn('照片处理失败：', file.name, e);
        stat.failed++;
      }
    }
    return stat;
  }

  return { url, revoke, addFiles, makeThumb };
})();

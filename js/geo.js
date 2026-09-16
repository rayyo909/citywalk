/* 坐标与距离计算。
   数据统一以 WGS-84（GPS 原始坐标）存储；高德底图是 GCJ-02，渲染时临时转换。 */
const Geo = (() => {
  const toRad = d => d * Math.PI / 180;
  const EARTH_R = 6371000;

  function haversine(lat1, lng1, lat2, lng2) {
    const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /* --- WGS-84 <-> GCJ-02（国标偏移算法） --- */
  const GCJ_A = 6378245.0, GCJ_EE = 0.00669342162296594323;

  function tLat(x, y) {
    let r = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    r += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
    r += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
    r += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320.0 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
    return r;
  }
  function tLng(x, y) {
    let r = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    r += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
    r += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
    r += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
    return r;
  }
  function outOfChina(lng, lat) {
    return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
  }
  function wgs2gcj(lat, lng) {
    if (outOfChina(lng, lat)) return { lat, lng };
    let dLat = tLat(lng - 105.0, lat - 35.0);
    let dLng = tLng(lng - 105.0, lat - 35.0);
    const radLat = toRad(lat);
    let magic = Math.sin(radLat);
    magic = 1 - GCJ_EE * magic * magic;
    const sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180.0) / ((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic) * Math.PI);
    dLng = (dLng * 180.0) / (GCJ_A / sqrtMagic * Math.cos(radLat) * Math.PI);
    return { lat: lat + dLat, lng: lng + dLng };
  }
  /* 近似逆变换，误差约 1~2 米，够“手动标注照片位置”用 */
  function gcj2wgs(lat, lng) {
    const g = wgs2gcj(lat, lng);
    return { lat: 2 * lat - g.lat, lng: 2 * lng - g.lng };
  }

  /* --- Web 墨卡托瓦片（探索网格用） --- */
  function tileOf(lat, lng, z) {
    const n = 2 ** z;
    const x = Math.floor((lng + 180) / 360 * n);
    const latRad = toRad(lat);
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    return { x, y };
  }
  function y2lat(y, n) {
    return Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
  }
  /* 返回瓦片的 WGS-84 经纬度范围 */
  function tileBounds(x, y, z) {
    const n = 2 ** z;
    return {
      latMax: y2lat(y, n),
      latMin: y2lat(y + 1, n),
      lngMin: x / n * 360 - 180,
      lngMax: (x + 1) / n * 360 - 180
    };
  }
  /* 纬度 lat 处一块瓦片的近似面积（平方米） */
  function tileAreaM2(z, lat) {
    const n = 2 ** z;
    const w = 40075016.686 * Math.cos(toRad(lat)) / n;
    return w * w;
  }

  function fmtDist(m) {
    return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(2) + ' km';
  }
  function fmtDur(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
    const p = n => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${p(m)}:${p(ss)}`;
  }

  return { haversine, wgs2gcj, gcj2wgs, outOfChina, tileOf, tileBounds, tileAreaM2, fmtDist, fmtDur };
})();

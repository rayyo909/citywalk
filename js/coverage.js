/* 探索网格：把所有轨迹点映射到 Web 墨卡托瓦片格子，统计“去过的区域” */
const Coverage = (() => {
  const MAX_CELLS = 8000; // 渲染上限，防止卡顿

  function compute(tracks, zoom) {
    const set = new Set();
    let latSum = 0, n = 0;
    for (const tr of tracks) {
      for (const p of tr.points) {
        const { x, y } = Geo.tileOf(p.lat, p.lng, zoom);
        set.add(x + '_' + y);
        latSum += p.lat;
        n++;
      }
    }
    return { set, meanLat: n ? latSum / n : 0, zoom, truncated: set.size > MAX_CELLS };
  }

  /* 每个格子的 WGS-84 边界（数组形式，方便地图渲染） */
  function boundsList(cov) {
    const out = [];
    for (const key of cov.set) {
      if (out.length >= MAX_CELLS) break;
      const [x, y] = key.split('_').map(Number);
      out.push(Geo.tileBounds(x, y, cov.zoom));
    }
    return out;
  }

  function areaKm2(cov) {
    return cov.set.size * Geo.tileAreaM2(cov.zoom, cov.meanLat) / 1e6;
  }

  return { compute, boundsList, areaKm2, MAX_CELLS };
})();

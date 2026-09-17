/* 地图渲染：主地图 + 记录页实时地图共用底图工厂；
   数据一律 WGS-84，高德底图（GCJ-02）显示时自动转换 */
const MapView = (() => {
  const DEFAULT_VIEW = [31.2304, 121.4737]; // 上海
  let basemap = 'clean';
  let map = null;                 // 主地图
  const maps = [];                // 所有地图实例（含记录页）
  let groups = null;              // 主地图图层组
  let mapClickHandler = null;
  let photoClickHandler = null;

  function makeLayers() {
    return {
      gaode: () => L.tileLayer(
        'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
        { subdomains: '1234', maxZoom: 19, maxNativeZoom: 18, attribution: '© 高德地图' }),
      osm: () => L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        { maxZoom: 19, attribution: '© OpenStreetMap contributors' }),
    };
  }

  /* 底图取值：clean（高德+白纱）/ gaode（高德标准）/ osm */
  const layerKeyOf = name => name === 'clean' ? 'gaode' : name;
  const isGaodeDisp = name => name === 'gaode' || name === 'clean';

  function createMap(el) {
    const m = L.map(el, { zoomControl: false });
    const defs = makeLayers();
    const osmLayer = defs.osm();
    let osmErrors = 0;
    /* OSM 瓦片在国内网络通常无法访问，连续失败时自动切回高德 */
    osmLayer.on('tileerror', () => {
      osmErrors++;
      if (basemap === 'osm' && osmErrors >= 10) {
        osmErrors = -100000; // 防重复触发
        Util.toast('OpenStreetMap 加载失败（国内网络通常无法访问），已切回高德标准');
        window.dispatchEvent(new CustomEvent('cw-osm-fallback'));
        setBasemap('gaode');
      }
    });
    m._cwLayers = { gaode: defs.gaode(), osm: osmLayer };
    m._cwLayers[layerKeyOf(basemap)].addTo(m);
    m.getPane('tilePane').classList.toggle('cw-clean', basemap === 'clean');
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    maps.push(m);
    return m;
  }

  function init(id) {
    map = createMap(document.getElementById(id));
    map.setView(DEFAULT_VIEW, 11);
    groups = {
      cov: L.layerGroup().addTo(map),
      tracks: L.layerGroup().addTo(map),
      photos: L.layerGroup().addTo(map),
    };
    map.on('click', e => mapClickHandler && mapClickHandler(e));
  }

  /* WGS-84 -> 当前底图显示坐标 [lat,lng]（仅高德需要 GCJ 偏移） */
  function disp(lat, lng) {
    if (isGaodeDisp(basemap) && !Geo.outOfChina(lng, lat)) {
      const g = Geo.wgs2gcj(lat, lng);
      return [g.lat, g.lng];
    }
    return [lat, lng];
  }
  /* 地图点击坐标 -> WGS-84 */
  function toWgs(lat, lng) {
    if (isGaodeDisp(basemap) && !Geo.outOfChina(lng, lat)) return Geo.gcj2wgs(lat, lng);
    return { lat, lng };
  }

  function setBasemap(name) {
    basemap = name;
    const target = layerKeyOf(name);
    maps.forEach(m => {
      Object.entries(m._cwLayers).forEach(([key, layer]) => {
        if (key === target) layer.addTo(m);
        else layer.remove();
      });
      m.getPane('tilePane').classList.toggle('cw-clean', name === 'clean');
    });
  }
  const basemapName = () => basemap;

  /* 红蓝家族的克制色序：绛蓝 → 绛红 → 紫灰 → 赭褐 → 青灰 */
  const ROUTE_COLORS = ['#243C5E', '#912C34', '#5E4A6B', '#8C6A4A', '#4A6B72'];
  const palette = i => ROUTE_COLORS[i % ROUTE_COLORS.length];

  function renderTracks(tracks) {
    groups.tracks.clearLayers();
    tracks.forEach((tr, i) => {
      if (!tr.points || !tr.points.length) return;
      const ll = tr.points.map(p => disp(p.lat, p.lng));
      const popup = () =>
        `<div class="tp"><div class="tp-name">${Util.esc(tr.name)}</div>` +
        `<div class="tp-sub">${Util.fmtDate(tr.startTime)} · ${Geo.fmtDist(tr.distance)} · ${Geo.fmtDur(tr.activeMs)}</div></div>`;
      /* 路线三层：细阴影打底（立体感）+ 细小淡点轨迹 + 起终点标记 */
      const c = palette(i);
      L.polyline(ll, { color: '#1B2E49', weight: 3, opacity: 0.25, interactive: false })
        .addTo(groups.tracks);
      L.polyline(ll, {
        color: c, weight: 2.2, opacity: 0.65,
        dashArray: '0.1 6', lineCap: 'round', lineJoin: 'round',
      })
        .bindPopup(popup(), { maxWidth: 260 })
        .addTo(groups.tracks);
      /* 起点：白环 + 路线色芯；终点：白环 + 品牌橙 */
      L.circleMarker(ll[0], { radius: 3.5, color: '#ffffff', weight: 1, fillColor: c, fillOpacity: 1 })
        .addTo(groups.tracks);
      L.circleMarker(ll[ll.length - 1], { radius: 4, color: '#ffffff', weight: 1, fillColor: '#912C34', fillOpacity: 1 })
        .bindPopup(popup(), { maxWidth: 260 })
        .addTo(groups.tracks);
    });
  }

  function renderPhotos(photos) {
    groups.photos.clearLayers();
    photos.forEach(ph => {
      if (ph.lat == null || ph.lng == null) return;
      const [la, ln] = disp(ph.lat, ph.lng);
      const ic = L.divIcon({
        className: 'photo-pin',
        html: `<img src="${ph.thumb}" alt="">`,
        iconSize: [38, 38], iconAnchor: [19, 19],
      });
      L.marker([la, ln], { icon: ic, title: ph.name })
        .on('click', () => photoClickHandler && photoClickHandler(ph))
        .addTo(groups.photos);
    });
  }

  function renderCoverage(cov) {
    groups.cov.clearLayers();
    for (const b of Coverage.boundsList(cov)) {
      const c1 = disp(b.latMax, b.lngMin), c2 = disp(b.latMin, b.lngMax);
      L.rectangle([c1, c2], {
        stroke: true, color: '#912C34', weight: 0.6, opacity: 0.5,
        fillColor: '#912C34', fillOpacity: 0.22, interactive: false,
      }).addTo(groups.cov);
    }
  }
  function clearCoverage() { groups.cov && groups.cov.clearLayers(); }

  function fitAll(tracks, photos) {
    const pts = [];
    tracks.forEach(t => (t.points || []).forEach(p => pts.push(disp(p.lat, p.lng))));
    photos.forEach(p => { if (p.lat != null) pts.push(disp(p.lat, p.lng)); });
    if (!pts.length) { map.setView(DEFAULT_VIEW, 11); return; }
    map.fitBounds(L.latLngBounds(pts).pad(0.12), { maxZoom: 16 });
  }
  function flyToTrack(tr) {
    const ll = (tr.points || []).map(p => disp(p.lat, p.lng));
    if (!ll.length) return;
    map.fitBounds(L.latLngBounds(ll).pad(0.15), { maxZoom: 16 });
  }

  function locate() {
    if (!('geolocation' in navigator)) { Util.toast('此浏览器不支持定位'); return; }
    navigator.geolocation.getCurrentPosition(pos => {
      const [la, ln] = disp(pos.coords.latitude, pos.coords.longitude);
      map.setView([la, ln], 16);
      const mk = L.circleMarker([la, ln], {
        radius: 9, color: '#fff', weight: 3, fillColor: '#243C5E', fillOpacity: 1,
      }).addTo(map);
      setTimeout(() => mk.remove(), 5000);
    }, err => Util.toast('定位失败：' + (err.message || '未授权')), 
    { enableHighAccuracy: true, timeout: 10000 });
  }

  function invalidate() { map && map.invalidateSize(); }

  return {
    init, createMap, disp, toWgs, setBasemap, basemapName, trackColor: palette,
    renderTracks, renderPhotos, renderCoverage, clearCoverage,
    fitAll, flyToTrack, locate, invalidate,
    onClick: f => mapClickHandler = f,
    onPhotoClick: f => photoClickHandler = f,
  };
})();

/* 路线详情页：单路线地图 + 照片聚合图钉 + 瀑布流 + 评论 + 批量上传 */
const TrackDetail = (() => {
  let map = null;
  let layers = null;       // { track, pins }
  let track = null;
  let photos = [];         // 该路线的照片（按时间倒序）
  let onTrackDeleted = null;

  function ensureMap() {
    if (map) return;
    map = MapView.createMap(document.getElementById('detail-map'));
    map.setView([31.2304, 121.4737], 14);
    layers = {
      track: L.layerGroup().addTo(map),
      pins: L.layerGroup().addTo(map),
    };
  }

  /* 单条路线渲染（与首页一致的点状样式） */
  function renderTrack(colorIdx) {
    layers.track.clearLayers();
    const ll = track.points.map(p => MapView.disp(p.lat, p.lng));
    if (!ll.length) return;
    const c = MapView.trackColor(colorIdx);
    const popup = `<div class="tp"><div class="tp-name">${Util.esc(track.name)}</div>` +
      `<div class="tp-sub">${Util.fmtDate(track.startTime)} · ${Geo.fmtDist(track.distance)} · ${Geo.fmtDur(track.activeMs)}</div></div>`;
    L.polyline(ll, { color: '#1B2E49', weight: 3, opacity: 0.25, interactive: false }).addTo(layers.track);
    L.polyline(ll, {
      color: c, weight: 2.2, opacity: 0.65,
      dashArray: '0.1 6', lineCap: 'round', lineJoin: 'round',
    }).addTo(layers.track);
    L.circleMarker(ll[0], { radius: 3.5, color: '#ffffff', weight: 1, fillColor: c, fillOpacity: 1 }).addTo(layers.track);
    L.circleMarker(ll[ll.length - 1], { radius: 4, color: '#ffffff', weight: 1, fillColor: '#912C34', fillOpacity: 1 })
      .bindPopup(popup, { maxWidth: 260 }).addTo(layers.track);
    map.fitBounds(L.latLngBounds(ll).pad(0.18), { maxZoom: 16 });
  }

  /* 照片按 z18 瓦片格（约 150m）聚合；单击单张直接打开，多张弹出缩略图组 */
  function renderPins() {
    layers.pins.clearLayers();
    const groups = new Map();
    for (const ph of photos) {
      if (ph.lat == null || ph.lng == null) continue;
      const { x, y } = Geo.tileOf(ph.lat, ph.lng, 18);
      const key = x + '_' + y;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(ph);
    }
    for (const grp of groups.values()) {
      const la = grp.reduce((s, p) => s + p.lat, 0) / grp.length;
      const ln = grp.reduce((s, p) => s + p.lng, 0) / grp.length;
      const [dLat, dLng] = MapView.disp(la, ln);
      if (grp.length === 1) {
        const ph = grp[0];
        const ic = L.divIcon({
          className: 'photo-pin',
          html: `<img src="${ph.thumb}" alt="">`,
          iconSize: [38, 38], iconAnchor: [19, 19],
        });
        L.marker([dLat, dLng], { icon: ic }).on('click', () => App.openPhoto(ph)).addTo(layers.pins);
      } else {
        const ic = L.divIcon({
          className: 'cluster-pin',
          html: `<img src="${grp[0].thumb}" alt=""><span class="cluster-badge">${grp.length}</span>`,
          iconSize: [44, 44], iconAnchor: [22, 22],
        });
        L.marker([dLat, dLng], { icon: ic })
          .bindPopup(`<div class="pin-thumbs">${grp.map((p, i) =>
            `<img data-i="${i}" src="${p.thumb}" alt="">`).join('')}</div>`, { maxWidth: 280 })
          .on('popupopen', e => {
            e.popup.getElement().querySelectorAll('.pin-thumbs img').forEach(img => {
              img.onclick = () => App.openPhoto(grp[+img.dataset.i]);
            });
          })
          .addTo(layers.pins);
      }
    }
  }

  function renderFalls() {
    const box = document.getElementById('detail-falls');
    document.getElementById('detail-photo-count').textContent = photos.length ? `(${photos.length})` : '';
    document.getElementById('detail-photo-hint').classList.toggle('hidden', photos.length > 0);
    if (!photos.length) {
      box.innerHTML = '<div class="falls-empty">这条路线还没有照片，点右上「批量上传」添加</div>';
      return;
    }
    box.innerHTML = photos.map(ph => {
      const t = new Date(ph.takenAt);
      const p2 = n => String(n).padStart(2, '0');
      const timeStr = `${p2(t.getHours())}:${p2(t.getMinutes())}`;
      const posStr = ph.place
        ? Util.esc(ph.place)
        : (ph.lat != null ? (ph._placeTried ? '已定位' : '地址解析中…') : '未标注位置');
      const cmt = ph.comment
        ? `<div class="fm-comment">${Util.esc(ph.comment)}</div>`
        : '<div class="fm-comment placeholder">点击添加评论…</div>';
      return `<div class="fall-card" data-id="${ph.id}">
        ${ph.thumb ? `<img src="${ph.thumb}" loading="lazy" alt="">` : ''}
        <div class="fall-meta"><div class="fm-line">${timeStr} · ${posStr}</div>${cmt}</div>
      </div>`;
    }).join('');
  }

  function renderInfo(colorIdx) {
    document.getElementById('detail-title').textContent = track.name;
    document.getElementById('di-name').textContent = track.name;
    document.getElementById('di-sub').textContent =
      `${Util.fmtDate(track.startTime)} ${Util.fmtDateTime(track.startTime).slice(11)} · ` +
      `${Geo.fmtDist(track.distance)} · ${Geo.fmtDur(track.activeMs)}`;
    document.title = track.name + ' · 去走走 Walkies';
  }

  function renderAll(colorIdx) {
    renderInfo(colorIdx);
    renderTrack(colorIdx);
    renderPins();
    renderFalls();
  }

  async function refreshPhotos() {
    if (!track) return;
    const all = await DB.getAll('photos');
    photos = all.filter(p => p.trackId === track.id).sort((a, b) => b.takenAt - a.takenAt);
    renderPins();
    renderFalls();
    /* 缺地名的照片异步补全（Photon 逆地理），失败后显示"已定位"兜底 */
    Photos.ensurePlaces(photos, () => {
      photos.forEach(p => { if (p.lat != null && !p.place) p._placeTried = true; });
      renderPins();
      renderFalls();
    });
  }

  /* 入口：tr 为路线对象，colorIdx 用于与首页同色 */
  function open(tr, colorIdx, opts = {}) {
    track = tr;
    onTrackDeleted = opts.onDeleted || null;
    ensureMap();
    App.showPage('detail');
    renderAll(colorIdx);
    refreshPhotos();
    setTimeout(() => map && map.invalidateSize(), 80);
    setTimeout(() => map && map.invalidateSize(), 450);
  }

  function bindUI() {
    document.getElementById('detail-back').onclick = () => {
      document.title = '去走走 Walkies';
      App.showPage('tracks');
    };
    document.getElementById('di-rename').onclick = async () => {
      const name = await Util.promptModal('重命名路线', { value: track.name });
      if (name) {
        track.name = name;
        await DB.put('tracks', track);
        App.reload();
        renderInfo();
      }
    };
    document.getElementById('di-gpx').onclick = () => App.exportTrackGPX(track);
    document.getElementById('di-del').onclick = async () => {
      if (!(await Util.confirmModal('删除路线', `删除「${track.name}」后无法恢复（路线照片会保留为未归类）。`, '删除', true))) return;
      await DB.del('tracks', track.id);
      document.title = '去走走 Walkies';
      App.reload();
      if (onTrackDeleted) onTrackDeleted();
    };
    document.getElementById('btn-detail-photo').onclick = () =>
      document.getElementById('file-detail-photos').click();
    document.getElementById('file-detail-photos').onchange = async e => {
      const files = [...e.target.files];
      e.target.value = '';
      if (!files.length) return;
      Util.toast(`正在处理 ${files.length} 张照片…`, 8000);
      const stat = await Photos.addFiles(files, track.id);
      /* 无 EXIS 位置的照片按拍摄时间在轨迹上回填位置 */
      const allNow = await DB.getAll('photos');
      const located = await Photos.locatePhotosOnTrack(
        track, allNow.filter(p => p.trackId === track.id));
      await refreshPhotos();
      App.reload();
      Util.toast(`已添加 ${stat.added} 张照片` +
        (located ? `，${located} 张已按轨迹定位` : (stat.noGps ? '（无位置信息）' : '')));
    };
    document.getElementById('detail-falls').onclick = e => {
      const card = e.target.closest('.fall-card');
      if (!card) return;
      const ph = photos.find(p => p.id === card.dataset.id);
      if (ph) App.openPhoto(ph, refreshPhotos);
    };
  }

  let bound = false;
  function init() {
    if (bound) return;
    bound = true;
    bindUI();
  }

  return { open, init, refreshPhotos };
})();

/* 应用主逻辑：页面导航、GO 记录、路线列表/详情、照片（路线关联/评论/标注）、导入导出 */
const App = (() => {
  let tracks = [], photos = [];

  let settings;
  try {
    settings = Object.assign(
      { basemap: 'clean', showTracks: true, showPhotos: true, showCoverage: false, gridZoom: 15 },
      JSON.parse(localStorage.getItem('cw-settings') || '{}'));
  } catch (e) {
    settings = { basemap: 'clean', showTracks: true, showPhotos: true, showCoverage: false, gridZoom: 15 };
  }
  /* 底图取值仅 clean/gaode/osm，历史遗留值一律归到清新 */
  if (!['clean', 'gaode', 'osm'].includes(settings.basemap)) settings.basemap = 'clean';
  settings.v = 4;
  const saveSettings = () => {
    settings.v = 4;
    localStorage.setItem('cw-settings', JSON.stringify(settings));
  };
  const setRadio = v => {
    const r = document.querySelector(`input[name=basemap][value="${v}"]`);
    if (r) r.checked = true;
  };

  /* ---------- 页面导航 ---------- */
  function showPage(name) {
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + name));
    if (name === 'map') setTimeout(() => MapView.invalidate(), 60);
    if (name === 'record') {
      ensureRecMap();
      setTimeout(() => recMap && recMap.invalidateSize(), 60);
    }
  }
  function activePage() {
    const el = document.querySelector('.page.active');
    return el ? el.id.replace('page-', '') : 'map';
  }

  /* ---------- 记录页实时地图 ---------- */
  let recMap = null, liveLine = null, liveDot = null, lastPanT = 0;

  function ensureRecMap() {
    if (recMap) return;
    recMap = MapView.createMap(document.getElementById('rec-map'));
    recMap.setView([31.2304, 121.4737], 15);
    liveLine = L.polyline([], { color: '#243C5E', weight: 5, opacity: 0.9 }).addTo(recMap);
    liveDot = L.circleMarker([0, 0], {
      radius: 8, color: '#fff', weight: 3, fillColor: '#243C5E', fillOpacity: 1,
    }).addTo(recMap);
    const s = Tracker.snapshot();
    if (s.points.length) updateLive(s, true);
  }
  function updateLive(s, force) {
    if (!recMap) return;
    const ll = s.points.map(p => MapView.disp(p.lat, p.lng));
    liveLine.setLatLngs(ll);
    if (ll.length) {
      liveDot.setLatLng(ll[ll.length - 1]);
      const now = Date.now();
      if (force || now - lastPanT > 4000) {
        recMap.panTo(ll[ll.length - 1], { animate: true });
        lastPanT = now;
      }
    }
  }

  function renderRecordUI(s) {
    const stateHtml = s.state === 'recording'
      ? '<span class="live-dot"></span>记录中'
      : (s.state === 'paused' ? '已暂停' : '准备就绪');
    const msg = s.msg ? ' · ' + s.msg : '';
    document.getElementById('rec-state').innerHTML = stateHtml + Util.esc(msg);

    document.getElementById('rec-dist').innerHTML =
      (s.distance / 1000).toFixed(2) + '<span class="unit">km</span>';
    document.getElementById('rec-dur').textContent = Geo.fmtDur(s.activeMs);
    document.getElementById('rec-pts').textContent = s.pointCount;
    document.getElementById('rec-acc').textContent = s.acc ? Math.round(s.acc) + ' m' : '--';

    const idle = s.state === 'idle';
    document.getElementById('btn-rec-start').classList.toggle('hidden', !idle);
    document.getElementById('btn-rec-pause').classList.toggle('hidden', idle);
    document.getElementById('btn-rec-finish').classList.toggle('hidden', idle);
    document.getElementById('btn-rec-photo').classList.toggle('hidden', idle);
    document.getElementById('btn-rec-pause').textContent =
      s.state === 'recording' ? '暂停' : '继续';

    /* GO 按钮状态 */
    const go = document.getElementById('btn-go');
    go.classList.toggle('recording', !idle);
    go.querySelector('.go-label').textContent =
      idle ? 'GO' : (s.state === 'recording' ? '记录中' : '已暂停');

    updateLive(s);
  }

  const defaultName = ts => Util.fmtDate(ts || Date.now()) + ' 去走走';

  async function onFinishClick() {
    if (Tracker.getState() === 'idle') return;
    Tracker.pause();
    const s = Tracker.snapshot();
    if (!s.pointCount) {
      if (await Util.confirmModal('没有记录到轨迹', '本次没有获取到任何 GPS 点（可能未授权定位），是否放弃？', '放弃', true)) {
        Tracker.discard();
      }
      return;
    }
    const wrap = document.createElement('div');
    const inp = document.createElement('input');
    inp.className = 'input';
    inp.value = defaultName();
    inp.placeholder = '给这次行走起个名字';
    wrap.appendChild(inp);
    const act = await Util.openModal({
      title: '结束记录',
      content: wrap,
      actions: [
        { label: '继续记录', value: 'resume' },
        { label: '放弃', value: 'discard', className: 'btn-danger-ghost' },
        { label: '保存', value: 'save', className: 'btn-primary' },
      ],
    });
    if (act === 'resume') { Tracker.resume(); return; }
    if (act === 'discard') {
      if (await Util.confirmModal('放弃路线', '放弃后本次记录的轨迹将被删除（已拍的照片保留为未归类）。', '放弃', true)) Tracker.discard();
      return;
    }
    if (act === 'save') {
      const tr = Tracker.finishTrack();
      tr.name = inp.value.trim() || defaultName(tr.startTime);
      await DB.put('tracks', tr);
      await reload();
      showPage('map');
      MapView.flyToTrack(tr);
      Util.toast('路线已保存 🎉');
    }
  }

  function centerRecMapOnce() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pos => {
        if (recMap && Tracker.snapshot().pointCount < 3) {
          const [la, ln] = MapView.disp(pos.coords.latitude, pos.coords.longitude);
          recMap.setView([la, ln], 16);
        }
      }, () => { }, { enableHighAccuracy: true, timeout: 8000 });
    }
  }

  function bindRecordUI() {
    document.getElementById('btn-rec-start').onclick = () => { Tracker.start(); centerRecMapOnce(); };
    document.getElementById('btn-rec-pause').onclick = () => {
      Tracker.getState() === 'recording' ? Tracker.pause() : Tracker.resume();
    };
    document.getElementById('btn-rec-finish').onclick = onFinishClick;
    /* 记录中随手拍：照片直接关联正在记录的路线 */
    document.getElementById('btn-rec-photo').onclick = () =>
      document.getElementById('file-rec-photos').click();
    document.getElementById('file-rec-photos').onchange = async e => {
      const files = [...e.target.files];
      e.target.value = '';
      if (!files.length) return;
      Util.toast(`正在处理 ${files.length} 张照片…`, 8000);
      const stat = await Photos.addFiles(files, Tracker.getRecId());
      await reload();
      Util.toast(`已添加 ${stat.added} 张到本次路线 📷`);
    };
  }

  /* ---------- 地图页控件 ---------- */
  function probeTile(url, timeoutMs = 4000) {
    return new Promise(resolve => {
      const img = new Image();
      const timer = setTimeout(() => { img.src = ''; resolve(false); }, timeoutMs);
      img.onload = () => { clearTimeout(timer); resolve(true); };
      img.onerror = () => { clearTimeout(timer); resolve(false); };
      img.src = url + (url.includes('?') ? '&' : '?') + '_=' + Date.now();
    });
  }
  const PROBE_URLS = {
    osm: 'https://a.tile.openstreetmap.org/12/3370/1698.png',
  };

  function bindMapControls() {
    document.getElementById('btn-locate').onclick = () => MapView.locate();
    document.getElementById('btn-fit').onclick = () => MapView.fitAll(tracks, photos);
    const panel = document.getElementById('layers-panel');
    document.getElementById('btn-layers').onclick = () => panel.classList.toggle('hidden');
    /* 点击面板与图层按钮以外的任意位置（含地图）时收起面板 */
    document.addEventListener('click', e => {
      if (panel.classList.contains('hidden')) return;
      if (panel.contains(e.target) || e.target.closest('#btn-layers')) return;
      panel.classList.add('hidden');
    });

    Util.$$('input[name=basemap]').forEach(r => {
      r.checked = r.value === settings.basemap;
      r.onchange = async () => {
        if (!r.checked) return;
        if (PROBE_URLS[r.value]) {
          Util.toast('正在测试该底图连通性…', 4000);
          if (!(await probeTile(PROBE_URLS[r.value]))) {
            settings.basemap = 'gaode';
            saveSettings();
            setRadio('gaode');
            Util.toast('此底图当前无法连接，已切回高德标准');
            return;
          }
        }
        settings.basemap = r.value;
        saveSettings();
        MapView.setBasemap(r.value);
        renderAll();
      };
    });
    const ckT = document.getElementById('ck-tracks');
    const ckP = document.getElementById('ck-photos');
    const ckC = document.getElementById('ck-coverage');
    const selG = document.getElementById('sel-grid');
    ckT.checked = settings.showTracks; ckP.checked = settings.showPhotos;
    ckC.checked = settings.showCoverage; selG.value = settings.gridZoom;
    ckT.onchange = e => { settings.showTracks = e.target.checked; saveSettings(); renderAll(); };
    ckP.onchange = e => { settings.showPhotos = e.target.checked; saveSettings(); renderAll(); };
    ckC.onchange = e => { settings.showCoverage = e.target.checked; saveSettings(); renderCoverageLayer(); };
    selG.onchange = e => { settings.gridZoom = +e.target.value; saveSettings(); renderCoverageLayer(); };
  }

  function renderCoverageLayer() {
    if (!settings.showCoverage) { MapView.clearCoverage(); return; }
    const cov = Coverage.compute(tracks, settings.gridZoom);
    MapView.renderCoverage(cov);
  }

  /* ---------- 路线列表页 ---------- */
  function photoCountOf(trackId) {
    return photos.filter(p => p.trackId === trackId).length;
  }

  function renderTracksPage() {
    const box = document.getElementById('tracks-list-page');
    document.getElementById('tracks-count').textContent = tracks.length ? `(${tracks.length})` : '';
    if (!tracks.length) {
      box.innerHTML = '<div class="tracks-empty">还没有路线<br>回到地图，点中间的 GO 开始第一次行走吧</div>';
    } else {
      box.innerHTML = tracks.map((tr, i) => {
        const n = photoCountOf(tr.id);
        return `<div class="tracks-row" data-id="${tr.id}">
          <span class="track-dot" style="background:${MapView.trackColor(i)}"></span>
          <div class="ti-main">
            <div class="ti-name ellipsis">${Util.esc(tr.name)}</div>
            <div class="ti-sub">${Util.fmtDate(tr.startTime)} · ${Geo.fmtDist(tr.distance)} · ${Geo.fmtDur(tr.activeMs)}</div>
          </div>
          ${n ? `<span class="ti-photo">📷 ${n}</span>` : ''}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--muted)"><path d="M9 5l7 7-7 7"/></svg>
        </div>`;
      }).join('');
    }
    renderOrphans();
  }

  function renderOrphans() {
    const card = document.getElementById('orphan-card');
    const trackIds = new Set(tracks.map(t => t.id));
    const orphans = photos.filter(p => !p.trackId || !trackIds.has(p.trackId));
    card.classList.toggle('hidden', !orphans.length);
    if (!orphans.length) return;
    document.getElementById('orphan-count').textContent = `(${orphans.length})`;
    const grid = document.getElementById('orphan-grid');
    grid.innerHTML = orphans.map(ph => `
      <div class="pg-item" data-id="${ph.id}">
        ${ph.thumb ? `<img src="${ph.thumb}" loading="lazy" alt="">` : ''}
        ${ph.lat == null ? '<span class="pg-badge">无位置</span>' : ''}
      </div>`).join('');
  }

  function bindTracksPage() {
    document.getElementById('tracks-list-page').onclick = e => {
      const row = e.target.closest('.tracks-row');
      if (!row) return;
      const idx = tracks.findIndex(t => t.id === row.dataset.id);
      if (idx < 0) return;
      TrackDetail.open(tracks[idx], idx);
    };
    document.getElementById('orphan-grid').onclick = e => {
      const item = e.target.closest('.pg-item');
      if (!item) return;
      const ph = photos.find(p => p.id === item.dataset.id);
      if (ph) openPhoto(ph);
    };
  }

  /* ---------- 统计条 ---------- */
  function fmtHhMm(ms) {
    const m = Math.round(ms / 60000);
    return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  }
  function renderStatBar() {
    const ms = tracks.reduce((s, t) => s + (t.activeMs || 0), 0);
    const km = tracks.reduce((s, t) => s + (t.distance || 0), 0) / 1000;
    const area = tracks.length ? Coverage.areaKm2(Coverage.compute(tracks, 15)) : 0;
    document.getElementById('stat-bar').innerHTML =
      `⏱ <b>${fmtHhMm(ms)}</b>&nbsp; ↗ <b>${km.toFixed(1)}</b> km &nbsp; ▦ <b>${area.toFixed(1)}</b> km²`;
  }

  /* ---------- 照片详情弹窗（右上角×关闭；地址名；评论/删除） ---------- */
  async function openPhoto(ph, refresh) {
    const content = document.createElement('div');
    const d = new Date(ph.takenAt);
    const p2 = n => String(n).padStart(2, '0');
    const timeStr = `${Util.fmtDate(ph.takenAt)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
    const placeStr = ph.place || (ph.lat != null ? '地址解析中…' : '未标注位置');
    content.innerHTML = `
      <img class="pd-img-full" src="${Photos.url(ph)}" alt="">
      <div class="pd-meta-v2">${timeStr} · ${Util.esc(placeStr)}${ph.comment ? '<br>💬 ' + Util.esc(ph.comment) : ''}</div>`;
    const act = await Util.openModal({
      title: '', closable: true, plain: true, content,
      actions: [
        { label: '评论', value: 'comment' },
        { label: '删除', value: 'del', className: 'btn-danger-ghost' },
      ],
    });
    if (act === 'comment') {
      const c = await Util.promptModal('照片评论', { value: ph.comment || '', placeholder: '写下这一刻…' });
      if (c !== null) {
        ph.comment = c;
        await DB.put('photos', ph);
        await reload();
        refresh && refresh();
      }
    } else if (act === 'del') {
      if (await Util.confirmModal('删除照片', '删除后无法恢复。', '删除', true)) {
        await DB.del('photos', ph.id);
        Photos.revoke(ph.id);
        await reload();
        refresh && refresh();
      }
    }
  }

  /* 手动标注照片位置：进入点选模式，点地图放置 */
  let placing = null;
  function startPlacing(ph) {
    placing = ph.id;
    showPage('map');
    document.getElementById('placing-text').textContent = `点击地图放置「${ph.name}」的拍摄位置`;
    document.getElementById('placing-banner').classList.remove('hidden');
  }
  function cancelPlacing() {
    placing = null;
    document.getElementById('placing-banner').classList.add('hidden');
  }

  function bindPhotosUI() {
    document.getElementById('placing-cancel').onclick = cancelPlacing;
    MapView.onClick(async e => {
      if (!placing) return;
      const ph = photos.find(p => p.id === placing);
      cancelPlacing();
      if (!ph) return;
      const { lat, lng } = MapView.toWgs(e.latlng.lat, e.latlng.lng);
      ph.lat = lat; ph.lng = lng;
      await DB.put('photos', ph);
      await reload();
      Util.toast('已标注位置 📍');
    });
    MapView.onPhotoClick(ph => openPhoto(ph));
  }

  /* ---------- 备份提醒 ---------- */
  function updateBackupStatus() {
    const el = document.getElementById('backup-status');
    if (!el) return;
    const last = +(localStorage.getItem('cw-last-backup') || 0);
    const stale = !last || Date.now() - last > 7 * 86400000;
    el.textContent = last
      ? `上次备份：${Util.fmtDateTime(last)}` + (stale ? ' · 已超过 7 天，建议重新导出' : '')
      : '数据只保存在本机（卸载/删除主屏幕图标会被清空），建议尽快导出一份备份';
    el.classList.toggle('stale', stale && tracks.length > 0);
  }
  function maybeRemindBackup() {
    if (!tracks.length) return;
    if (sessionStorage.getItem('cw-backup-reminded')) return;
    const last = +(localStorage.getItem('cw-last-backup') || 0);
    if (last && Date.now() - last < 7 * 86400000) return;
    sessionStorage.setItem('cw-backup-reminded', '1');
    Util.toast('数据仅存本机，建议到「设置 → 导出全部数据」做备份', 4500);
  }

  /* ---------- 设置页 ---------- */
  const blobToDataURL = b => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(b);
  });

  function exportTrackGPX(tr) {
    const pts = tr.points.map(p =>
      `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}"><time>${new Date(p.t).toISOString()}</time></trkpt>`
    ).join('\n');
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="去走走 Walkies" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk>\n    <name>${Util.esc(tr.name)}</name>\n    <trkseg>\n${pts}\n    </trkseg>\n  </trk>\n</gpx>`;
    Util.downloadFile(gpx, tr.name.replace(/[\\/:*?"<>|]/g, '_') + '.gpx', 'application/gpx+xml');
  }

  async function importGPX(file) {
    const doc = new DOMParser().parseFromString(await file.text(), 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('bad gpx');
    const name = (doc.querySelector('trk > name')?.textContent || '').trim() ||
      file.name.replace(/\.gpx$/i, '');
    const els = [...doc.querySelectorAll('trkpt')];
    if (!els.length) throw new Error('empty gpx');
    const points = els.map(el => {
      const t = Date.parse(el.querySelector('time')?.textContent || '');
      return { lat: +el.getAttribute('lat'), lng: +el.getAttribute('lon'), t: isNaN(t) ? 0 : t };
    }).filter(p => isFinite(p.lat) && isFinite(p.lng));
    let distance = 0;
    for (let i = 1; i < points.length; i++)
      distance += Geo.haversine(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
    const withT = points.filter(p => p.t > 0);
    const startTime = withT.length ? withT[0].t : Date.now();
    const endTime = withT.length ? withT[withT.length - 1].t : startTime + points.length * 5000;
    const track = {
      id: Util.uid(), name: name + '（GPX）', startTime, endTime,
      activeMs: Math.max(0, endTime - startTime),
      distance: Math.round(distance), points,
    };
    await DB.put('tracks', track);
    return track;
  }

  function bindSettingsUI() {
    document.getElementById('btn-export').onclick = async () => {
      if (!tracks.length && !photos.length) { Util.toast('还没有数据可导出'); return; }
      Util.toast('正在打包…');
      const data = { app: 'walkies', version: 1, exportedAt: Date.now(), tracks, photos: [] };
      for (const ph of photos) {
        const { blob, ...rest } = ph;
        data.photos.push({ ...rest, blobB64: await blobToDataURL(blob) });
      }
      Util.downloadFile(JSON.stringify(data),
        `walkies-backup-${Util.fmtDate(Date.now())}.json`, 'application/json');
      localStorage.setItem('cw-last-backup', String(Date.now()));
      updateBackupStatus();
      Util.toast('已导出，请妥善保存该文件');
    };

    document.getElementById('btn-import').onclick = () =>
      document.getElementById('file-import').click();
    document.getElementById('file-import').onchange = async e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (!['citywalk', 'walkies'].includes(data.app) || !data.version) throw new Error('bad');
        for (const t of (data.tracks || [])) await DB.put('tracks', t);
        for (const p of (data.photos || [])) {
          delete p.blob;
          if (p.blobB64) { p.blob = await (await fetch(p.blobB64)).blob(); delete p.blobB64; }
          await DB.put('photos', p);
        }
        await reload();
        Util.toast('导入完成');
      } catch (err) {
        Util.toast('导入失败：文件格式不正确');
      }
    };

    document.getElementById('btn-import-gpx').onclick = () =>
      document.getElementById('file-gpx').click();
    document.getElementById('file-gpx').onchange = async e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const tr = await importGPX(f);
        await reload();
        showPage('map');
        MapView.flyToTrack(tr);
        Util.toast('GPX 路线已导入');
      } catch (err) {
        Util.toast('导入失败：不是有效的 GPX 文件');
      }
    };

    document.getElementById('btn-demo').onclick = genDemo;

    document.getElementById('btn-clear').onclick = async () => {
      if (await Util.confirmModal('清空全部数据', '将删除所有路线和照片，且无法恢复。建议先导出备份。', '确认清空', true)) {
        await DB.clear('tracks');
        await DB.clear('photos');
        photos.forEach(p => Photos.revoke(p.id));
        await reload();
        Util.toast('已清空');
      }
    };
  }

  /* ---------- 示例数据 ---------- */
  function genPoints(wps, stepM, t0, dtMs) {
    const pts = []; let t = t0;
    for (let i = 0; i < wps.length - 1; i++) {
      const [a1, o1] = wps[i], [a2, o2] = wps[i + 1];
      const n = Math.max(1, Math.round(Geo.haversine(a1, o1, a2, o2) / stepM));
      for (let j = 0; j < n; j++) {
        const f = j / n;
        pts.push({
          lat: a1 + (a2 - a1) * f + (Math.random() - 0.5) * 0.00006,
          lng: o1 + (o2 - o1) * f + (Math.random() - 0.5) * 0.00007,
          t: Math.round(t),
        });
        t += dtMs;
      }
    }
    const last = wps[wps.length - 1];
    pts.push({ lat: last[0], lng: last[1], t: Math.round(t) });
    return pts;
  }

  async function genDemo() {
    const day = 86400000, now = Date.now();
    const routes = [
      { name: "人民广场 → 南京东路 → 外滩（示例）", d: now - 21 * day,
        wps: [[31.2286, 121.4692], [31.2322, 121.4755], [31.2352, 121.4790], [31.2367, 121.4838], [31.2386, 121.4869], [31.2403, 121.4901]] },
      { name: "武康路 → 安福路 → 淮海中路（示例）", d: now - 13 * day,
        wps: [[31.2076, 121.4370], [31.2088, 121.4409], [31.2106, 121.4442], [31.2125, 121.4464], [31.2140, 121.4496]] },
      { name: "豫园 → 新天地 → 田子坊（示例）", d: now - 6 * day,
        wps: [[31.2270, 121.4921], [31.2254, 121.4866], [31.2215, 121.4802], [31.2178, 121.4758], [31.2142, 121.4709], [31.2110, 121.4665]] },
    ];
    for (const r of routes) {
      const points = genPoints(r.wps, 15, r.d, 11000);
      let distance = 0;
      for (let i = 1; i < points.length; i++)
        distance += Geo.haversine(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
      await DB.put('tracks', {
        id: Util.uid(), name: r.name, startTime: points[0].t, endTime: points[points.length - 1].t,
        activeMs: points[points.length - 1].t - points[0].t, distance: Math.round(distance), points,
      });
    }
    await reload();
    showPage('map');
    MapView.fitAll(tracks, photos);
    Util.toast('已生成 3 条示例路线');
  }

  /* ---------- 汇总渲染 ---------- */
  function renderAll() {
    MapView.renderTracks(settings.showTracks ? tracks : []);
    MapView.renderPhotos(settings.showPhotos ? photos : []);
    renderCoverageLayer();
    renderTracksPage();
    renderStatBar();
  }

  async function reload() {
    tracks = (await DB.getAll('tracks')).sort((a, b) => b.startTime - a.startTime);
    photos = (await DB.getAll('photos')).sort((a, b) => b.takenAt - a.takenAt);
    renderAll();
    updateBackupStatus();
    TrackDetail.refreshPhotos();
  }

  /* ---------- 启动 ---------- */
  async function init() {
    MapView.init('map');
    TrackDetail.init();

    /* 导航 */
    document.querySelectorAll('[data-back]').forEach(b => b.onclick = () => showPage('map'));
    document.getElementById('btn-switch').onclick = () => showPage('tracks');
    document.getElementById('btn-avatar').onclick = () => showPage('settings');

    /* GO：空闲=开始记录并进入记录页；记录中=回到记录页 */
    document.getElementById('btn-go').onclick = () => {
      if (Tracker.getState() === 'idle') {
        showPage('record');
        Tracker.start();
        centerRecMapOnce();
      } else {
        showPage('record');
      }
    };

    bindMapControls();
    bindRecordUI();
    bindTracksPage();
    bindPhotosUI();
    bindSettingsUI();
    Tracker.onChange(renderRecordUI);
    window.addEventListener('beforeunload', e => {
      if (Tracker.getState() === 'recording') { e.preventDefault(); e.returnValue = ''; }
    });
    const restored = Tracker.restore();
    await reload();
    renderRecordUI(Tracker.snapshot());
    if (restored) Util.toast('已恢复上次未完成的路线（已暂停），点 GO 继续');
    updateBackupStatus();
    maybeRemindBackup();

    /* 启动时恢复已保存的底图（OSM 先探测可达性，不通则退回高德标准） */
    if (MapView.basemapName() !== settings.basemap) {
      if (PROBE_URLS[settings.basemap]) {
        probeTile(PROBE_URLS[settings.basemap]).then(ok => {
          if (ok) { MapView.setBasemap(settings.basemap); renderAll(); }
          else {
            settings.basemap = 'gaode';
            saveSettings();
            setRadio('gaode');
          }
        });
      } else {
        MapView.setBasemap(settings.basemap);
      }
    }

    window.addEventListener('cw-geo-denied', () => {
      Util.openModal({
        title: '无法获取定位权限',
        content: `
          <p class="modal-text">按顺序检查这三件事：</p>
          <p class="modal-text"><b>1. 是否在微信/QQ 里打开的？</b><br>内置浏览器会禁用网页定位。点右上角「···」→「在浏览器打开」，或复制链接到 Safari / Chrome 再试。</p>
          <p class="modal-text"><b>2. iPhone</b><br>设置 → 隐私与安全性 → 定位服务 → 打开总开关，并把列表中的「Safari 网站」设为「使用 App 期间」（添加到主屏幕的显示为去走走）。若之前拒绝过，改完回到本页刷新。</p>
          <p class="modal-text"><b>3. 安卓</b><br>点地址栏左侧的锁图标 → 权限 → 位置 → 允许，然后刷新页面。</p>`,
        actions: [{ label: '知道了', value: 'ok', className: 'btn-primary' }],
      });
    });

    /* OSM 瓦片不可达时 mapView 会切回高德并触发此事件，同步设置和界面 */
    window.addEventListener('cw-osm-fallback', () => {
      settings.basemap = 'gaode';
      saveSettings();
      setRadio('gaode');
      renderAll();
    });
  }

  return {
    init, reload, showPage, openPhoto, exportTrackGPX,
    get tracks() { return tracks; },
  };
})();

document.addEventListener('DOMContentLoaded', () => App.init());

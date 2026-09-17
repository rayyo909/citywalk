/* 应用主逻辑：页面路由、路线/照片管理、记录流程、数据导入导出 */
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

  /* ---------- 记录页实时地图 ---------- */
  let recMap = null, liveLine = null, liveDot = null, lastPanT = 0;

  function ensureRecMap() {
    if (recMap) return;
    recMap = MapView.createMap(document.getElementById('rec-map'));
    recMap.setView([31.2304, 121.4737], 15);
    liveLine = L.polyline([], { color: '#0d9488', weight: 5, opacity: 0.9 }).addTo(recMap);
    liveDot = L.circleMarker([0, 0], {
      radius: 8, color: '#fff', weight: 3, fillColor: '#0d9488', fillOpacity: 1,
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
    document.getElementById('btn-rec-pause').textContent =
      s.state === 'recording' ? '暂停' : '继续';

    updateLive(s);
  }

  const defaultName = ts => Util.fmtDate(ts || Date.now()) + ' 走走';

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
      if (await Util.confirmModal('放弃路线', '放弃后本次记录的轨迹将被删除。', '放弃', true)) Tracker.discard();
      return;
    }
    if (act === 'save') {
      const tr = Tracker.finishTrack();
      tr.name = inp.value.trim() || defaultName(tr.startTime);
      await DB.put('tracks', tr);
      await reload();
      switchTab('map');
      MapView.flyToTrack(tr);
      Util.toast('路线已保存 🎉');
    }
  }

  function bindRecordUI() {
    document.getElementById('btn-rec-start').onclick = () => {
      Tracker.start();
      // 尚未有轨迹点时，先一次性定位把实时地图居中
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
          if (recMap && Tracker.snapshot().pointCount < 3) {
            const [la, ln] = MapView.disp(pos.coords.latitude, pos.coords.longitude);
            recMap.setView([la, ln], 16);
          }
        }, () => { }, { enableHighAccuracy: true, timeout: 8000 });
      }
    };
    document.getElementById('btn-rec-pause').onclick = () => {
      Tracker.getState() === 'recording' ? Tracker.pause() : Tracker.resume();
    };
    document.getElementById('btn-rec-finish').onclick = onFinishClick;
  }

  /* ---------- 页面切换 ---------- */
  function switchTab(page) {
    Util.$$('.tab').forEach(b => b.classList.toggle('active', b.dataset.page === page));
    Util.$$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));
    if (page === 'map') setTimeout(() => MapView.invalidate(), 60);
    if (page === 'record') {
      ensureRecMap();
      setTimeout(() => recMap && recMap.invalidateSize(), 60);
    }
  }
  function bindTabs() {
    Util.$$('.tab').forEach(b => b.onclick = () => switchTab(b.dataset.page));
  }

  /* ---------- 地图页控件 ---------- */
  /* 探测瓦片服务是否可达：用 <img> 实际加载一片瓦片，与真实瓦片请求同路径、无误报 */
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

    document.getElementById('sheet-toggle').onclick = () =>
      document.getElementById('tracks-sheet').classList.toggle('open');
  }

  function renderCoverageLayer() {
    const chip = document.getElementById('coverage-chip');
    if (!settings.showCoverage) { MapView.clearCoverage(); chip.classList.add('hidden'); return; }
    const cov = Coverage.compute(tracks, settings.gridZoom);
    MapView.renderCoverage(cov);
    chip.classList.remove('hidden');
    chip.textContent = `🎯 已探索 ${cov.set.size} 格 · 约 ${Coverage.areaKm2(cov).toFixed(1)} km²` +
      (cov.truncated ? '（部分已省略）' : '');
  }

  /* ---------- 路线列表 ---------- */
  function renderTrackList() {
    const list = document.getElementById('track-list');
    document.getElementById('sheet-title').textContent = `路线（${tracks.length}）`;
    if (!tracks.length) {
      list.innerHTML = '<div class="sheet-empty">还没有路线，去「记录」页出去走走吧</div>';
      return;
    }
    list.innerHTML = tracks.map((tr, i) => `
      <div class="track-item" data-id="${tr.id}">
        <span class="track-dot" style="background:${MapView.trackColor(i)}"></span>
        <div class="ti-main">
          <div class="ti-name">${Util.esc(tr.name)}</div>
          <div class="ti-sub">${Util.fmtDate(tr.startTime)} · ${Geo.fmtDist(tr.distance)} · ${Geo.fmtDur(tr.activeMs)}</div>
        </div>
        <div class="ti-actions">
          <button class="ti-btn" data-act="rename" title="重命名"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
          <button class="ti-btn" data-act="gpx" title="导出 GPX"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 11l5 5 5-5M5 20h14"/></svg></button>
          <button class="ti-btn" data-act="del" title="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13"/></svg></button>
        </div>
      </div>`).join('');
  }

  function exportTrackGPX(tr) {
    const pts = tr.points.map(p =>
      `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}"><time>${new Date(p.t).toISOString()}</time></trkpt>`
    ).join('\n');
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="走走 Walkies" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk>\n    <name>${Util.esc(tr.name)}</name>\n    <trkseg>\n${pts}\n    </trkseg>\n  </trk>\n</gpx>`;
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

  function bindTrackList() {
    document.getElementById('track-list').onclick = async e => {
      const item = e.target.closest('.track-item');
      if (!item) return;
      const tr = tracks.find(t => t.id === item.dataset.id);
      if (!tr) return;
      const btn = e.target.closest('.ti-btn');
      if (!btn) { switchTab('map'); MapView.flyToTrack(tr); return; }
      const act = btn.dataset.act;
      if (act === 'rename') {
        const name = await Util.promptModal('重命名路线', { value: tr.name });
        if (name) { tr.name = name; await DB.put('tracks', tr); renderAll(); }
      } else if (act === 'gpx') {
        exportTrackGPX(tr);
      } else if (act === 'del') {
        if (await Util.confirmModal('删除路线', `删除「${tr.name}」后无法恢复。`, '删除', true)) {
          await DB.del('tracks', tr.id);
          await reload();
        }
      }
    };
  }

  /* ---------- 照片 ---------- */
  function renderPhotoGrid() {
    const grid = document.getElementById('photo-grid');
    document.getElementById('photo-count').textContent = photos.length ? `(${photos.length})` : '';
    document.getElementById('photo-hint').classList.toggle('hidden', photos.length > 0);
    if (!photos.length) {
      grid.innerHTML = '<div class="photo-empty">还没有照片，点右上角「＋ 添加照片」</div>';
      return;
    }
    grid.innerHTML = photos.map(ph => `
      <div class="pg-item" data-id="${ph.id}">
        ${ph.thumb ? `<img src="${ph.thumb}" alt="" loading="lazy">` : ''}
        ${ph.lat == null ? '<span class="pg-badge">无位置</span>' : ''}
      </div>`).join('');
  }

  async function openPhotoDetail(ph) {
    const content = document.createElement('div');
    content.innerHTML = `
      <img class="pd-img" src="${Photos.url(ph)}" alt="">
      <div class="pd-name">${Util.esc(ph.name)}</div>
      <div class="pd-meta">${Util.fmtDateTime(ph.takenAt)}<br>${
        ph.lat != null ? `${ph.lat.toFixed(5)}, ${ph.lng.toFixed(5)}` : '未标注位置'}</div>`;
    const act = await Util.openModal({
      title: '照片',
      content,
      actions: [
        { label: '关闭', value: 'close' },
        { label: '删除', value: 'del', className: 'btn-danger-ghost' },
        { label: ph.lat != null ? '修改位置' : '在地图上标注', value: 'place', className: 'btn-primary' },
      ],
    });
    if (act === 'del') {
      if (await Util.confirmModal('删除照片', '删除后无法恢复。', '删除', true)) {
        await DB.del('photos', ph.id);
        Photos.revoke(ph.id);
        await reload();
      }
    } else if (act === 'place') {
      startPlacing(ph);
    }
  }

  /* 手动标注照片位置：进入点选模式，点地图放置 */
  let placing = null;
  function startPlacing(ph) {
    placing = ph.id;
    switchTab('map');
    document.getElementById('placing-text').textContent = `点击地图放置「${ph.name}」的拍摄位置`;
    document.getElementById('placing-banner').classList.remove('hidden');
  }
  function cancelPlacing() {
    placing = null;
    document.getElementById('placing-banner').classList.add('hidden');
  }

  function bindPhotosUI() {
    document.getElementById('btn-add-photo').onclick = () =>
      document.getElementById('file-photos').click();
    document.getElementById('file-photos').onchange = async e => {
      const files = [...e.target.files];
      e.target.value = '';
      if (!files.length) return;
      Util.toast(`正在处理 ${files.length} 张照片…`, 8000);
      const stat = await Photos.addFiles(files);
      await reload();
      Util.toast(`已添加 ${stat.added} 张照片` + (stat.noGps ? `（${stat.noGps} 张无位置，可手动标注）` : ''));
    };
    document.getElementById('photo-grid').onclick = e => {
      const item = e.target.closest('.pg-item');
      if (!item) return;
      const ph = photos.find(p => p.id === item.dataset.id);
      if (ph) openPhotoDetail(ph);
    };
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
    MapView.onPhotoClick(openPhotoDetail);
  }

  /* ---------- 设置页 ---------- */
  const blobToDataURL = b => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(b);
  });

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
        switchTab('map');
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
    switchTab('map');
    MapView.fitAll(tracks, photos);
    Util.toast('已生成 3 条示例路线');
  }

  /* ---------- 汇总渲染 ---------- */
  function renderHeaderStats() {
    const km = tracks.reduce((s, t) => s + (t.distance || 0), 0);
    document.getElementById('header-stats').innerHTML =
      `${tracks.length} 条路线<br>${(km / 1000).toFixed(1)} km · ${photos.length} 张照片`;
  }

  function renderAll() {
    MapView.renderTracks(settings.showTracks ? tracks : []);
    MapView.renderPhotos(settings.showPhotos ? photos : []);
    renderCoverageLayer();
    renderTrackList();
    renderPhotoGrid();
    renderHeaderStats();
  }

  async function reload() {
    tracks = (await DB.getAll('tracks')).sort((a, b) => b.startTime - a.startTime);
    photos = (await DB.getAll('photos')).sort((a, b) => b.takenAt - a.takenAt);
    renderAll();
  }

  /* ---------- 启动 ---------- */
  async function init() {
    MapView.init('map');
    bindTabs();
    bindMapControls();
    bindRecordUI();
    bindTrackList();
    bindPhotosUI();
    bindSettingsUI();
    Tracker.onChange(renderRecordUI);
    window.addEventListener('beforeunload', e => {
      if (Tracker.getState() === 'recording') { e.preventDefault(); e.returnValue = ''; }
    });
    const restored = Tracker.restore();
    await reload();
    if (restored) Util.toast('已恢复上次未完成的路线（已暂停），可到「记录」页继续');

    /* 启动时恢复已保存的底图（非高德系先探测可达性，不通则退回高德标准） */
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
          <p class="modal-text"><b>2. iPhone</b><br>设置 → 隐私与安全性 → 定位服务 → 打开总开关，并把列表中的「Safari 网站」设为「使用 App 期间」（添加到主屏幕的显示为走走）。若之前拒绝过，改完回到本页刷新。</p>
          <p class="modal-text"><b>3. 安卓</b><br>点地址栏左侧的锁图标 → 权限 → 位置 → 允许，然后刷新页面。</p>`,
        actions: [{ label: '知道了', value: 'ok', className: 'btn-primary' }],
      });
    });

    /* 底图不可达时 mapView 会触发此事件，同步设置和界面 */
    window.addEventListener('cw-osm-fallback', () => {
      settings.basemap = 'gaode';
      saveSettings();
      setRadio('gaode');
      renderAll();
    });
  }

  return { init, reload, switchTab };
})();

document.addEventListener('DOMContentLoaded', () => App.init());

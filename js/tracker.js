/* 轨迹记录器：状态机 idle -> recording <-> paused，含抖动过滤、
   崩溃恢复（localStorage 暂存）、录制时屏幕常亮 */
const Tracker = (() => {
  const MIN_STEP_M = 2;   // 相邻点最小间距，过滤 GPS 抖动
  const MAX_ACC_M = 60;   // 精度差于该值的定位点丢弃
  const STORE_KEY = 'cw-active';

  let state = 'idle';
  let points = [];
  let startTime = 0, activeMs = 0, activeStart = 0, distance = 0;
  let watchId = null, wakeLock = null;
  let lastAcc = null, statusMsg = '';
  let persistTimer = null;
  let lastDeniedEvt = 0;
  let recId = null; /* 路线 id 在开始记录时就生成，照片可提前关联 */

  const listeners = new Set();

  function snapshot() {
    return {
      state,
      recId,
      distance,
      activeMs: activeMs + (state === 'recording' ? Date.now() - activeStart : 0),
      pointCount: points.length,
      points,
      acc: lastAcc,
      msg: statusMsg,
    };
  }
  function emit() {
    const s = snapshot();
    listeners.forEach(f => { try { f(s); } catch (e) { console.error(e); } });
  }

  function handlePos(pos) {
    if (state !== 'recording') return;
    const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords;
    lastAcc = acc;
    if (!isFinite(lat) || !isFinite(lng)) return;
    if (acc > MAX_ACC_M) { statusMsg = 'GPS 信号弱，等待更好的定位…'; emit(); return; }
    statusMsg = '';
    const last = points[points.length - 1];
    if (!last) {
      points.push({ lat, lng, t: Date.now(), s: 1 });
    } else {
      const d = Geo.haversine(last.lat, last.lng, lat, lng);
      if (d < MIN_STEP_M) { emit(); return; }
      distance += d;
      points.push({ lat, lng, t: Date.now() });
    }
    emit();
    schedulePersist();
  }
  function handleErr(err) {
    if (err && err.code === 1) {
      statusMsg = '定位权限被拒';
      // 弹一次排查指引（15 秒内不重复弹）
      const now = Date.now();
      if (now - lastDeniedEvt > 15000) {
        lastDeniedEvt = now;
        window.dispatchEvent(new CustomEvent('cw-geo-denied'));
      }
    } else {
      statusMsg = '暂时获取不到定位';
    }
    emit();
  }

  function watch() {
    if (!('geolocation' in navigator)) { statusMsg = '此浏览器不支持定位'; emit(); return; }
    watchId = navigator.geolocation.watchPosition(handlePos, handleErr,
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  }
  function unwatch() {
    if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  }

  function start() {
    if (state !== 'idle') return;
    points = []; distance = 0; activeMs = 0; startTime = Date.now();
    lastAcc = null; statusMsg = '';
    recId = Util.uid();
    state = 'recording'; activeStart = Date.now();
    watch(); reWake(); persist();
    emit();
  }
  function pause() {
    if (state !== 'recording') return;
    activeMs += Date.now() - activeStart;
    state = 'paused'; unwatch(); persist(); emit();
  }
  function resume() {
    if (state !== 'paused') return;
    state = 'recording'; activeStart = Date.now(); statusMsg = '';
    watch(); reWake(); emit();
  }
  /* 结束并返回轨迹对象（未命名未入库，由调用方处理） */
  function finishTrack() {
    if (state === 'idle') return null;
    if (state === 'recording') activeMs += Date.now() - activeStart;
    unwatch(); releaseWake();
    localStorage.removeItem(STORE_KEY);
    const track = {
      id: recId || Util.uid(),
      name: '',
      startTime,
      endTime: Date.now(),
      activeMs,
      distance: Math.round(distance),
      points: points.slice(),
    };
    state = 'idle'; points = []; distance = 0; activeMs = 0; lastAcc = null; statusMsg = ''; recId = null;
    emit();
    return track;
  }
  function discard() {
    if (state === 'idle') return;
    unwatch(); releaseWake();
    localStorage.removeItem(STORE_KEY);
    state = 'idle'; points = []; distance = 0; activeMs = 0; lastAcc = null; statusMsg = ''; recId = null;
    emit();
  }

  /* 崩溃保护：定期把进行中的轨迹写入 localStorage */
  function persist() {
    if (state === 'idle') return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ points, startTime, activeMs, distance, recId }));
    } catch (e) { /* 存储满则忽略 */ }
  }
  function schedulePersist() {
    if (persistTimer) return;
    persistTimer = setTimeout(() => { persistTimer = null; persist(); }, 5000);
  }
  function restore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      if (!d.points || !d.points.length) { localStorage.removeItem(STORE_KEY); return false; }
      points = d.points; startTime = d.startTime; activeMs = d.activeMs || 0; distance = d.distance || 0;
      recId = d.recId || Util.uid();
      state = 'paused';
      emit();
      return true;
    } catch (e) { return false; }
  }

  async function reWake() {
    try {
      if (navigator.wakeLock && !wakeLock) wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) { }
  }
  function releaseWake() {
    try { wakeLock && wakeLock.release(); } catch (e) { }
    wakeLock = null;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persist();
    else if (state === 'recording') reWake();
  });

  return {
    start, pause, resume, finishTrack, discard, restore,
    onChange: f => listeners.add(f),
    getState: () => state,
    getRecId: () => recId,
    snapshot,
  };
})();

/* 通用工具：DOM、弹窗、Toast、文件下载、日期格式化 */
const Util = (() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function toast(msg, ms = 2600) {
    const root = $('#toast-root');
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    root.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, ms);
  }

  /* openModal({title, content: html|Element, actions:[{label, value, className}]}) -> Promise<value|null> */
  function openModal({ title, content, actions = [] }) {
    return new Promise(resolve => {
      const ov = document.createElement('div');
      ov.className = 'modal-overlay';
      const box = document.createElement('div');
      box.className = 'modal';

      const t = document.createElement('div');
      t.className = 'modal-title';
      t.textContent = title;

      const b = document.createElement('div');
      b.className = 'modal-body';
      if (typeof content === 'string') b.innerHTML = content;
      else if (content) b.appendChild(content);

      const acts = document.createElement('div');
      acts.className = 'modal-actions';
      const close = v => { ov.remove(); resolve(v); };
      if (!actions.length) {
        const ok = document.createElement('button');
        ok.className = 'btn btn-primary';
        ok.textContent = '好的';
        ok.onclick = () => close(undefined);
        acts.appendChild(ok);
      } else {
        actions.forEach(a => {
          const btn = document.createElement('button');
          btn.className = 'btn ' + (a.className || 'btn-ghost');
          btn.textContent = a.label;
          btn.onclick = () => close(a.value);
          acts.appendChild(btn);
        });
      }

      box.append(t, b, acts);
      ov.appendChild(box);
      ov.addEventListener('click', e => { if (e.target === ov) close(null); });
      document.body.appendChild(ov);
      const inp = b.querySelector('input,textarea');
      if (inp) { inp.focus(); inp.select && inp.select(); }
    });
  }

  async function confirmModal(title, text, okLabel = '确定', danger = false) {
    return (await openModal({
      title,
      content: `<p class="modal-text">${esc(text)}</p>`,
      actions: [
        { label: '取消', value: false },
        { label: okLabel, value: true, className: danger ? 'btn-danger' : 'btn-primary' }
      ]
    })) === true;
  }

  /* 输入框弹窗，返回输入值；取消返回 null */
  async function promptModal(title, { value = '', placeholder = '' } = {}) {
    const wrap = document.createElement('div');
    const inp = document.createElement('input');
    inp.className = 'input';
    inp.value = value;
    inp.placeholder = placeholder;
    wrap.appendChild(inp);
    const ok = await openModal({
      title, content: wrap,
      actions: [
        { label: '取消', value: null },
        { label: '确定', value: '__ok__', className: 'btn-primary' }
      ]
    });
    return ok === '__ok__' ? inp.value.trim() : null;
  }

  function downloadFile(content, filename, type = 'text/plain') {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
  }

  const p2 = n => String(n).padStart(2, '0');
  function fmtDate(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  }
  function fmtDateTime(ts) {
    const d = new Date(ts);
    return `${fmtDate(ts)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  }

  return { $, $$, uid, esc, toast, openModal, confirmModal, promptModal, downloadFile, fmtDate, fmtDateTime };
})();

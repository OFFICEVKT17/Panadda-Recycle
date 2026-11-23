let isBusy = false;

export async function withBusy(label, fn) {
  if (isBusy) return;
  isBusy = true;
  const overlay = document.getElementById('busy-overlay');
  const txt = document.getElementById('busy-text');
  if (txt) txt.textContent = label || 'กำลังดำเนินการ...';
  overlay?.classList.remove('hidden');
  try {
    return await fn();
  } finally {
    isBusy = false;
    overlay?.classList.add('hidden');
  }
}

export const getBusyState = () => isBusy;

const DIALOG_THEMES = {
  success: { icon: '✓', bg: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30', btn: 'bg-emerald-600 hover:bg-emerald-500' },
  warning: { icon: '!', bg: 'bg-amber-500/20 text-amber-400 border border-amber-500/30', btn: 'bg-amber-600 hover:bg-amber-500' },
  error:   { icon: '✕', bg: 'bg-red-500/20 text-red-400 border border-red-500/30', btn: 'bg-red-600 hover:bg-red-500' },
  info:    { icon: '✎', bg: 'bg-sky-500/20 text-sky-400 border border-sky-500/30', btn: 'bg-sky-600 hover:bg-sky-500' }
};

export function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const styles = {
    success: 'bg-slate-900/95 border-emerald-500/60 text-emerald-300',
    warning: 'bg-slate-900/95 border-amber-500/60 text-amber-300',
    error:   'bg-slate-900/95 border-red-500/60 text-red-300',
    info:    'bg-slate-900/95 border-sky-500/60 text-sky-300'
  };
  const badgeIcons = { success: '✅', warning: '⚠️', error: '⛔', info: 'ℹ️' };

  const el = document.createElement('div');
  el.className = `anim-toast pointer-events-auto border-2 rounded-2xl px-4 py-3.5 shadow-2xl flex items-center gap-3 backdrop-blur-md ${styles[type] || styles.success}`;
  el.innerHTML = `
    <span class="text-lg shrink-0">${badgeIcons[type] || '✅'}</span>
    <span class="text-sm font-semibold text-white leading-snug flex-1">${message}</span>
  `;
  container.appendChild(el);

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    el.style.transition = 'all 0.2s ease';
    setTimeout(() => el.remove(), 220);
  }, 2500);
}

export function openDialog({ title, message = '', type = 'info', fields = [], confirmText = 'ตกลง', cancelText = null }) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('ui-dialog-overlay');
    const iconEl = document.getElementById('ui-dialog-icon');
    const titleEl = document.getElementById('ui-dialog-title');
    const msgEl = document.getElementById('ui-dialog-msg');
    const inputsEl = document.getElementById('ui-dialog-inputs');
    const actionsEl = document.getElementById('ui-dialog-actions');

    const theme = DIALOG_THEMES[type] || DIALOG_THEMES.info;
    iconEl.className = `w-12 h-12 rounded-2xl flex items-center justify-center text-2xl font-extrabold shrink-0 ${theme.bg}`;
    iconEl.textContent = theme.icon;
    titleEl.textContent = title;
    msgEl.textContent = message;
    msgEl.classList.toggle('hidden', !message);

    if (fields.length > 0) {
      inputsEl.classList.remove('hidden');
      inputsEl.innerHTML = fields.map((f, idx) => `
        <div>
          ${f.label ? `<label class="block text-xs text-slate-400 mb-1">${f.label}</label>` : ''}
          <input id="dlg-field-${idx}" type="${f.type || 'text'}" inputmode="${f.type === 'number' ? 'decimal' : 'text'}" step="${f.step || 'any'}" value="${f.defaultValue ?? ''}" placeholder="${f.placeholder || ''}"
            class="w-full bg-slate-800 border border-slate-700 focus:border-emerald-500 focus:outline-none rounded-xl px-4 py-3 text-white font-semibold text-base" />
        </div>
      `).join('');
    } else {
      inputsEl.classList.add('hidden');
      inputsEl.innerHTML = '';
    }

    actionsEl.innerHTML = '';
    const close = (result) => {
      overlay.classList.add('hidden');
      resolve(result);
    };

    if (cancelText) {
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'active-press bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-5 py-3 rounded-2xl text-sm';
      cancelBtn.textContent = cancelText;
      cancelBtn.onclick = () => close(null);
      actionsEl.appendChild(cancelBtn);
    }

    const okBtn = document.createElement('button');
    okBtn.className = `active-press ${theme.btn} text-white font-bold px-6 py-3 rounded-2xl text-sm shadow-lg`;
    okBtn.textContent = confirmText;
    okBtn.onclick = () => {
      if (!fields.length) return close(true);
      const values = fields.map((_, idx) => document.getElementById(`dlg-field-${idx}`).value);
      close(fields.length === 1 ? values[0] : values);
    };
    actionsEl.appendChild(okBtn);

    overlay.classList.remove('hidden');
    if (fields.length > 0) {
      setTimeout(() => document.getElementById('dlg-field-0')?.focus(), 40);
    }
  });
}

export const uiAlert = (title, message = '', type = 'info') => openDialog({ title, message, type, confirmText: 'รับทราบ' });
export const uiConfirm = (title, message = '', type = 'warning', confirmText = 'ยืนยัน') => openDialog({ title, message, type, confirmText, cancelText: 'ยกเลิก' });
export const uiPrompt = (title, placeholder = '', defaultValue = '', inputType = 'text') => openDialog({
  title,
  type: 'info',
  fields: [{ placeholder, defaultValue, type: inputType }],
  confirmText: 'ตกลง',
  cancelText: 'ยกเลิก'
});
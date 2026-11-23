import { supabase, fmtMoney, fmtWeight } from './config.js';
import { withBusy, showToast, uiAlert, uiConfirm, uiPrompt } from './ui.js';
import { getTodayStr, buildEffectiveTimestamp } from './pos-app.js';

let catChartInstance = null;
let flowChartInstance = null;
let editingItemId = null;
let editorVariants = [];

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

const filters = {
  drawer: { mode: 'day', date: '', month: '', year: '' },
  sell:   { mode: 'month', date: '', month: '', year: '' },
  owner:  { mode: 'month', date: '', month: '', year: '' }
};

const paging = {
  drawerBills: { limit: 50, page: 1, rows: [] },
  sellDone:    { limit: 50, page: 1, rows: [] },
  ownerVoids:  { limit: 50, page: 1, rows: [] }
};

function initDefaultFilters() {
  const today = getTodayStr();
  const ym = today.slice(0, 7);
  const yr = today.slice(0, 4);
  Object.keys(filters).forEach(k => {
    filters[k].date = today;
    filters[k].month = ym;
    filters[k].year = yr;
  });
}

function getPeriodRange(f) {
  if (f.mode === 'day') {
    const d = f.date || getTodayStr();
    return {
      startISO: `${d}T00:00:00+07:00`,
      endISO: `${d}T23:59:59.999+07:00`,
      label: `วันที่ ${new Date(d + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}`
    };
  }
  if (f.mode === 'month') {
    const [y, m] = (f.month || getTodayStr().slice(0, 7)).split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const mm = String(m).padStart(2, '0');
    return {
      startISO: `${y}-${mm}-01T00:00:00+07:00`,
      endISO: `${y}-${mm}-${String(lastDay).padStart(2, '0')}T23:59:59.999+07:00`,
      label: `ประจำเดือน ${TH_MONTHS[m - 1]} ${y + 543}`,
      year: y,
      month: m,
      daysInMonth: lastDay
    };
  }
  const y = Number(f.year || getTodayStr().slice(0, 4));
  return {
    startISO: `${y}-01-01T00:00:00+07:00`,
    endISO: `${y}-12-31T23:59:59.999+07:00`,
    label: `ประจำปี พ.ศ. ${y + 543} (${y})`,
    year: y
  };
}

function renderFilterControl(scope, containerId) {
  const f = filters[scope];
  const el = document.getElementById(containerId);
  if (!el) return;

  const curYear = Number(getTodayStr().slice(0, 4));
  const yearOpts = [curYear, curYear - 1, curYear - 2, curYear - 3]
    .map(y => `<option value="${y}" ${Number(f.year) === y ? 'selected' : ''}>ปี ${y + 543} (${y})</option>`)
    .join('');

  let pickerHtml = '';
  if (f.mode === 'day') {
    pickerHtml = `<input type="date" value="${f.date}" onchange="changeFilterValue('${scope}', this.value)" class="bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-xs font-bold text-white" />`;
  } else if (f.mode === 'month') {
    pickerHtml = `<input type="month" value="${f.month}" onchange="changeFilterValue('${scope}', this.value)" class="bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-xs font-bold text-white" />`;
  } else {
    pickerHtml = `<select onchange="changeFilterValue('${scope}', this.value)" class="bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-xs font-bold text-white">${yearOpts}</select>`;
  }

  const btnCls = (m) => f.mode === m ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white';

  el.innerHTML = `
    <div class="inline-flex bg-slate-900 border border-slate-800 rounded-xl p-1 text-xs font-bold">
      <button onclick="changeFilterMode('${scope}', 'day')" class="px-2.5 py-1 rounded-lg transition ${btnCls('day')}">วัน</button>
      <button onclick="changeFilterMode('${scope}', 'month')" class="px-2.5 py-1 rounded-lg transition ${btnCls('month')}">เดือน</button>
      <button onclick="changeFilterMode('${scope}', 'year')" class="px-2.5 py-1 rounded-lg transition ${btnCls('year')}">ปี</button>
    </div>
    ${pickerHtml}
  `;
}

function paginateRows(key) {
  const st = paging[key];
  const total = st.rows.length;
  if (!total) return { slice: [], barHtml: '' };

  const isAll = st.limit === 'ALL';
  const size = isAll ? total : Number(st.limit);
  const totalPages = Math.max(1, Math.ceil(total / size));
  if (st.page > totalPages) st.page = totalPages;
  if (st.page < 1) st.page = 1;

  const startIdx = isAll ? 0 : (st.page - 1) * size;
  const endIdx = isAll ? total : Math.min(total, startIdx + size);
  const slice = st.rows.slice(startIdx, endIdx);

  const lBtn = (val, label) => {
    const active = String(st.limit) === String(val);
    return `<button onclick="setPageLimit('${key}', '${val}')" class="px-2.5 py-1 rounded-lg text-xs font-bold transition ${active ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'}">${label}</button>`;
  };

  const navHtml = !isAll && totalPages > 1 ? `
    <div class="flex items-center gap-1.5">
      <button onclick="setPageNum('${key}', ${st.page - 1})" ${st.page <= 1 ? 'disabled' : ''} class="px-2.5 py-1 rounded-lg bg-slate-800 text-xs font-bold disabled:opacity-30">◀ ก่อนหน้า</button>
      <span class="text-xs text-slate-300 font-semibold px-1">หน้า ${st.page}/${totalPages}</span>
      <button onclick="setPageNum('${key}', ${st.page + 1})" ${st.page >= totalPages ? 'disabled' : ''} class="px-2.5 py-1 rounded-lg bg-slate-800 text-xs font-bold disabled:opacity-30">ถัดไป ▶</button>
    </div>
  ` : '';

  const barHtml = `
    <div class="flex flex-wrap items-center justify-between gap-2 bg-slate-900/70 border border-slate-800/80 rounded-2xl px-3.5 py-2 mb-2.5">
      <div class="flex items-center gap-2">
        <span class="text-xs text-slate-400">แสดงผล:</span>
        <div class="inline-flex bg-slate-950 border border-slate-800 rounded-xl p-0.5">
          ${lBtn(50, '50')}
          ${lBtn(100, '100')}
          ${lBtn('ALL', 'ทั้งหมด')}
        </div>
        <span class="text-xs text-slate-400">(${startIdx + 1}–${endIdx} จาก ${total} รายการ)</span>
      </div>
      ${navHtml}
    </div>
  `;

  return { slice, barHtml };
}

function renderDrawerBillsPage() {
  const bList = document.getElementById('today-bills-list');
  if (!bList) return;
  const range = getPeriodRange(filters.drawer);

  if (!paging.drawerBills.rows.length) {
    bList.innerHTML = `<div class="text-slate-500 text-sm py-8 text-center">ไม่พบบิลรับซื้อในช่วง ${range.label}</div>`;
    return;
  }

  const { slice, barHtml } = paginateRows('drawerBills');
  const itemsHtml = slice.map(b => {
    const isVoid = b.status === 'VOIDED';
    const dtStr = new Date(b.created_at).toLocaleString('th-TH', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    const summary = (b.transaction_items || []).map(ti => {
      const label = ti.items?.name ? (ti.variant_name ? `${ti.items.name}-${ti.variant_name}` : ti.items.name) : ti.custom_item_name;
      return `${label} (${ti.net_weight_kg} กก.)`;
    }).join(', ');
    return `
      <div class="bg-slate-900 border ${isVoid ? 'border-red-900/60 opacity-60' : 'border-slate-800'} rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div class="font-bold text-white flex flex-wrap items-center gap-2">
            <span>${b.bill_no}</span>
            <span class="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded">${dtStr}</span>
            ${b.customer_or_factory_name ? `<span class="text-xs text-sky-400">(${b.customer_or_factory_name})</span>` : ''}
            ${isVoid ? `<span class="bg-red-600 text-white text-[10px] px-2 py-0.5 rounded">ยกเลิกแล้ว: ${b.void_reason}</span>` : ''}
          </div>
          <div class="text-xs text-slate-400 mt-1">${summary}</div>
        </div>
        <div class="flex items-center gap-3 ml-auto">
          <span class="text-lg font-extrabold ${isVoid ? 'line-through text-slate-500' : 'text-emerald-400'}">${fmtMoney(b.total_amount)} ฿</span>
          ${!isVoid ? `
            <button onclick='editBillToPos(${JSON.stringify(b.id)}, ${JSON.stringify(b.created_at)})' class="active-press bg-amber-600/20 text-amber-300 px-3 py-1.5 rounded-xl text-xs font-bold">แก้ไข</button>
            <button onclick="voidBill('${b.id}', '${b.bill_no}')" class="active-press bg-red-600/20 text-red-400 px-3 py-1.5 rounded-xl text-xs font-bold">ยกเลิก</button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  bList.innerHTML = barHtml + `<div class="space-y-2">${itemsHtml}</div>`;
}

function renderSellDonePage() {
  const container = document.getElementById('completed-sell-list');
  if (!container) return;
  const range = getPeriodRange(filters.sell);

  if (!paging.sellDone.rows.length) {
    container.innerHTML = `<div class="text-slate-500 text-sm text-center py-6">ไม่มีประวัติการขายในช่วง ${range.label}</div>`;
    return;
  }

  const { slice, barHtml } = paginateRows('sellDone');
  const rowsHtml = slice.map(d => {
    const ti = d.transaction_items?.[0];
    const yieldKg = ti?.sell_bundled_piles?.[0]?.estimated_yield_kg;
    const dtStr = new Date(d.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' });
    return `
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-3 flex flex-wrap justify-between items-center gap-2 text-sm">
        <div>
          <div class="font-bold flex items-center gap-2">
            <span>${d.bill_no} (${d.customer_or_factory_name || '-'}) — ${ti?.items?.name}</span>
            <span class="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded">${dtStr}</span>
          </div>
          <div class="text-xs text-slate-400 mt-0.5">ขายจริง ${fmtWeight(d.total_weight_kg)} กก. × ${fmtMoney(ti?.unit_price)} ฿ ${yieldKg > 0 ? `| เนื้อที่ได้จากกองพ่วง: ${fmtWeight(yieldKg)} กก.` : ''}</div>
        </div>
        <div class="text-right ml-auto">
          <div class="font-bold text-emerald-400">รับ ${fmtMoney(d.total_amount)} ฿</div>
          <div class="text-xs ${d.realized_profit >= 0 ? 'text-sky-400' : 'text-red-400'}">กำไรสุทธิ: ${fmtMoney(d.realized_profit)} ฿</div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = barHtml + `<div class="space-y-2">${rowsHtml}</div>`;
}

function renderOwnerVoidsPage() {
  const container = document.getElementById('owner-void-log');
  if (!container) return;
  const range = getPeriodRange(filters.owner);
  container.classList.remove('max-h-60');

  if (!paging.ownerVoids.rows.length) {
    container.innerHTML = `<div class="text-slate-500 text-xs py-4 text-center">ไม่มีบิลถูกยกเลิกในช่วง ${range.label}</div>`;
    return;
  }

  const { slice, barHtml } = paginateRows('ownerVoids');
  const rowsHtml = slice.map(v => `
    <div class="bg-slate-900 border border-red-900/40 rounded-xl p-2.5 text-xs flex justify-between gap-2">
      <span><strong>${v.bill_no}</strong> (${fmtMoney(v.total_amount)} ฿) — เหตุผล: ${v.void_reason}</span>
      <span class="text-slate-400 shrink-0">${new Date(v.voided_at || v.created_at).toLocaleDateString('th-TH')}</span>
    </div>
  `).join('');

  container.innerHTML = barHtml + `<div class="space-y-2 max-h-80 overflow-y-auto pr-1">${rowsHtml}</div>`;
}

export function initBackoffice({ state, loadInitialData, renderCart }) {
  initDefaultFilters();

  window.setPageLimit = (key, val) => {
    paging[key].limit = val === 'ALL' ? 'ALL' : Number(val);
    paging[key].page = 1;
    if (key === 'drawerBills') renderDrawerBillsPage();
    if (key === 'sellDone') renderSellDonePage();
    if (key === 'ownerVoids') renderOwnerVoidsPage();
  };

  window.setPageNum = (key, num) => {
    paging[key].page = Number(num);
    if (key === 'drawerBills') renderDrawerBillsPage();
    if (key === 'sellDone') renderSellDonePage();
    if (key === 'ownerVoids') renderOwnerVoidsPage();
  };

  window.changeFilterMode = (scope, mode) => {
    filters[scope].mode = mode;
    refreshByScope(scope);
  };

  window.changeFilterValue = (scope, val) => {
    const f = filters[scope];
    if (f.mode === 'day') f.date = val;
    else if (f.mode === 'month') f.month = val;
    else f.year = val;
    refreshByScope(scope);
  };

  function refreshByScope(scope) {
    if (scope === 'drawer') { paging.drawerBills.page = 1; withBusy('กำลังกรองรายการบิล...', window.loadDrawerView); }
    if (scope === 'sell')   { paging.sellDone.page = 1;    withBusy('กำลังกรองประวัติขาย...', window.loadSellView); }
    if (scope === 'owner')  { paging.ownerVoids.page = 1;  withBusy('กำลังคำนวณสรุปตามช่วงเวลา...', window.loadOwnerView); }
  }

  window.loadDrawerView = async () => {
    await loadInitialData();
    renderFilterControl('drawer', 'drawer-filter-bar');
    const range = getPeriodRange(filters.drawer);

    const panel = document.getElementById('shift-panel-content');
    if (!state.currentShift) {
      panel.innerHTML = `
        <p class="text-sm text-amber-400 mb-3">สถานะ: ยังไม่ได้เปิดกะลิ้นชัก</p>
        <input id="open-shift-amt" type="number" inputmode="decimal" placeholder="นับเงินตั้งต้นในลิ้นชัก (บาท)" class="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white font-bold mb-3" />
        <button onclick="openNewShift()" class="active-press w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3.5 rounded-xl">🔓 เปิดกะรับซื้อวันนี้</button>
      `;
    } else {
      panel.innerHTML = `
        <div class="text-xs text-slate-400 mb-2">เปิดกะเมื่อ: ${new Date(state.currentShift.opened_at).toLocaleString('th-TH')} (ตั้งต้น ${fmtMoney(state.currentShift.opening_cash)} ฿)</div>
        <p class="text-xs text-amber-300 mb-2">ปิดกะแบบ Blind Close: นับเงินสดจริงในลิ้นชักแล้วกรอกด้านล่าง</p>
        <input id="close-shift-amt" type="number" inputmode="decimal" placeholder="ยอดเงินสดที่นับได้จริง (บาท)" class="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white font-bold mb-2" />
        <button onclick="closeCurrentShift()" class="active-press w-full bg-red-600 hover:bg-red-500 text-white font-bold py-3.5 rounded-xl">🔒 ยืนยันปิดกะเย็น</button>
      `;
    }

    const { data: bills } = await supabase
      .from('transactions')
      .select('*, transaction_items(net_weight_kg, unit_price, subtotal, variant_name, custom_item_name, items(name))')
      .eq('tx_type', 'BUY')
      .gte('created_at', range.startISO)
      .lte('created_at', range.endISO)
      .order('created_at', { ascending: false })
      .limit(5000);

    paging.drawerBills.rows = bills || [];
    const activeBills = paging.drawerBills.rows.filter(b => b.status === 'COMPLETED');
    const sumBuy = activeBills.reduce((s, b) => s + Number(b.total_amount), 0);
    const sumKg = activeBills.reduce((s, b) => s + Number(b.total_weight_kg), 0);
    document.getElementById('drawer-filter-summary').textContent =
      `${range.label} • บิลสำเร็จ ${activeBills.length} ใบ • น้ำหนักรวม ${fmtWeight(sumKg)} กก. • ยอดจ่ายรวม ${fmtMoney(sumBuy)} ฿`;

    renderDrawerBillsPage();
  };

  window.openNewShift = () => {
    const amt = parseFloat(document.getElementById('open-shift-amt').value || 0);
    withBusy('กำลังเปิดกะลิ้นชัก...', async () => {
      const { error } = await supabase.from('cash_shifts').insert({ opened_by: state.currentUser.id, opening_cash: amt, status: 'OPEN' });
      if (error) return uiAlert('เปิดกะไม่สำเร็จ', error.message, 'error');
      await window.loadDrawerView();
      showToast(`เปิดกะลิ้นชักเริ่มต้น ${fmtMoney(amt)} ฿ เรียบร้อย`, 'success');
    });
  };

  window.closeCurrentShift = async () => {
    const actual = parseFloat(document.getElementById('close-shift-amt').value);
    if (isNaN(actual)) return showToast('กรุณากรอกยอดเงินสดที่นับได้จริง', 'warning');

    const ok = await uiConfirm('ยืนยันปิดกะลิ้นชักวันนี้?', `ยอดเงินสดที่นับจริง: ${fmtMoney(actual)} บาท`, 'warning', 'ปิดกะทันที');
    if (!ok) return;

    await withBusy('กำลังคำนวณยอดปิดกะ...', async () => {
      const { data, error } = await supabase.rpc('close_cash_shift_pin', {
        p_user_id: state.currentUser.id,
        p_shift_id: state.currentShift.id,
        p_actual_cash: actual,
        p_note: null
      });
      if (error) return uiAlert('ปิดกะไม่สำเร็จ', error.message, 'error');

      const diffMsg = data.diff === 0 ? 'ยอดเงินตรงเป๊ะ!' : (data.diff > 0 ? `เงินเกิน +${fmtMoney(data.diff)} บาท` : `เงินขาด ${fmtMoney(data.diff)} บาท`);
      await window.loadDrawerView();
      await uiAlert('สรุปผลปิดกะลิ้นชัก', `ยอดตามระบบ: ${fmtMoney(data.expected)} ฿\nนับเงินสดจริง: ${fmtMoney(data.actual)} ฿\nผลลัพธ์: ${diffMsg}`, data.diff === 0 ? 'success' : 'warning');
    });
  };

  window.saveDrawerMovement = () => {
    if (!state.currentShift) return uiAlert('ยังไม่ได้เปิดกะ', 'ต้องเปิดกะลิ้นชักก่อนทำรายการเติมหรือเบิกเงิน', 'warning');
    const cat = document.getElementById('mv-type').value;
    const amt = parseFloat(document.getElementById('mv-amount').value || 0);
    const note = document.getElementById('mv-note').value.trim();
    if (amt <= 0 || !note) return showToast('กรุณาระบุจำนวนเงินและหมายเหตุให้ครบ', 'warning');

    withBusy('กำลังบันทึกรายการลิ้นชัก...', async () => {
      const { error } = await supabase.from('wallet_movements').insert({
        shift_id: state.currentShift.id,
        wallet: 'DRAWER',
        direction: cat === 'CASH_IN' ? 'IN' : 'OUT',
        category: cat,
        amount: amt,
        note,
        created_by: state.currentUser.id
      });
      if (error) return uiAlert('บันทึกไม่สำเร็จ', error.message, 'error');
      document.getElementById('mv-amount').value = '';
      document.getElementById('mv-note').value = '';
      await window.loadDrawerView();
      showToast('บันทึกรายการลิ้นชักเรียบร้อย', 'success');
    });
  };

  window.voidBill = async (txId, billNo) => {
    const reason = await uiPrompt(`ยกเลิกบิล ${billNo}`, 'ระบุสาเหตุ เช่น คีย์น้ำหนักผิด / ลูกค้ายกเลิก');
    if (!reason || !reason.trim()) return;

    await withBusy('กำลังยกเลิกบิลและคืนยอดเงิน...', async () => {
      const { error } = await supabase.rpc('void_transaction_pin', { p_user_id: state.currentUser.id, p_tx_id: txId, p_reason: reason.trim() });
      if (error) return uiAlert('ยกเลิกบิลไม่ได้', error.message, 'error');
      await window.loadDrawerView();
      showToast(`ยกเลิกบิล ${billNo} และคืนยอดเงินแล้ว`, 'success');
    });
  };

  window.editBillToPos = async (txId, origCreatedAt) => {
    const reason = await uiPrompt('แก้ไขบิล (ดึงกลับไปหน้าชั่ง)', 'ระบุสาเหตุที่แก้ไข เช่น แก้น้ำหนักเข่ง');
    if (!reason || !reason.trim()) return;

    await withBusy('กำลังดึงรายการกลับมาหน้าชั่ง...', async () => {
      const { error } = await supabase.rpc('void_transaction_pin', { p_user_id: state.currentUser.id, p_tx_id: txId, p_reason: `แก้ไขบิล: ${reason.trim()}` });
      if (error) return uiAlert('ไม่สามารถดึงบิลแก้ไขได้', error.message, 'error');

      const { data: fullItems } = await supabase.from('transaction_items').select('*, items(name, default_buy_price)').eq('tx_id', txId);
      state.cart = (fullItems || []).map(fi => {
        const baseName = fi.items?.name || fi.custom_item_name;
        const fullName = fi.variant_name ? `${baseName} (${fi.variant_name})` : baseName;
        return {
          item_id: fi.item_id || '',
          base_name: baseName,
          variant_name: fi.variant_name || null,
          name: fullName,
          custom_name: fi.custom_item_name,
          custom_cat_id: fi.custom_category_id,
          weight_kg: Number(fi.weight_kg),
          tare_kg: Number(fi.tare_kg),
          net_weight_kg: Number(fi.net_weight_kg),
          unit_price: Number(fi.unit_price),
          is_override: fi.is_price_overridden,
          auto_update_price: false,
          subtotal: Number(fi.subtotal)
        };
      });

      if (origCreatedAt) {
        const origDate = new Date(origCreatedAt);
        const offsetMs = origDate.getTimezoneOffset() * 60000;
        document.getElementById('pos-tx-date').value = new Date(origDate.getTime() - offsetMs).toISOString().slice(0, 10);
        window.checkPosBackdateBadge();
      }

      renderCart();
      window.switchTab('pos');
      showToast('ดึงรายการกลับมาแก้ไขที่หน้า POS แล้ว (คงวันที่บิลเดิมไว้ให้)', 'info');
    });
  };

  window.togglePartialWeight = () => {
    const full = document.getElementById('ship-clear-all').checked;
    document.getElementById('ship-partial-kg').classList.toggle('hidden', full);
  };

  window.loadSellView = async () => {
    await loadInitialData();
    renderFilterControl('sell', 'sell-filter-bar');
    const range = getPeriodRange(filters.sell);

    const shipDateEl = document.getElementById('ship-date');
    if (shipDateEl && !shipDateEl.value) shipDateEl.value = getTodayStr();

    const mainSel = document.getElementById('ship-main-item');
    mainSel.innerHTML = state.items.map(i => `<option value="${i.id}">${i.name} (ในลาน: ${fmtWeight(i.current_stock_kg)} กก.)</option>`).join('');
    window.renderBundleCheckboxes();

    const [transitRes, doneRes] = await Promise.all([
      supabase.from('transactions').select('*, transaction_items(*, items(name), sell_bundled_piles(*, items(name)))').eq('tx_type', 'SELL').eq('status', 'IN_TRANSIT').order('created_at', { ascending: false }),
      supabase.from('transactions').select('*, transaction_items(*, items(name), sell_bundled_piles(*, items(name)))').eq('tx_type', 'SELL').eq('status', 'COMPLETED').gte('created_at', range.startISO).lte('created_at', range.endISO).order('created_at', { ascending: false }).limit(5000)
    ]);

    const transit = transitRes.data || [];
    const done = doneRes.data || [];
    paging.sellDone.rows = done;

    const totalSellAmt = done.reduce((s, d) => s + Number(d.total_amount), 0);
    const totalProfit = done.reduce((s, d) => s + Number(d.realized_profit || 0), 0);
    document.getElementById('sell-filter-summary').textContent =
      `${range.label} • ขายสำเร็จ ${done.length} เที่ยว • รับเงินรวม ${fmtMoney(totalSellAmt)} ฿ • กำไรรวม ${fmtMoney(totalProfit)} ฿`;

    document.getElementById('in-transit-list').innerHTML = transit.length ? transit.map(t => {
      const ti = t.transaction_items?.[0];
      const bundles = (ti?.sell_bundled_piles || []).map(b => `${b.items?.name} (${b.cleared_weight_kg} กก.)`).join(', ');
      const defaultDate = new Date(new Date(t.created_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      return `
        <div class="bg-slate-900 border border-amber-500/40 rounded-2xl p-4 space-y-3">
          <div>
            <div class="font-bold text-white">${t.bill_no} — ${t.customer_or_factory_name || 'ไม่ระบุโรงงาน'}</div>
            <div class="text-xs text-slate-400">สินค้าหลัก: ${ti?.items?.name} (ตัดสต็อก ${fmtWeight(ti?.stock_before_sell_kg)} กก.) ${bundles ? `| พ่วงกอง: ${bundles}` : ''}</div>
            <div class="text-xs text-amber-300">ต้นทุนรวมของรอบนี้: ${fmtMoney(t.total_cost_snapshot)} ฿</div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input id="settle-w-${t.id}" type="number" inputmode="decimal" step="0.01" placeholder="น้ำหนักใบชั่งโรงงาน (กก.)" class="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white font-bold" />
            <input id="settle-p-${t.id}" type="number" inputmode="decimal" step="0.01" placeholder="ราคาขายที่ได้ (บาท/กก.)" class="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white font-bold" />
            <input id="settle-d-${t.id}" type="date" value="${defaultDate}" class="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white font-semibold" />
            <select id="settle-wal-${t.id}" class="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white">
              <option value="BANK">รับเงินโอนเข้าธนาคาร</option>
              <option value="SAFE">รับเงินสดเข้าตู้เซฟ</option>
              <option value="DRAWER">รับเงินสดเข้าลิ้นชัก</option>
            </select>
          </div>
          <button onclick="settleShipment('${t.id}')" class="active-press w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl text-sm">✅ ยืนยันใบชั่ง & ปิดยอดคิดกำไร</button>
        </div>
      `;
    }).join('') : `<div class="text-slate-500 text-sm text-center py-4">ไม่มีเที่ยวรถที่รอใบชั่ง</div>`;

    renderSellDonePage();
  };

  window.renderBundleCheckboxes = () => {
    const mainId = document.getElementById('ship-main-item').value;
    const box = document.getElementById('ship-bundle-list');
    box.innerHTML = state.items.filter(i => i.id !== mainId && i.current_stock_kg > 0).map(i => `
      <label class="flex items-center justify-between text-xs bg-slate-950 px-3 py-2.5 rounded-lg cursor-pointer">
        <span><input type="checkbox" value="${i.id}" class="bundle-chk accent-amber-500 mr-2 w-4 h-4" />${i.name}</span>
        <span class="text-slate-400">${fmtWeight(i.current_stock_kg)} กก. (ทุน ${fmtMoney(i.current_total_cost)} ฿)</span>
      </label>
    `).join('') || `<div class="text-xs text-slate-500">ไม่มีกองอื่นที่มีสต็อกคงเหลือ</div>`;
  };

  window.createShipment = () => {
    const shipDate = document.getElementById('ship-date').value || getTodayStr();
    const factory = document.getElementById('ship-factory').value.trim();
    const mainId = document.getElementById('ship-main-item').value;
    const clearAll = document.getElementById('ship-clear-all').checked;
    const partialKg = parseFloat(document.getElementById('ship-partial-kg').value || 0);
    const bundledIds = Array.from(document.querySelectorAll('.bundle-chk:checked')).map(el => el.value);

    if (!factory) return showToast('กรุณาระบุชื่อโรงงานหรือทะเบียนรถ', 'warning');

    withBusy('กำลังตัดกองขึ้นรถ...', async () => {
      const { error } = await supabase.rpc('create_factory_shipment_pin', {
        p_user_id: state.currentUser.id,
        p_factory_name: factory,
        p_main_item_id: mainId,
        p_clear_main_pile: clearAll,
        p_partial_weight_kg: partialKg,
        p_bundled_item_ids: bundledIds,
        p_tx_date: buildEffectiveTimestamp(shipDate)
      });
      if (error) return uiAlert('บันทึกขึ้นรถไม่สำเร็จ', error.message, 'error');
      document.getElementById('ship-factory').value = '';
      await window.loadSellView();
      showToast('บันทึกเที่ยวรถส่งขายเรียบร้อย!', 'success');
    });
  };

  window.settleShipment = (txId) => {
    const w = parseFloat(document.getElementById(`settle-w-${txId}`).value || 0);
    const p = parseFloat(document.getElementById(`settle-p-${txId}`).value || 0);
    const dVal = document.getElementById(`settle-d-${txId}`).value || getTodayStr();
    const wal = document.getElementById(`settle-wal-${txId}`).value;
    if (w <= 0 || p <= 0) return showToast('กรุณากรอกน้ำหนักใบชั่งโรงงานและราคาขายให้ครบ', 'warning');

    withBusy('กำลังปิดยอดใบชั่งโรงงาน...', async () => {
      const { data, error } = await supabase.rpc('settle_factory_shipment_pin', {
        p_user_id: state.currentUser.id,
        p_shift_id: state.currentShift?.id || null,
        p_tx_id: txId,
        p_actual_weight_kg: w,
        p_sell_unit_price: p,
        p_receive_wallet: wal,
        p_settle_date: buildEffectiveTimestamp(dVal)
      });
      if (error) return uiAlert('ปิดยอดขายไม่สำเร็จ', error.message, 'error');
      await window.loadSellView();
      await uiAlert('ปิดยอดขายโรงงานสำเร็จ!', `รับเงินรวม: ${fmtMoney(data.total_amount)} ฿\nกำไรสุทธิรอบนี้: ${fmtMoney(data.profit)} ฿`, 'success');
    });
  };

  window.loadOwnerView = async () => {
    await loadInitialData();
    renderFilterControl('owner', 'owner-filter-bar');
    const range = getPeriodRange(filters.owner);

    const { data: bal } = await supabase.rpc('get_wallet_balances_pin', { p_user_id: state.currentUser.id, p_shift_id: state.currentShift?.id || null });
    if (bal) {
      document.getElementById('ow-drawer').textContent = `${fmtMoney(bal.drawer)} ฿`;
      document.getElementById('ow-safe').textContent = `${fmtMoney(bal.safe)} ฿`;
      document.getElementById('ow-bank').textContent = `${fmtMoney(bal.bank)} ฿`;
    }

    const [txRes, userRes] = await Promise.all([
      supabase.from('transactions').select('*').gte('created_at', range.startISO).lte('created_at', range.endISO).order('created_at', { ascending: false }).limit(5000),
      supabase.from('profiles').select('*').order('created_at')
    ]);

    const txs = txRes.data || [];
    const completedBuy = txs.filter(t => t.tx_type === 'BUY' && t.status === 'COMPLETED');
    const completedSell = txs.filter(t => t.tx_type === 'SELL' && t.status === 'COMPLETED');
    const sumBuy = completedBuy.reduce((s, t) => s + Number(t.total_amount), 0);
    const sumSell = completedSell.reduce((s, t) => s + Number(t.total_amount), 0);
    const sumProfit = completedSell.reduce((s, t) => s + Number(t.realized_profit || 0), 0);

    document.getElementById('owner-period-summary').textContent =
      `${range.label} • ซื้อเข้า ${fmtMoney(sumBuy)} ฿ • ขายออก ${fmtMoney(sumSell)} ฿ • กำไรปิดล็อต ${fmtMoney(sumProfit)} ฿`;
    document.getElementById('chart-flow-title').textContent = `ยอดรับซื้อเข้า vs ขายออก (${range.label})`;

    const voids = txs.filter(t => t.status === 'VOIDED');
    paging.ownerVoids.rows = voids;
    document.getElementById('ow-void-count').textContent = `${voids.length} ใบ`;
    renderOwnerVoidsPage();

    document.getElementById('owner-items-cards').innerHTML = state.items.map(it => {
      const avg = it.current_stock_kg > 0 ? (it.current_total_cost / it.current_stock_kg) : 0;
      const variants = Array.isArray(it.sub_variants) ? it.sub_variants : [];
      const varBadges = variants.length
        ? variants.map(v => `<span class="bg-slate-800 border border-slate-700 text-amber-300 text-xs font-semibold px-2.5 py-1 rounded-lg">${v.name} (${fmtMoney(v.price)})</span>`).join('')
        : `<span class="text-xs text-slate-500">ใช้ราคาเดี่ยว (${fmtMoney(it.default_buy_price)}/กก.)</span>`;

      return `
        <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div class="space-y-1.5 flex-1 min-w-[220px]">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded bg-slate-800 text-xs font-bold text-slate-300">${it.short_code || '-'}</span>
              <span class="font-bold text-base text-white">${it.name}</span>
              <span class="text-xs text-slate-400">(${it.categories?.name || '-'})</span>
            </div>
            <div class="flex flex-wrap gap-1.5">${varBadges}</div>
          </div>

          <div class="flex items-center gap-4 sm:gap-5 ml-auto">
            <div class="text-right">
              <div class="text-[11px] text-slate-400">สต็อกในลาน</div>
              <div class="font-extrabold text-emerald-400">${fmtWeight(it.current_stock_kg)} กก.</div>
            </div>
            <div class="text-right">
              <div class="text-[11px] text-slate-400">ทุนเฉลี่ย</div>
              <div class="font-bold text-amber-300">${fmtMoney(avg)} ฿</div>
            </div>
            <button onclick="openItemEditor('${it.id}')" class="active-press bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white font-bold px-4 py-2.5 rounded-xl text-sm">
              ⚙️ แก้ไข / เกรดย่อย
            </button>
          </div>
        </div>
      `;
    }).join('');

    document.getElementById('owner-users-list').innerHTML = (userRes.data || []).map(u => `
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-2.5 flex justify-between items-center text-xs">
        <span><strong>${u.full_name}</strong> (${u.role.toUpperCase()}) — PIN: <code class="text-emerald-400 font-bold">${u.pin_code}</code></span>
        <button onclick="toggleUserActive('${u.id}', ${!u.is_active})" class="active-press px-3 py-1.5 rounded-lg font-bold ${u.is_active ? 'bg-red-900/40 text-red-300' : 'bg-emerald-900/40 text-emerald-300'}">${u.is_active ? 'ระงับสิทธิ์' : 'เปิดใช้'}</button>
      </div>
    `).join('');

    renderOwnerCharts(state.items, txs, filters.owner, range);
  };

  window.openItemEditor = (itemId = null) => {
    editingItemId = itemId;
    const catSel = document.getElementById('ie-cat');
    catSel.innerHTML = state.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

    if (itemId) {
      const it = state.items.find(i => i.id === itemId);
      if (!it) return;
      document.getElementById('ie-modal-title').textContent = `แก้ไขสินค้า: ${it.name}`;
      document.getElementById('ie-name').value = it.name;
      document.getElementById('ie-code').value = it.short_code || '';
      document.getElementById('ie-cat').value = it.category_id;
      document.getElementById('ie-price').value = it.default_buy_price;
      document.getElementById('ie-max').value = it.max_buy_price ?? '';
      editorVariants = Array.isArray(it.sub_variants) ? it.sub_variants.map(v => ({ ...v })) : [];
      document.getElementById('ie-btn-hide').classList.remove('hidden');
    } else {
      document.getElementById('ie-modal-title').textContent = '➕ เพิ่มรายการสินค้าใหม่';
      document.getElementById('ie-name').value = '';
      document.getElementById('ie-code').value = '';
      document.getElementById('ie-price').value = '';
      document.getElementById('ie-max').value = '';
      editorVariants = [];
      document.getElementById('ie-btn-hide').classList.add('hidden');
    }

    renderEditorVariantRows();
    document.getElementById('item-editor-modal').classList.remove('hidden');
  };

  window.closeItemEditor = () => document.getElementById('item-editor-modal').classList.add('hidden');

  function syncEditorVariantInputs() {
    editorVariants = editorVariants.map((_, idx) => ({
      name: document.getElementById(`ev-name-${idx}`)?.value || '',
      price: parseFloat(document.getElementById(`ev-price-${idx}`)?.value || 0)
    }));
  }

  function renderEditorVariantRows() {
    const container = document.getElementById('ie-variants-rows');
    if (!editorVariants.length) {
      container.innerHTML = `<div class="text-xs text-slate-500 text-center py-3">ไม่มีเกรดย่อย (ใช้ราคากลางตั้งต้นเดี่ยวๆ หรือแตะ "+ เพิ่มเกรดย่อย" ด้านบน)</div>`;
      return;
    }

    container.innerHTML = editorVariants.map((v, idx) => `
      <div class="flex items-center gap-2">
        <input id="ev-name-${idx}" type="text" value="${v.name}" placeholder="ชื่อเกรด เช่น ปอกสวย, เผา"
          class="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white font-semibold" />
        <div class="relative w-32 sm:w-36 shrink-0">
          <input id="ev-price-${idx}" type="number" inputmode="decimal" step="0.01" value="${v.price || ''}" placeholder="ราคา/กก."
            class="w-full bg-slate-800 border border-slate-700 rounded-xl pl-3 pr-7 py-2.5 text-sm text-amber-300 font-bold" />
          <span class="absolute right-2.5 top-2.5 text-xs text-slate-400">฿</span>
        </div>
        <button onclick="removeEditorVariantRow(${idx})" class="active-press bg-red-950 hover:bg-red-900 text-red-400 px-3 py-2.5 rounded-xl text-sm font-bold shrink-0">✕</button>
      </div>
    `).join('');
  }

  window.addEditorVariantRow = () => {
    syncEditorVariantInputs();
    editorVariants.push({ name: '', price: '' });
    renderEditorVariantRows();
    setTimeout(() => document.getElementById(`ev-name-${editorVariants.length - 1}`)?.focus(), 40);
  };

  window.removeEditorVariantRow = (idx) => {
    syncEditorVariantInputs();
    editorVariants.splice(idx, 1);
    renderEditorVariantRows();
  };

  window.saveItemFromEditor = () => {
    syncEditorVariantInputs();
    const name = document.getElementById('ie-name').value.trim();
    const short_code = document.getElementById('ie-code').value.trim() || null;
    const category_id = document.getElementById('ie-cat').value;
    const maxVal = document.getElementById('ie-max').value;
    const cleanVariants = editorVariants
      .map(v => ({ name: v.name.trim(), price: parseFloat(v.price || 0) }))
      .filter(v => v.name && v.price > 0);

    let default_buy_price = parseFloat(document.getElementById('ie-price').value || 0);
    if (default_buy_price <= 0 && cleanVariants.length > 0) {
      default_buy_price = cleanVariants[0].price;
    }

    if (!name || default_buy_price <= 0) {
      return showToast('กรุณากรอกชื่อสินค้าและราคาตั้งต้นให้ครบ', 'warning');
    }

    const payload = {
      name,
      short_code,
      category_id,
      default_buy_price,
      max_buy_price: maxVal ? parseFloat(maxVal) : null,
      sub_variants: cleanVariants,
      updated_at: new Date().toISOString()
    };

    withBusy('กำลังบันทึกข้อมูลสินค้า...', async () => {
      const { error } = editingItemId
        ? await supabase.from('items').update(payload).eq('id', editingItemId)
        : await supabase.from('items').insert(payload);

      if (error) return uiAlert('บันทึกสินค้าไม่สำเร็จ', error.message, 'error');

      window.closeItemEditor();
      if (state.activeTab === 'owner') await window.loadOwnerView();
      else await loadInitialData();
      showToast(`บันทึก "${name}" เรียบร้อย!`, 'success');
    });
  };

  window.hideItemFromEditor = async () => {
    if (!editingItemId) return;
    const name = document.getElementById('ie-name').value;
    const ok = await uiConfirm(`ซ่อนรายการ "${name}" ?`, 'สินค้านี้จะถูกซ่อนออกจากหน้าชั่ง POS (ประวัติบิลเก่าและสต็อกไม่หาย)', 'warning', 'ซ่อนสินค้า');
    if (!ok) return;

    await withBusy('กำลังซ่อนรายการสินค้า...', async () => {
      await supabase.from('items').update({ is_active: false }).eq('id', editingItemId);
      window.closeItemEditor();
      if (state.activeTab === 'owner') await window.loadOwnerView();
      else await loadInitialData();
      showToast(`ซ่อน "${name}" ออกจากหน้า POS แล้ว`, 'info');
    });
  };

  window.adjustSafeWallet = async () => {
    const raw = await uiPrompt('ปรับยอดเงินสดในตู้เซฟ', 'ใส่เลขบวกเพื่อเติมเข้า หรือเลขติดลบเพื่อถอนออก เช่น 100000 หรือ -20000', '', 'number');
    const amt = parseFloat(raw || 0);
    if (!amt) return;

    await withBusy('กำลังปรับยอดเงินในเซฟ...', async () => {
      const { error } = await supabase.from('wallet_movements').insert({
        wallet: 'SAFE',
        direction: amt > 0 ? 'IN' : 'OUT',
        category: 'CASH_IN',
        amount: Math.abs(amt),
        note: 'เจ้าของร้านปรับยอดเงินสดในเซฟ',
        created_by: state.currentUser.id
      });
      if (error) return uiAlert('ทำรายการไม่สำเร็จ', error.message, 'error');
      await window.loadOwnerView();
      showToast(`${amt > 0 ? 'เติมเงินเข้าเซฟ' : 'ถอนเงินจากเซฟ'} ${fmtMoney(Math.abs(amt))} ฿ เรียบร้อย`, 'success');
    });
  };

  window.addStaffPin = () => {
    const full_name = document.getElementById('new-u-name').value.trim();
    const role = document.getElementById('new-u-role').value;
    const pin_code = document.getElementById('new-u-pin').value.trim();
    if (!full_name || pin_code.length < 4) return showToast('กรุณากรอกชื่อและรหัส PIN อย่างน้อย 4 หลัก', 'warning');

    withBusy('กำลังสร้างรหัส PIN พนักงาน...', async () => {
      const { error } = await supabase.from('profiles').insert({ full_name, role, pin_code });
      if (error) return uiAlert('เพิ่มพนักงานไม่สำเร็จ', 'รหัส PIN นี้อาจซ้ำกับคนอื่น: ' + error.message, 'error');
      document.getElementById('new-u-name').value = '';
      document.getElementById('new-u-pin').value = '';
      await window.loadOwnerView();
      showToast(`เพิ่ม PIN ของ "${full_name}" เรียบร้อย`, 'success');
    });
  };

  window.toggleUserActive = (id, is_active) => {
    withBusy('กำลังอัปเดตสิทธิ์พนักงาน...', async () => {
      await supabase.from('profiles').update({ is_active }).eq('id', id);
      await window.loadOwnerView();
      showToast(is_active ? 'เปิดใช้งานบัญชีแล้ว' : 'ระงับสิทธิ์การใช้งานแล้ว', 'info');
    });
  };
}

function toLocalParts(isoStr) {
  const d = new Date(isoStr);
  const bkk = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  return {
    day: bkk.getDate(),
    month: bkk.getMonth() + 1,
    hour: bkk.getHours()
  };
}

function renderOwnerCharts(items, txs, f, range) {
  const catTotals = {};
  items.forEach(it => {
    const cName = it.categories?.name || 'อื่นๆ';
    catTotals[cName] = (catTotals[cName] || 0) + Number(it.current_total_cost || 0);
  });

  if (catChartInstance) catChartInstance.destroy();
  catChartInstance = new Chart(document.getElementById('chart-category'), {
    type: 'doughnut',
    data: {
      labels: Object.keys(catTotals),
      datasets: [{ data: Object.values(catTotals), backgroundColor: ['#EA580C', '#CA8A04', '#0284C7', '#475569', '#6366F1', '#16A34A', '#A16207', '#DC2626'] }]
    },
    options: { plugins: { legend: { labels: { color: '#cbd5e1' } } } }
  });

  let labels = [];
  let buySeries = [];
  let sellSeries = [];

  const validTxs = txs.filter(t => t.status === 'COMPLETED');

  if (f.mode === 'day') {
    labels = Array.from({ length: 14 }, (_, i) => `${i + 6}:00`);
    buySeries = Array(14).fill(0);
    sellSeries = Array(14).fill(0);
    validTxs.forEach(t => {
      const { hour } = toLocalParts(t.created_at);
      const idx = Math.min(13, Math.max(0, hour - 6));
      if (t.tx_type === 'BUY') buySeries[idx] += Number(t.total_amount);
      else sellSeries[idx] += Number(t.total_amount);
    });
  } else if (f.mode === 'month') {
    const nDays = range.daysInMonth || 31;
    labels = Array.from({ length: nDays }, (_, i) => `${i + 1}`);
    buySeries = Array(nDays).fill(0);
    sellSeries = Array(nDays).fill(0);
    validTxs.forEach(t => {
      const { day } = toLocalParts(t.created_at);
      if (day >= 1 && day <= nDays) {
        if (t.tx_type === 'BUY') buySeries[day - 1] += Number(t.total_amount);
        else sellSeries[day - 1] += Number(t.total_amount);
      }
    });
  } else {
    labels = TH_MONTHS;
    buySeries = Array(12).fill(0);
    sellSeries = Array(12).fill(0);
    validTxs.forEach(t => {
      const { month } = toLocalParts(t.created_at);
      if (t.tx_type === 'BUY') buySeries[month - 1] += Number(t.total_amount);
      else sellSeries[month - 1] += Number(t.total_amount);
    });
  }

  if (flowChartInstance) flowChartInstance.destroy();
  flowChartInstance = new Chart(document.getElementById('chart-cashflow'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'จ่ายรับซื้อ (฿)', data: buySeries, backgroundColor: '#f59e0b' },
        { label: 'รับขายโรงงาน (฿)', data: sellSeries, backgroundColor: '#10b981' }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { x: { ticks: { color: '#94a3b8' } }, y: { ticks: { color: '#94a3b8' } } },
      plugins: { legend: { labels: { color: '#cbd5e1' } } }
    }
  });
}
(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const state = {
    data: {}, settings: {}, neighborhoods: [], pharmacyRows: [],
    emergencyRows: [], ads: [], deferredInstall: null,
    swRegistration: null, lastRefresh: 0, activeView: 'home',
    activeSubview: 'emergency'
  };

  const text = (value, fallback = '') =>
    value == null || String(value).trim() === '' ? fallback : String(value).trim();

  const bool = (value) =>
    ['true', '1', 'yes', 'نعم', 'active'].includes(String(value ?? '').trim().toLowerCase());

  const escapeURL = (raw, allowed = ['https:', 'http:']) => {
    try {
      const url = new URL(String(raw));
      return allowed.includes(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  };

  const phoneURL = (raw) => {
    const phone = String(raw ?? '').replace(/[\s()-]/g, '');
    return /^\+?[0-9]{5,18}$/.test(phone) ? tel:${phone} : '';
  };

  const safeDate = (value) => {
    const s = String(value ?? '').trim();
    if (!s) return null;
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/);
    if (!m) return null;
    const [, yy, mm, dd, hh = '0', mi = '0'] = m;
    const p = { y: Number(yy), mo: Number(mm), d: Number(dd), h: Number(hh), mi: Number(mi) };
    if (p.mo < 1  p.mo > 12  p.d < 1  p.d > 31  p.h > 23 || p.mi > 59) return null;
    return p;
  };

  const datePartsNow = () => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: CFG.TIME_ZONE || 'Asia/Damascus',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date());
    const out = {};
    parts.forEach(p => { if (p.type !== 'literal') out[p.type] = Number(p.value); });
    return out;
  };

  const damascusOffset = (date) => {
    try {
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: CFG.TIME_ZONE || 'Asia/Damascus',
        timeZoneName: 'shortOffset'
      });
      const part = fmt.formatToParts(date).find(p => p.type === 'timeZoneName')?.value || 'GMT+3';
      const m = part.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
      if (!m) return 180;
      return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
    } catch {
      return 180;
    }
  };

  const damascusDateToEpoch = (p) => {
    if (!p) return NaN;
    const utc = Date.UTC(p.y, p.mo - 1, p.d, p.h  0, p.mi  0);
    let guess = utc - damascusOffset(new Date(utc)) * 60000;
    guess = utc - damascusOffset(new Date(guess)) * 60000;
    return guess;
  };

  const fmtDate = (epoch) => new Intl.DateTimeFormat('ar-SY', {
    timeZone: CFG.TIME_ZONE || 'Asia/Damascus',
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(new Date(epoch));

  const fmtRelative = (epoch) => {
    const diff = epoch - Date.now();
    if (diff <= 0) return 'الموعد انتهى';
    const mins = Math.floor(diff / 60000);
    const days = Math.floor(mins / 1440);
    const hours = Math.floor((mins % 1440) / 60);
    const rest = mins % 60;
    if (days) return بعد ${days} يوم${hours ?  و${hours} ساعة : ''};
    if (hours) return بعد ${hours} ساعة${rest ?  و${rest} دقيقة : ''};
    return بعد ${Math.max(1, rest)} دقيقة;
  };

  function parseCSV(csv) {
    const rows = [];
    let row = [], field = '', quoted = false;
    csv = String(csv ?? '').replace(/^\uFEFF/, '');
    for (let i = 0; i < csv.length; i++) {
      const c = csv[i];
      if (quoted) {
        if (c === '"' && csv[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"' && field === '') quoted = true;
      else if (c === ',') { row.push(field); field = ''; }  
    else if (c === '\n') {
        row.push(field.replace(/\r$/, ''));
        if (row.some(v => v.trim() !== '')) rows.push(row);
        row = []; field = '';
      } else field += c;
    }
    row.push(field.replace(/\r$/, ''));
    if (row.some(v => v.trim() !== '')) rows.push(row);
    if (!rows.length) return [];
    const headers = rows.shift().map(h => h.trim());
    return rows.map(cols => {
      const obj = {};
      headers.forEach((h, i) => { if (h) obj[h] = cols[i] ?? ''; });
      return obj;
    });
  }

  async function fetchTab(tab) {
    const url = https://docs.google.com/spreadsheets/d/${encodeURIComponent(CFG.SHEET_ID)}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)};
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(CFG.FETCH_TIMEOUT_MS) || 12000);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error(HTTP ${response.status});
      const csv = await response.text();
      if (/<!doctype html|<html/i.test(csv.slice(0, 500))) throw new Error(تعذر قراءة ورقة ${tab});
      return parseCSV(csv);
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchAll() {
    if (!CFG.SHEET_ID || CFG.SHEET_ID.includes('PUT_')) {
      throw new Error('لم يتم إعداد معرّف Google Sheets في data.js');
    }
    const tabs = CFG.DATA_TABS || ['Settings', 'Water', 'Pharmacies', 'Emergency', 'Ads', 'Neighborhoods'];
    const pairs = await Promise.all(tabs.map(async tab => [tab, await fetchTab(tab)]));
    return Object.fromEntries(pairs);
  }

  function getSettings(rows) {
    const result = {};
    (rows || []).forEach(row => {
      if (row.key) result[String(row.key).trim()] = String(row.value ?? '').trim();
    });
    return result;
  }

  function validateAndApply(raw) {
    state.settings = getSettings(raw.Settings);
    state.data = raw;
    state.neighborhoods = (raw.Neighborhoods || [])
      .filter(r => text(r.name) && bool(r.active))
      .sort((a, b) => (Number(a.sort_order)  999) - (Number(b.sort_order)  999))
      .map(r => text(r.name));
    state.pharmacyRows = (raw.Pharmacies || []).filter(r => text(r.name) && bool(r.active));
    state.emergencyRows = (raw.Emergency || []).filter(r => text(r.name) && bool(r.active) && text(r.phone));
    state.ads = (raw.Ads || []).filter(r => bool(r.active));
    applySettings();
    renderAll();
  }

  function applySettings() {
    const s = state.settings;
    document.title = text(s.app_name, 'خدمات جيرود');
    if ($('app-name')) $('app-name').textContent = text(s.app_name, 'خدمات جيرود');
    if ($('welcome-message')) $('welcome-message').textContent = text(s.welcome_message, 'خدمات مدينتك في مكان واحد');
    if ($('install-title')) $('install-title').textContent = text(s.install_prompt_title, 'هل تريد إضافة خدمات جيرود إلى الشاشة الرئيسية؟');
    if ($('install-copy')) $('install-copy').textContent = text(s.install_prompt_copy, 'افتح التطبيق بسرعة من شاشة هاتفك.');
    if ($('install-accept')) $('install-accept').textContent = text(s.install_prompt_add, 'إضافة إلى الشاشة الرئيسية');
    if ($('install-dismiss')) $('install-dismiss').textContent = text(s.install_prompt_later, 'ليس الآن');
    const logo = escapeURL(s.logo_url);
    if (logo && $('app-logo')) $('app-logo').src = logo;
    document.documentElement.style.setProperty('--primary', '#16a36a');
  }

  function currentNeighborhood() {
    return localStorage.getItem('jeroud-neighborhood')  state.neighborhoods[0]  '';
  }

  function fillNeighborhoodSelects() {
    ['home-neighborhood', 'water-neighborhood', 'settings-neighborhood'].forEach(id => {
      const select = $(id);
      if (!select) return;
      const old = select.value || currentNeighborhood();  
                                                  select.replaceChildren();
      state.neighborhoods.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.append(option);
      });
      if (state.neighborhoods.includes(old)) select.value = old;
    });
  }

  function create(tag, cls, content) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (content !== undefined) el.textContent = content;
    return el;
  }

  function empty(container, message) {
    if (container) container.replaceChildren(create('div', 'empty-state', message));
  }

  function renderWater(container, neighborhood) {
    if (!container) return;
    const rows = (state.data.Water || []).filter(r =>
      text(r.neighborhood) === neighborhood && text(r.next_time));
    const now = Date.now();
    const future = rows.map(r => ({ r, epoch: damascusDateToEpoch(safeDate(r.next_time)) }))
      .filter(x => Number.isFinite(x.epoch) && x.epoch > now)
      .sort((a, b) => a.epoch - b.epoch);
    container.replaceChildren();
    if (!future.length) {
      container.append(create('p', 'muted', rows.length ? 'لا يوجد موعد قادم مسجل.' : 'لا توجد بيانات مياه لهذا الحي.'));
      return;
    }
    const { r, epoch } = future[0];
    container.append(create('div', 'big-time', fmtRelative(epoch)), create('p', '', fmtDate(epoch)));
    if (text(r.note)) container.append(create('p', 'muted', r.note));
    const updated = safeDate(r.updated_at);
    if (updated) {
      const age = Date.now() - damascusDateToEpoch(updated);
      const limit = Math.max(1, Number(state.settings.water_stale_hours) || 24) * 3600000;
      if (age > limit) container.append(create('p', 'warning', 'قد يكون موعد المياه قد تغيّر، يرجى التأكد من آخر تحديث.'));
      container.append(create('p', 'muted', آخر تحديث: ${fmtDate(damascusDateToEpoch(updated))}));
    } else container.append(create('p', 'warning', 'وقت تحديث البيانات غير مسجل.'));
  }

  function getPharmacyTimes(row) {
    const date = safeDate(row.date);
    const start = String(row.start_time || '').match(/^(\d{1,2}):(\d{2})$/);
    const end = String(row.end_time || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!date  !start  !end) return null;
    const a = { ...date, h: Number(start[1]), mi: Number(start[2]) };
    const b = { ...date, h: Number(end[1]), mi: Number(end[2]) };
    const startEpoch = damascusDateToEpoch(a);
    let endEpoch = damascusDateToEpoch(b);
    if (endEpoch <= startEpoch) endEpoch += 86400000;
    return { startEpoch, endEpoch };
  }

  function pharmacyNow(row) {
    const times = getPharmacyTimes(row);
    return !!times && Date.now() >= times.startEpoch && Date.now() < times.endEpoch;
  }

  function pharmacyCard(row) {
    const card = create('article', 'item-card');
    card.append(create('h4', '', text(row.name)));
    const shifts = { day: 'نهاري', night: 'ليلي', '24h': '24 ساعة' };
    card.append(create('p', '', ${text(row.neighborhood, 'الحي غير محدد')} · ${shifts[row.shift_type] || 'نوع المناوبة غير محدد'}));
    if (text(row.address)) card.append(create('p', '', row.address));
    if (text(row.date)) card.append(create('p', 'muted', التاريخ: ${row.date} · ${text(row.start_time, '؟')}–${text(row.end_time, '؟')}));
    if (pharmacyNow(row)) card.append(create('p', 'warning', 'مناوبة الآن بحسب الوقت المسجل'));
    const actions = create('div', 'item-actions');
    const tel = phoneURL(row.phone);
    if (tel) {
      const a = create('a', 'small-link', 'اتصال');
      a.href = tel;
      actions.append(a);
    }
    const lat = Number(row.latitude), lon = Number(row.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 &&
        Math.abs(lon) <= 180 && row.latitude !== '' && row.longitude !== '') {                   
      const a = create('a', 'small-link', 'الموقع');
      a.href = https://www.google.com/maps?q=${lat},${lon};
      a.target = '_blank'; a.rel = 'noopener noreferrer';
      actions.append(a);
    }
    if (actions.childElementCount) card.append(actions);
    return card;
  }

  function renderPharmacies() {
    if (!$('pharmacy-search')  !$('pharmacy-type')  !$('pharmacy-list')) return;
    const query = $('pharmacy-search').value.trim().toLowerCase();
    const type = $('pharmacy-type').value;
    const rows = state.pharmacyRows.filter(row => {
      const hay = [row.name, row.neighborhood, row.address].join(' ').toLowerCase();
      return (!query || hay.includes(query)) &&
        (type === 'all' || (type === 'now' ? pharmacyNow(row) : row.shift_type === type));
    });
    const list = $('pharmacy-list');
    list.replaceChildren();
    if (!rows.length) { empty(list, 'لا توجد نتائج مطابقة.'); return; }
    rows.forEach(row => list.append(pharmacyCard(row)));
  }

  function renderEmergency(container) {
    if (!container) return;
    container.replaceChildren();
    if (!state.emergencyRows.length) { empty(container, 'لا توجد أرقام مضافة حالياً.'); return; }
    state.emergencyRows.slice()
      .sort((a, b) => (Number(a.sort_order)  999) - (Number(b.sort_order)  999))
      .forEach(row => {
        const card = create('article', 'item-card');
        card.append(create('h4', '', text(row.name)));
        card.append(create('p', '', text(row.category, 'أرقام مهمة')));
        const tel = phoneURL(row.phone);
        if (tel) {
          const a = create('a', 'small-link', 'اتصال');
          a.href = tel;
          card.append(a);
        }
        container.append(card);
      });
  }

  function validAd(row, placement) {
    if (row.placement !== placement) return false;
    const url = escapeURL(row.destination_url);
    if (!url) return false;
    const now = Date.now();
    const start = safeDate(row.start_date), end = safeDate(row.end_date);
    if (start && now < damascusDateToEpoch(start)) return false;
    if (end && now > damascusDateToEpoch({ ...end, h: 23, mi: 59 })) return false;
    return true;
  }

  function adNode(placement) {
    const rows = state.ads.filter(row => validAd(row, placement))
      .sort((a, b) => (Number(a.sort_order)  999) - (Number(b.sort_order)  999));
    if (rows.length) {
      const row = rows[0], link = create('a', 'ad-card');
      link.href = escapeURL(row.destination_url);
      link.target = '_blank'; link.rel = 'noopener noreferrer';
      const imageUrl = escapeURL(row.image_url);
      if (imageUrl) {
        const img = document.createElement('img');
        img.src = imageUrl; img.alt = text(row.title, 'إعلان');
        img.loading = 'lazy'; img.width = 800; img.height = 300;
        link.append(img);
      }
      const content = create('div', 'ad-content');
      content.append(create('span', 'ad-label', 'إعلان'), create('h3', '', text(row.title, 'إعلان')));
      if (text(row.description)) content.append(create('p', '', row.description));
      link.append(content);
      return link;
    }

    const box = create('button', 'ad-placeholder');
    box.type = 'button';
    box.setAttribute('aria-label', 'اضغط للتواصل من أجل إضافة إعلان');
    box.append(
      create('h3', 'ad-placeholder-title', '📣 ضع إعلانك هنا'),
      create('p', '', 'أعلن عن نشاطك التجاري في خدمات جيرود.'),
      create('span', 'ad-placeholder-action', 'اضغط هنا للتواصل وإضافة إعلانك ←')
    );
    return box;
  }

  function renderAds() {
    [['home-ad', 'home_banner'], ['home-inline-ad', 'inline_card'],
     ['water-ad', 'inline_card'], ['pharmacy-ad', 'inline_card'],
     ['footer-ad', 'footer']].forEach(([id, placement]) => {
      const el = $(id);
      if (el) el.replaceChildren(adNode(placement));  
                                      });
    const list = $('ads-list');
    if (!list) return;
    list.replaceChildren();
    const all = state.ads.filter(row => validAd(row, row.placement));
    if (!all.length) { empty(list, 'لا توجد إعلانات فعالة حالياً.'); return; }
    all.forEach(row => {
      const card = create('article', 'item-card');
      card.append(create('h4', '', text(row.title)), create('p', '', text(row.description)));
      list.append(card);
    });
  }

  function renderAll() {
    fillNeighborhoodSelects();
    const neighborhood = currentNeighborhood();
    ['home-neighborhood', 'water-neighborhood', 'settings-neighborhood'].forEach(id => {
      if ($(id)) $(id).value = neighborhood;
    });
    renderWater($('home-water'), neighborhood);
    renderWater($('water-detail'), neighborhood);

    const homePharmacies = $('home-pharmacies');
    if (homePharmacies) {
      homePharmacies.replaceChildren();
      const today = state.pharmacyRows.filter(pharmacyNow).slice(0, 3);
      if (!today.length) empty(homePharmacies, 'لا توجد مناوبة مؤكدة حالياً بحسب البيانات المسجلة.');
      else today.forEach(row => homePharmacies.append(pharmacyCard(row)));
    }

    const contacts = $('home-emergency');
    if (contacts) {
      contacts.replaceChildren();
      state.emergencyRows.slice(0, 4).forEach(row => {
        const tel = phoneURL(row.phone);
        if (tel) {
          const a = create('a', '', text(row.name));
          a.href = tel;
          contacts.append(a);
        }
      });
      if (!contacts.childElementCount) empty(contacts, 'لا توجد أرقام مضافة.');
    }

    renderEmergency($('emergency-list'));
    renderPharmacies();

    const shortcuts = $('home-shortcuts');
    if (shortcuts) {
      shortcuts.replaceChildren();
      [['water', 'موعد المياه'], ['pharmacies', 'الصيدليات'],
       ['more', 'الأرقام المهمة'], ['more', 'الإعدادات']].forEach(([view, label], index) => {
        const button = create('button', '', label);
        button.type = 'button'; button.dataset.nav = view;
        if (index === 2) button.dataset.subview = 'emergency';
        if (index === 3) button.dataset.subview = 'settings';
        shortcuts.append(button);
      });
    }
    renderAds();
    if ($('footer-status')) {
      $('footer-status').textContent = state.lastRefresh
        ? آخر تحديث للبيانات: ${fmtDate(state.lastRefresh)}
        : 'لم يتم تحديث البيانات بعد';
    }
  }

  function showView(name) {
    state.activeView = name;
    document.querySelectorAll('.view').forEach(view =>
      view.classList.toggle('active', view.id === ${name}-view));
    document.querySelectorAll('[data-nav]').forEach(button =>
      button.classList.toggle('active', button.dataset.nav === name));
    window.scrollTo({
      top: 0,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    });
  }

  function showSubview(name) {
    state.activeSubview = name;
    document.querySelectorAll('.subview').forEach(view =>
      view.classList.toggle('active', view.id === ${name}-subview));
  }

  async function refresh({ silent = false } = {}) {
    if (!silent && $('status-bar')) $('status-bar').textContent = 'جارٍ تحديث المعلومات…';
    try {
      const raw = await fetchAll();
      const meaningful = Object.values(raw).some(rows => Array.isArray(rows) && rows.length);
      if (!meaningful) throw new Error('الشيتات فارغة');
      validateAndApply(raw);
      state.lastRefresh = Date.now();
      localStorage.setItem(CFG.CACHE_KEY, JSON.stringify({ savedAt: state.lastRefresh, data: raw }));
      if ($('status-bar')) $('status-bar').textContent = 'تم تحديث البيانات';
      trackVisit();
    } catch (error) {
      const cached = localStorage.getItem(CFG.CACHE_KEY);
      if (cached && !Object.keys(state.data).length) {  
      try {
          const parsed = JSON.parse(cached);
          if (Date.now() - parsed.savedAt < (CFG.MAX_CACHE_AGE_MS || 30 * 86400000)) {
            state.lastRefresh = parsed.savedAt;
            validateAndApply(parsed.data);
          }
        } catch (_) {}
      }
      if ($('status-bar')) {
        $('status-bar').textContent = Object.keys(state.data).length
          ? 'تعذر التحديث؛ تظهر آخر بيانات محفوظة.'
          : 'تعذر تحميل البيانات. تحقق من اتصال الإنترنت وإعداد مصدر البيانات.';
      }
      console.warn('Data refresh failed:', error);
    }
  }

  function trackVisit() {
    const userKey = CFG.USER_KEY || 'jeroud-services-user-v1';
    const visitKey = CFG.VISIT_KEY || 'jeroud-services-visit-v1';
    const id = localStorage.getItem(userKey)  (crypto.randomUUID?.()  ${Date.now()}-${Math.random()});
    localStorage.setItem(userKey, id);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: CFG.TIME_ZONE || 'Asia/Damascus' }).format(new Date());
    let previous = {};
    try { previous = JSON.parse(localStorage.getItem(visitKey) || '{}'); } catch (_) {}
    if (previous.day !== day) {
      localStorage.setItem(visitKey, JSON.stringify({ day }));
      sendStats({ visitor_id: id, day, kind: previous.day ? 'returning' : 'new' });
    }
    const sessionKey = 'jeroud-session';
    const session = sessionStorage.getItem(sessionKey)  (crypto.randomUUID?.()  String(Date.now()));
    if (!sessionStorage.getItem(sessionKey)) sessionStorage.setItem(sessionKey, session);
    if (previous.session_sent !== session) {
      let current = {};
      try { current = JSON.parse(localStorage.getItem(visitKey) || '{}'); } catch (_) {}
      current.session_sent = session;
      localStorage.setItem(visitKey, JSON.stringify(current));
      sendStats({ visitor_id: id, day, kind: 'open', session_id: session });
    }
  }

  function sendStats(payload) {
    const endpoint = text(state.settings.stats_endpoint);
    if (!endpoint || !escapeURL(endpoint)) return;
    try {
      fetch(endpoint, {
        method: 'POST', mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload), keepalive: true
      }).catch(() => {});
    } catch (_) {}
  }

  function setupInstall() {
    const dialog = $('install-dialog');
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (standalone) {
      if ($('install-settings')) {
        $('install-settings').textContent = 'التطبيق مثبت على جهازك';
        $('install-settings').disabled = true;
      }
      return;
    }
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      state.deferredInstall = event;
    });
    window.addEventListener('appinstalled', () => {
      state.deferredInstall = null;
      localStorage.setItem('jeroud-installed', '1');
      if (dialog?.open) dialog.close();
      if ($('install-settings')) $('install-settings').textContent = 'تمت إضافة التطبيق';
    });
    if ($('install-accept')) $('install-accept').addEventListener('click', async () => {
      if (state.deferredInstall) {
        const prompt = state.deferredInstall;
        state.deferredInstall = null;
        dialog?.close();
        await prompt.prompt();
        const result = await prompt.userChoice;
        if (result?.outcome === 'accepted') localStorage.setItem('jeroud-installed', '1');
        return;
      }
      const ua = navigator.userAgent;
      const steps = $('install-steps');
      if (!steps) return;
      steps.replaceChildren();
      let items;
      if (/iphone|ipad|ipod/i.test(ua)) items = ['اضغط زر المشاركة في Safari.', 'اختر «إضافة إلى الشاشة الرئيسية».', 'اضغط «إضافة» للتأكيد.'];
      else if (/android/i.test(ua)) items = ['افتح قائمة Chrome (⋮) أعلى المتصفح.', 'اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».', 'اتبع رسالة التأكيد التي تظهر.'];  
                                                                  else items = ['افتح قائمة المتصفح (⋮) بجانب شريط العنوان.', 'اختر «تثبيت خدمات جيرود» أو «Install app».', 'أكد التثبيت في النافذة التي تظهر.'];
      items.forEach(item => { const li = document.createElement('li'); li.textContent = item; steps.append(li); });
      steps.hidden = false;
      if ($('install-copy')) $('install-copy').textContent = 'اتبع الخطوات التالية حسب نوع جهازك. إذا لم يظهر خيار التثبيت، جرّب Chrome أو حدّث الصفحة بعد قليل.';
    });
    if ($('install-dismiss')) $('install-dismiss').addEventListener('click', () => dialog?.close());
    if ($('install-settings')) $('install-settings').addEventListener('click', () => {
      if (dialog && !dialog.open) {
        if ($('install-steps')) $('install-steps').hidden = true;
        if ($('install-copy')) $('install-copy').textContent = 'أضف التطبيق إلى الشاشة الرئيسية للوصول إليه بسرعة.';
        dialog.showModal();
      }
    });
  }

  function setupTheme() {
    const select = $('theme-select');
    const saved = localStorage.getItem('jeroud-theme') || 'dark';
    if (select) {
      select.value = saved;
      applyTheme(saved);
      select.addEventListener('change', () => {
        localStorage.setItem('jeroud-theme', select.value);
        applyTheme(select.value);
      });
    } else applyTheme(saved);
  }

  function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === 'system') {
      root.removeAttribute('data-theme');
      ['--bg', '--surface', '--text', '--muted', '--line', '--warning'].forEach(v => root.style.removeProperty(v));
    } else {
      root.setAttribute('data-theme', theme);
      ['--bg', '--surface', '--text', '--muted', '--line', '--warning'].forEach(v => root.style.removeProperty(v));
    }
  }

  function openAdContact() {
    let whatsapp = String(state.settings.ads_whatsapp || '').replace(/\D/g, '');
    if (/^09\d{8}$/.test(whatsapp)) whatsapp = 963${whatsapp.slice(1)};
    if (!/^[0-9]{8,15}$/.test(whatsapp)) {
      if ($('status-bar')) $('status-bar').textContent = 'رقم واتساب الإعلانات غير متاح حالياً.';
      return;
    }
    const url = https://wa.me/${whatsapp}?text=${encodeURIComponent('مرحباً، أريد الإعلان في تطبيق خدمات جيرود.')};
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) window.location.href = url;
  }

  function setupEvents() {
    document.addEventListener('click', event => {
      const ad = event.target.closest('.ad-placeholder');
      if (ad) { event.preventDefault(); openAdContact(); return; }
      const nav = event.target.closest('[data-nav]');
      if (nav) { showView(nav.dataset.nav); return; }
      const sub = event.target.closest('[data-subview]');
      if (sub) showSubview(sub.dataset.subview);
    });

    ['home-neighborhood', 'water-neighborhood', 'settings-neighborhood'].forEach(id => {
      if (!$(id)) return;
      $(id).addEventListener('change', event => {
        localStorage.setItem('jeroud-neighborhood', event.target.value);
        renderWater($('home-water'), event.target.value);
        renderWater($('water-detail'), event.target.value);
        ['home-neighborhood', 'water-neighborhood', 'settings-neighborhood'].forEach(other => {
          if ($(other)) $(other).value = event.target.value;
        });
      });
    });

    if ($('pharmacy-search')) $('pharmacy-search').addEventListener('input', renderPharmacies);
    if ($('pharmacy-type')) $('pharmacy-type').addEventListener('change', renderPharmacies);
    if ($('refresh-button')) $('refresh-button').addEventListener('click', () => refresh());
    if ($('clear-cache')) $('clear-cache').addEventListener('click', () => {
      localStorage.removeItem(CFG.CACHE_KEY);
      if ($('status-bar')) $('status-bar').textContent = 'تم مسح البيانات المحفوظة من هذا الجهاز.';
    });  
let touchStart = 0;
    document.addEventListener('touchstart', event => {
      if (window.scrollY === 0) touchStart = event.touches[0].clientY;
    }, { passive: true });
    document.addEventListener('touchend', event => {
      const delta = event.changedTouches[0].clientY - touchStart;
      if (touchStart > 0 && delta > 110 && window.scrollY === 0) refresh({ silent: true });
      touchStart = 0;
    }, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Date.now() - state.lastRefresh > (CFG.REFRESH_INTERVAL_MS || 300000)) refresh({ silent: true });
    });
  }

  function setupServiceWorker() {
    if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
    navigator.serviceWorker.register('./sw.js').then(registration => {
      state.swRegistration = registration;
      if (registration.waiting && $('update-banner')) $('update-banner').hidden = false;
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (worker) worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller && $('update-banner')) {
            $('update-banner').hidden = false;
          }
        });
      });
    }).catch(error => console.warn('Service worker registration failed:', error));

    if ($('update-button')) $('update-button').addEventListener('click', () => {
      const waiting = state.swRegistration?.waiting;
      if (waiting) {
        waiting.postMessage({ type: 'SKIP_WAITING' });
        navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
      }
    });
  }

  async function init() {
    setupEvents();
    setupTheme();
    setupInstall();
    setupServiceWorker();

    try {
      const cached = localStorage.getItem(CFG.CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.savedAt < (CFG.MAX_CACHE_AGE_MS || 30 * 86400000)) {
          state.lastRefresh = parsed.savedAt;
          validateAndApply(parsed.data);
          if ($('status-bar')) $('status-bar').textContent = 'تظهر آخر بيانات محفوظة؛ جارٍ التحقق من التحديث.';
        }
      }
    } catch (error) {
      console.warn('Cached data could not be read:', error);
    }

    await refresh({ silent: true });
    const intervalSeconds = Math.max(60, Number(state.settings.refresh_interval)  (CFG.REFRESH_INTERVAL_MS  300000) / 1000);
    setInterval(() => refresh({ silent: true }), intervalSeconds * 1000);
  }

  init().catch(error => {
    console.error('Application startup failed:', error);
    if ($('status-bar')) $('status-bar').textContent = 'حدث خطأ أثناء تشغيل التطبيق. حاول تحديث الصفحة.';
  });
})();

// MTI jacuzzi tracking board. Sign-in with Google, a role per email, one card per order moving through the stations.
(function () {
  var APP_VERSION = '20261112-095700';
  var auth = firebase.auth(), db = firebase.firestore();

  // Stage targets are working days (Sun–Thu). Loading and arrival are recorded by scanning the QR stickers,
  // so most stages close on their own; the buttons stay for when there is no sticker.
  // `roles` = who may press the button that completes the stage (admin always may).
  var J_STAGES = [
    { k: 'drawing',    n: 'שרטוט',                 loc: 'a1',   who: 'משרד',        roles: ['office'],                        t: 1, done: 'השרטוט נשלח ללקוח' },
    { k: 'approval',   n: 'ממתין לאישור לקוח',    loc: 'a1',   who: 'משרד',        roles: ['office'],                        t: 3, done: 'הלקוח אישר את השרטוט' },
    { k: 'kit',        n: 'קיט בהכנה',            loc: 'a1',   who: 'מחסן אשדוד',  roles: ['warehouse'],                     t: 1, done: 'הקיט מוכן והועמס לברקן' },
    { k: 'toBarkan',   n: 'בדרך לברקן',           loc: 'road', who: 'מנהל ברקן',   roles: ['barkan', 'driver'],              t: 1, done: 'התקבל בברקן' },
    { k: 'fitting',    n: 'באיבזור בברקן',        loc: 'bk',   who: 'מנהל ברקן',   roles: ['barkan'],                        t: 4, done: 'האיבזור הסתיים' },
    { k: 'loadBk',     n: 'מוכן להעמסה בברקן',     loc: 'bk',   who: 'מנהל ברקן',   roles: ['barkan', 'driver'],              t: 1, done: 'הועמס על המשאית לאשדוד' },
    { k: 'toAshdod',   n: 'בדרך חזרה לאשדוד',     loc: 'road', who: 'מחסן אשדוד',  roles: ['warehouse', 'driver'],           t: 1, done: 'התקבל באשדוד' },
    { k: 'inspect',    n: 'בדיקה ואריזה',         loc: 'a2',   who: 'מחסן אשדוד',  roles: ['warehouse'],                     t: 1, done: 'נבדק ונארז' },
    { k: 'ready',      n: 'מוכן לאספקה',          loc: 'a2',   who: 'נהגים',       roles: ['driver', 'warehouse', 'office'], t: 2, done: 'סופק ללקוח' },
    { k: 'delivered',  n: 'סופק',                 loc: 'done', who: '',            roles: [],                                t: 0, done: '' }
  ];
  // stages that were merged on 12 Nov 2026: an order still standing on one is read as standing on the merged stage
  var SCAN_HINT = {
    kit: 'עובר לבד כשהנהג סורק את מדבקת הקיט בעלייה למשאית.',
    toBarkan: 'עובר לאיבזור כשבברקן סורקים את מדבקת האמבטיה ואת מדבקת הקיט.',
    loadBk: 'עובר לבד כשהנהג סורק את מדבקת האמבטיה בעלייה למשאית.',
    toAshdod: 'עובר לבדיקה כשבאשדוד סורקים את מדבקת האמבטיה בירידה מהמשאית.'
  };
  var J_OLD = { request: 'drawing', kitOrder: 'kit', waitBarkan: 'fitting', pack: 'inspect' };
  var J_OLD_N = { request: 'בקשת אספקה', kitOrder: 'הזמנת קיט למחסן', waitBarkan: 'ממתין לאיבזור בברקן', pack: 'אריזה מחדש' };
  // Spa and swim spa: the 15 stations of the older spa system. Kobi (an admin) signs off the technical review.
  // Cladding is skipped unless the spa stands above ground; "kit sent to Barkan" is skipped when fitting is done in Ashdod.
  var S_STAGES = [
    { k: 'draft',     n: 'טיוטת מכירה',          loc: 'a1',   who: 'משרד',          roles: ['office'],                t: 2, done: 'המפרט מוכן, לבדיקה טכנית' },
    { k: 'tech',      n: 'בדיקה טכנית',          loc: 'a1',   who: 'קובי',          roles: [],                        t: 2, done: 'הבדיקה הטכנית אושרה' },
    { k: 'kitList',   n: 'הכנת קיט',             loc: 'a1',   who: 'משרד',          roles: ['office'],                t: 1, done: 'רשימת הקיט הועברה לליקוט' },
    { k: 'picking',   n: 'ליקוט',                loc: 'a1',   who: 'מחסן אשדוד',    roles: ['warehouse'],             t: 1, done: 'הליקוט הסתיים' },
    { k: 'kitSent',   n: 'קיט נשלח לברקן',       loc: 'a1',   who: 'מחסן אשדוד',    roles: ['warehouse'],             t: 1, done: 'הקיט נשלח לברקן' },
    { k: 'shell',     n: 'קליפה',                loc: 'bk',   who: 'מנהל ברקן',     roles: ['barkan'],                t: 3, done: 'הקליפה מוכנה' },
    { k: 'frame',     n: 'גישטל',                loc: 'bk',   who: 'מנהל ברקן',     roles: ['barkan'],                t: 2, done: 'הגישטל מוכן' },
    { k: 'drill',     n: 'קדיחה ושפשוף',         loc: 'bk',   who: 'מנהל ברקן',     roles: ['barkan'],                t: 1, done: 'הקדיחה והשפשוף הסתיימו' },
    { k: 'cladding',  n: 'חיפוי',                loc: 'bk',   who: 'מנהל ברקן',     roles: ['barkan'],                t: 1, done: 'החיפוי הסתיים' },
    { k: 'equip',     n: 'איבזור',               loc: 'bk',   who: 'מנהל ברקן',     roles: ['barkan', 'warehouse'],   t: 2, done: 'האיבזור הסתיים' },
    { k: 'test',      n: 'טסט, ניקיון ואריזה',   loc: 'a2',   who: 'מחסן אשדוד',    roles: ['warehouse'],             t: 1, done: 'עבר טסט, נוקה ונארז' },
    { k: 'ready',     n: 'מוכן למשלוח',          loc: 'a2',   who: 'מחסן אשדוד',    roles: ['warehouse', 'office'],   t: 1, done: 'הועבר לאישור תשלום' },
    { k: 'payment',   n: 'אישור תשלום',          loc: 'a2',   who: 'הנהלת חשבונות', roles: ['office'],                t: 2, done: 'התשלום אושר' },
    { k: 'awaiting',  n: 'ממתין למסירה',         loc: 'a2',   who: 'משרד',          roles: ['office', 'driver'],      t: 3, done: 'נמסר ללקוח' },
    { k: 'delivered', n: 'נמסר',                 loc: 'done', who: '',              roles: [],                        t: 0, done: '' }
  ];
  var S_LOCS = [
    { k: 'a1', n: 'אשדוד · מכירה וקיט',  c: 'var(--ashdod)' },
    { k: 'bk', n: 'ברקן · ייצור',        c: 'var(--barkan)' },
    { k: 'a2', n: 'אשדוד · טסט ומסירה',  c: 'var(--back)' }
  ];
  var J_LOCS = [
    { k: 'a1',   n: 'אשדוד · הכנה',           c: 'var(--ashdod)' },
    { k: 'road', n: 'בדרך במשאית',            c: 'var(--road)' },
    { k: 'bk',   n: 'ברקן',                   c: 'var(--barkan)' },
    { k: 'a2',   n: 'אשדוד · בדיקה ואספקה',   c: 'var(--back)' }
  ];
  // the two trackers. kitStage: where the office builds the kit list; kitFrom..kitTo: where the frozen list is shown.
  var TRACK = {
    jacuzzi: { stages: J_STAGES, locs: J_LOCS, kitStage: 'kit', kitFrom: 'toBarkan', kitTo: 'fitting', word: "ג'קוזי" },
    spa:     { stages: S_STAGES, locs: S_LOCS, kitStage: 'kitList', kitFrom: 'picking', kitTo: 'equip', word: 'ספא' }
  };
  var TR, STAGES, IDX, LOCS;
  function useTrack(k) { TR = TRACK[k] || TRACK.jacuzzi; STAGES = TR.stages; LOCS = TR.locs; IDX = {}; STAGES.forEach(function (s, i) { IDX[s.k] = i; }); }
  useTrack('jacuzzi');
  var LOCC = { a1: 'var(--ashdod)', a2: 'var(--back)', bk: 'var(--barkan)', road: 'var(--road)', done: 'var(--ok)' };
  var ROLES = { admin: 'מנהל', office: 'משרד', warehouse: 'מחסן אשדוד', barkan: 'מנהל ברקן', driver: 'נהג', agent: 'סוכן' };
  // Field agents by name. An agent who should sign in and see only their own orders is also added under Users
  // with the role 'agent' and exactly the same name; new orders are then linked to that account.
  var AGENTS = ['רונן', 'מתן', 'יניב', 'אסתר'];
  // home jacuzzi add-ons, as in the digital catalog (catalog codes, not ERP item numbers); pictures in img/addons
  var ADD = {
    taps: [['S-41', 'אינטרפוץ 3 דרך'], ['S-42', 'אינטרפוץ 3 דרך (2 חלקים)'], ['S-43', 'אינטרפוץ 4 דרך (3 חלקים)'], ['S-44', 'אינטרפוץ 4 דרך (4 חלקים)']],
    tapFin: [['nickel', 'ניקל'], ['gold', 'זהב'], ['white', 'לבן מט'], ['black', 'שחור מט']],
    // only pillows on brackets are fitted; the vacuum pillows are not offered here
    pillows: [['S-28', 'עם תושבות'], ['S-29', 'עם תושבות'], ['S-113', 'עם תושבות'], ['S-136', 'עם תושבות']],
    pillowColors: [['black', 'שחור'], ['white', 'לבן']],
    waste: [['chrome', 'כרום / ניקל'], ['bronze_red', 'ברונזה אדומה (רוז גולד)'], ['bronze_old', 'ברונזה עתיק (זהב מט)'], ['graphite', 'גרפיט'], ['white_gloss', 'לבן מבריק'], ['white_mat', 'לבן מט'], ['nickel_brushed', 'ניקל מוברש'], ['black_mat', 'שחור מט']]
  };
  function tapImg(code, fin) { return 'img/addons/' + code + '-' + (fin || 'nickel') + '.jpg'; }
  // the add-on lines of a home jacuzzi order, for the card, the kit and the fitter's sheet
  // the pillow is not a kit part (it goes straight to the fitter); pass noPillow for the kit
  function addonLines(o, noPillow) {
    var out = [], t = pick(ADD.taps, o.tap), pl = noPillow ? '' : pick(ADD.pillows, o.pillow);
    if (t) out.push({ n: 'סט ברזים ' + o.tap + ' ' + t + ' · ' + (pick(ADD.tapFin, o.tapFin) || 'ניקל'), q: 1, sku: '' });
    if (pl) out.push({ n: 'כרית ראש ' + o.pillow + ' ' + pl + (o.pillowColor ? ' · ' + pick(ADD.pillowColors, o.pillowColor) : ''), q: o.pillowQty || 1, sku: '' });
    return out;
  }
  var HOLDS = ['חסר חלק', 'ממתין ללקוח', 'תקלה באמבטיה'];
  var DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
  var MODELS = window.MTI_MODELS || [], MODEL = {}; MODELS.forEach(function (m) { MODEL[m.code] = m; });
  // what to show for a stored model code: the model name, plus the size when the model comes in more than one
  var SPA = window.MTI_SPA || { models: [] }, SPA_MODEL = {}; SPA.models.forEach(function (m) { SPA_MODEL[m.id] = m; });
  function pick(list, id) { var x = (list || []).find(function (p) { return p[0] === id; }); return x ? x[1] : ''; }
  // the drawing model of a spa: size from the catalog dimensions, the top view from img/spa when there is one
  var SPA_IMG = ['30101', '30200', '30250', '30330', '30401', '30440', '30501', '30570', '30740', '30801', '31101', '31201', '32000', '32034', '32100', '33000', '34300', '34500', '361301'];
  function spaDrawModel(id) {
    var m = SPA_MODEL[id]; if (!m) return null;
    var n = (m.dims.match(/\d+/g) || ['200']).map(Number), w = n[0], h = n[1] || n[0], round = /קוטר/.test(m.dims);
    return { code: id, name: m.name, dims: m.dims, w: w, h: h, shape: round ? 'round' : 'rect', src: SPA_IMG.indexOf(id) > -1 ? 'img/spa/' + id + '.jpg' : null };
  }
  function drawModel(o) { return kindOf(o) === 'spa' ? spaDrawModel(o.model) : MODEL[o.model] || null; }
  // right- or left-handed tub (asymmetric models only): from the drawing
  function sideOf(o) { var m = kindOf(o) === 'jacuzzi' && MODEL[o.model]; if (!m || !m.sides) return ''; var sd = o.sketch && o.sketch.side; return sd === 'R' ? 'ימין' : sd === 'L' ? 'שמאל' : 'צד לא נבחר'; }
  function sideTxt(o) { var sd = sideOf(o); return !sd ? '' : sd === 'צד לא נבחר' ? sd : 'צד ' + sd; }
  function omodel(o) { var sd = sideTxt(o); return mname(o.model) + (sd ? ' · ' + sd : ''); }
  function kindOf(o) { return o && o.kind === 'spa' ? 'spa' : 'jacuzzi'; }
  // stations a given order skips, and where an order stands (fitting in Ashdod counts as Ashdod)
  function skips(s, o) { return kindOf(o) === 'spa' && ((s.k === 'cladding' && o.install && o.install !== 'above') || (s.k === 'kitSent' && o.equipLoc === 'ashdod')); }
  function nextStage(o) { for (var j = IDX[o.stage] + 1; j < STAGES.length; j++) if (!skips(STAGES[j], o)) return STAGES[j]; return null; }
  // a tub Barkan says it did not get puts the order back on Ashdod's side until Ashdod marks it sent
  function locOf(s, o) { if (s.k === o.stage && missOpen(o) && !tubSent(o)) return 'a1'; return s.k === 'equip' && o.equipLoc === 'ashdod' ? 'a2' : s.loc; }
  function mname(code) { var sm = SPA_MODEL[code]; if (sm) return sm.name + ' · ' + sm.dims; var m = MODEL[code]; return !m ? (code || '') : m.name ? m.name + ' (' + m.dims + ')' : m.code; }

  var me = null, col = db.collection('orders'), usersCol = db.collection('users'), apCol = db.collection('approvals'), unsub = [], users = [];
  // Serial numbers run on their own: meta/counters.serial holds the next one to hand out.
  var counterRef = db.collection('meta').doc('counters'), FIRST_SERIAL = 9694;
  function pad4(n) { n = String(n); while (n.length < 4) n = '0' + n; return n; }
  var TOKEN = new URLSearchParams(location.search).get('a'), CUST_PAGE = /\/s\.html$/.test(location.pathname);
  // never hand out a serial that an existing order already carries (covers orders numbered before the counter existed, or by hand)
  function serialFloor() { var m = FIRST_SERIAL; st.all.filter(function (o) { return kindOf(o) === 'jacuzzi'; }).forEach(function (o) { var n = parseInt(o.tubNum, 10); if (n >= m && n < 100000) m = n + 1; }); return m; }
  function showSerial() { var el = $('nTub'); if (el && st.kind === 'jacuzzi' && !el.dataset.manual) el.value = pad4(Math.max(st.nextSerial, serialFloor())); }
  var st = { all: [], orders: [], editId: null, loaded: false, err: '', loc: '', q: '', agent: '', tab: 'open', openId: null, holdFor: null, form: false, usersOpen: false, armed: {}, busy: {}, appr: {}, nextSerial: FIRST_SERIAL };

  function $(id) { return document.getElementById(id); }
  // two trackers on one site: home jacuzzi and spa. The choice is remembered on this computer only.
  try { st.kind = localStorage.getItem('mtiKind') === 'spa' ? 'spa' : 'jacuzzi'; } catch (e) { st.kind = 'jacuzzi'; }
  function pickOrders() { st.orders = st.all.filter(function (o) { return kindOf(o) === st.kind; }); }
  function applyKind() {
    useTrack(st.kind); pickOrders();
    document.querySelectorAll('.kind').forEach(function (b) { var on = b.dataset.kind === st.kind; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  }
  document.querySelector('.kinds').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-kind]'); if (!b || b.dataset.kind === st.kind) return;
    st.kind = b.dataset.kind; try { localStorage.setItem('mtiKind', st.kind); } catch (e) {}
    st.form = false; st.editId = null; st.openId = null; st.loc = ''; st.stageF = ''; st.tab = 'open'; $('form').innerHTML = '';
    applyKind(); render();
  });
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmt(iso) { var d = new Date(iso); if (isNaN(d)) return ''; return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function isWork(d) { return d.getDay() <= 4; }
  function workDays(fromIso, to) {
    var a = new Date(fromIso); if (isNaN(a)) return 0;
    var d = new Date(a.getFullYear(), a.getMonth(), a.getDate()), end = new Date(to.getFullYear(), to.getMonth(), to.getDate()), n = 0, g = 0;
    while (d < end && g++ < 400) { d.setDate(d.getDate() + 1); if (isWork(d)) n++; }
    return n;
  }
  function addWork(from, n) { var d = new Date(from.getFullYear(), from.getMonth(), from.getDate()), g = 0; while (n > 0 && g++ < 400) { d.setDate(d.getDate() + 1); if (isWork(d)) n--; } while (!isWork(d) && g++ < 400) d.setDate(d.getDate() + 1); return d; }
  function info(o, now) {
    var i = IDX[o.stage], unknown = i == null; if (unknown) i = 0; // a stage this screen does not know: it is running an older version
    var s = unknown ? { k: o.stage, n: 'שלב חדש, צריך לרענן את הדף', loc: 'a1', who: '', roles: [], t: 99, done: '' } : STAGES[i], el = workDays(o.stageAt, now), late = s.k !== 'delivered' && el > s.t, rem = Math.max(0, s.t - el);
    for (var j = i + 1; j < STAGES.length; j++) if (!skips(STAGES[j], o)) rem += STAGES[j].t;
    return { i: i, s: s, loc: locOf(s, o), el: el, late: late, over: el - s.t, eta: addWork(now, rem), hold: !!(o.hold && o.hold.reason), unknown: unknown };
  }
  function dayWord(n) { return n === 0 ? 'מהיום' : n === 1 ? 'יום עבודה אחד' : n + ' ימי עבודה'; }

  // ---------- permissions (screen level; the database rules are the coarse backstop) ----------
  function isAdmin() { return me && me.role === 'admin'; }
  function isOffice() { return me && (me.role === 'admin' || me.role === 'office'); }
  function canWrite() { return me && me.role !== 'agent'; }
  function canAct(stage) { return isAdmin() || (me && stage.roles.indexOf(me.role) > -1); }
  // jacuzzi: drawn until the customer approves; spa: until the technical review is signed off
  function canDraw(o) { return isOffice() && IDX[o.stage] <= (kindOf(o) === 'spa' ? IDX.tech : IDX.approval); }

  // ---------- staying up to date ----------
  // version.json changes with every update of the site. A screen left open notices it and reloads itself when nothing is
  // being typed or drawn; otherwise it shows a bar with a button.
  var newVersion = null;
  function hardReload() { location.replace(location.pathname + '?r=' + encodeURIComponent(newVersion || Date.now()) + (TOKEN ? '&a=' + TOKEN : '')); }
  function busyNow() { var a = document.activeElement, tag = a && a.tagName; return st.form || st.editId || st.usersOpen || !$('sketchView').hidden || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'; }
  function checkVersion() {
    fetch('version.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !j.v || j.v === APP_VERSION) return;
      newVersion = j.v;
      var tried = null; try { tried = sessionStorage.getItem('reloadedFor'); } catch (e) {}
      if (!busyNow() && tried !== j.v) { try { sessionStorage.setItem('reloadedFor', j.v); } catch (e) {} hardReload(); return; }
      var bar = $('updateBar'); if (bar) bar.hidden = false;
    }).catch(function () {});
  }
  if (!TOKEN && !CUST_PAGE) { setTimeout(checkVersion, 4000); setInterval(checkVersion, 180000); document.addEventListener('visibilitychange', function () { if (!document.hidden) checkVersion(); }); }

  // ---------- customer link ----------
  // The customer opens index.html?a=<token> without signing in, sees the drawing and approves it or sends a note.
  // approvals/<token> holds a copy of the drawing; the token is the only key to it.
  function newToken() { var a = new Uint8Array(16); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join(''); }
  // The customer's link goes to s.html, a copy of the page whose title (what WhatsApp shows in the link preview) is about approving the sketch.
  function custLink(o) { return location.origin + location.pathname.replace(/[^\/]*$/, '') + 's.html?a=' + o.approvalToken; }
  function intlPhone(p) { var d = String(p || '').replace(/\D/g, ''); if (d.indexOf('972') === 0) return d; if (d.charAt(0) === '0') return '972' + d.slice(1); return d; }
  // card title: the store first, then the end customer ("קרמיק דיפו - שמעון")
  // a spa is mostly sold to private customers: the customer first, the store (if any) in brackets
  function titleOf(o) { if (kindOf(o) === 'spa') return (o.customer || o.store || (o.num ? 'הזמנה ' + o.num : 'ללא שם')) + (o.customer && o.store ? ' (' + o.store + ')' : ''); return [o.store, o.customer].filter(Boolean).join(' - ') || (o.num ? 'הזמנה ' + o.num : 'ללא שם'); }
  function custMessage(o) { return 'שלום' + (o.customer ? ' ' + o.customer : '') + ', כאן MTI. מצורפת סקיצת הג\'קוזי שהזמנת' + (o.model ? ' (' + (MODEL[o.model] && MODEL[o.model].name || o.model) + ')' : '') + '. נא לבדוק את הקירות, פריסת הג\'טים ופתח השירות, ולאשר בקישור:\n' + custLink(o); }
  async function customerMode() {
    ['loginView', 'noAccessView', 'appView'].forEach(function (v) { $(v).hidden = true; });
    $('custView').hidden = false; document.title = 'MTI · אישור סקיצה לג\'קוזי';
    function msg(s) { $('custMsg').hidden = false; $('custMsg').textContent = s; $('custSub').textContent = ''; }
    if (!/^[a-f0-9]{32}$/.test(TOKEN)) { msg('הקישור אינו תקף. אפשר לבקש מ-MTI קישור חדש.'); return; }
    var ref = apCol.doc(TOKEN), d;
    try { var snap = await ref.get(); d = snap.exists ? snap.data() : null; } catch (e) { msg('לא הצלחנו לטעון את הסקיצה. בדקו את החיבור ונסו שוב.'); return; }
    var model = d && MODEL[d.model];
    if (!d || !model || !d.sketch) { msg('הקישור אינו תקף. אפשר לבקש מ-MTI קישור חדש.'); return; }
    if (d.status === 'draft') { msg('הסקיצה עדיין בהכנה. נשלח קישור כשתהיה מוכנה.'); return; }
    $('custSub').textContent = [d.customer, (model.name || model.code) + ' · ' + model.dims + ' ס"מ', d.system].filter(Boolean).join(' · ');
    Sketch.open($('custSketch'), { model: model, system: d.system, data: d.sketch, readOnly: true, customer: true,
      readOnlyNote: 'בדקו את הקירות, פריסת הג\'טים ופתח השירות.' });
    var box = $('custApprove'); box.hidden = false;
    function done(status, name, at) {
      box.innerHTML = status === 'approved'
        ? '<div class="stamp">הסקיצה אושרה' + (name ? ' על ידי ' + esc(name) : '') + (at ? ' · ' + fmt(at) : '') + '<br>תודה! מתחילים בהכנה.</div>'
        : '<div class="issue warn">ההערה שלך התקבלה. נעדכן את הסקיצה ונשלח קישור חדש.</div>';
    }
    if (d.status !== 'pending') { done(d.status, d.answeredName, d.answeredAt); return; }
    box.innerHTML = '<h2 style="margin:0">אישור הסקיצה</h2><div>אחרי האישור מתחילים בהכנת הג\'קוזי לפי הסקיצה הזו.</div>' +
      '<label class="f" for="cName">שם המאשר/ת<input id="cName" autocomplete="name"></label>' +
      '<button class="btn primary big" type="button" id="cOk">אני מאשר/ת את הסקיצה</button>' +
      '<label class="f" for="cNote">משהו לא נכון? כתבו מה צריך לשנות<textarea id="cNote" rows="3"></textarea></label>' +
      '<button class="btn" type="button" id="cChange">שליחת בקשה לשינוי</button><div id="cErr" style="color:var(--bad)"></div>';
    $('cName').value = d.customer || '';
    async function answer(status) {
      var name = $('cName').value.trim().slice(0, 80), note = $('cNote').value.trim().slice(0, 1000), at = new Date().toISOString();
      if (status === 'approved' && !name) { $('cErr').textContent = 'נא לכתוב את שם המאשר/ת.'; return; }
      if (status === 'changes' && !note) { $('cErr').textContent = 'נא לכתוב מה צריך לשנות.'; return; }
      $('cOk').disabled = $('cChange').disabled = true;
      try { await ref.update({ status: status, answeredAt: at, answeredName: name, comment: status === 'changes' ? note : '' }); done(status, name, at); }
      catch (e) { $('cOk').disabled = $('cChange').disabled = false; $('cErr').textContent = 'השליחה לא הצליחה. ייתכן שהסקיצה כבר אושרה או השתנתה. רעננו את הדף ונסו שוב.'; }
    }
    $('cOk').addEventListener('click', function () { answer('approved'); });
    $('cChange').addEventListener('click', function () { answer('changes'); });
  }
  if (TOKEN || CUST_PAGE) { customerMode(); return; }

  // ---------- sign-in ----------
  function show(view) { ['loginView', 'noAccessView', 'appView'].forEach(function (v) { $(v).hidden = v !== view; }); }
  $('loginBtn').addEventListener('click', async function () {
    $('loginErr').textContent = '';
    var provider = new firebase.auth.GoogleAuthProvider(); provider.setCustomParameters({ prompt: 'select_account' });
    try { await auth.signInWithPopup(provider); }
    catch (e) {
      if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) { try { await auth.signInWithRedirect(provider); return; } catch (e2) {} }
      if (e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')) return;
      $('loginErr').textContent = 'הכניסה לא הצליחה. נסו שוב.';
    }
  });
  function logout() { unsub.forEach(function (u) { u(); }); unsub = []; me = null; auth.signOut(); }
  $('scanBtn').addEventListener('click', function () { openScanner(); });
  $('logoutBtn').addEventListener('click', logout); $('logoutBtn2').addEventListener('click', logout);

  auth.onAuthStateChanged(async function (u) {
    unsub.forEach(function (x) { x(); }); unsub = []; me = null;
    if (!u) { show('loginView'); return; }
    var email = (u.email || '').toLowerCase(), ref = usersCol.doc(email);
    try {
      var snap = await ref.get();
      if (!snap.exists) {
        // First sign-in of the owner creates their admin record; the rules refuse this for everyone else.
        await ref.set({ role: 'admin', name: u.displayName || '', createdAt: new Date().toISOString() });
        snap = await ref.get();
      }
      me = Object.assign({ email: email }, snap.data());
    } catch (e) { $('noAccessEmail').textContent = email; show('noAccessView'); return; }
    if (!ROLES[me.role]) { $('noAccessEmail').textContent = email; show('noAccessView'); return; }
    start();
  });

  function start() {
    st.loaded = false; st.err = ''; st.orders = []; st.all = [];
    show('appView');
    $('whoami').textContent = (me.name || me.email) + ' · ' + ROLES[me.role];
    var q = me.role === 'agent' ? col.where('agentEmail', '==', me.email) : col;
    unsub.push(q.onSnapshot(function (snap) {
      st.loaded = true; st.all = snap.docs.map(function (d) { var o = Object.assign({}, d.data()); o.id = d.id; if (kindOf(o) === 'jacuzzi' && J_OLD[o.stage]) { var ns = J_OLD[o.stage]; if (isOffice()) col.doc(o.id).update({ stage: ns }).catch(function () {}); o.stage = ns; } return o; }); pickOrders(); render();
      if (SCAN_ARG && !st.scanDone) { st.scanDone = true; try { history.replaceState(null, '', location.pathname); } catch (e) {} handleScan(SCAN_ARG); }
    }, function () { st.err = 'לא הצלחנו לטעון את ההזמנות. בדקו את החיבור ופתחו שוב.'; render(); }));
    if (me.role !== 'agent') unsub.push(apCol.where('status', 'in', ['approved', 'changes']).onSnapshot(function (snap) {
      st.appr = {}; snap.docs.forEach(function (d) { var a = d.data(); a.token = d.id; if (a.orderId) st.appr[a.orderId] = a; });
      if (isOffice()) snap.docs.forEach(function (d) { var a = d.data(); if (a.status === 'approved' && a.orderId) autoApprove(a.orderId, d.id, a); });
      render();
    }, function () {}));
    if (isOffice()) unsub.push(counterRef.onSnapshot(function (s) { var d = s.exists ? s.data() : null; st.nextSerial = d && d.serial ? d.serial : FIRST_SERIAL; showSerial(); }, function () {}));
    if (isOffice()) unsub.push(usersCol.onSnapshot(function (snap) { users = snap.docs.map(function (d) { return Object.assign({ email: d.id }, d.data()); }); st.usersDirty = true; render(); }, function () {}));
    render();
  }

  // ---------- rendering ----------
  function visible(now) {
    var q = st.q.trim().toLowerCase();
    return st.orders.filter(function (o) {
      var del = o.stage === 'delivered';
      if (st.tab === 'open' ? del : !del) return false;
      if (st.loc && locOf(STAGES[IDX[o.stage] || 0], o) !== st.loc) return false;
      if (st.agent && (o.agent || '') !== st.agent) return false;
      if (st.stageF && o.stage !== st.stageF) return false;
      if (q && [o.customer, o.num, o.tubNum, o.model, o.agent, o.store].join(' ').toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).map(function (o) { return { o: o, f: info(o, now) }; }).sort(function (a, b) {
      if (st.tab !== 'open') return String(b.o.stageAt).localeCompare(String(a.o.stageAt));
      return (b.f.hold - a.f.hold) || (b.f.late - a.f.late) || (b.f.over - a.f.over) || (b.f.i - a.f.i);
    });
  }
  function renderTiles(now) {
    var open = st.orders.filter(function (o) { return o.stage !== 'delivered'; });
    $('tiles').style.gridTemplateColumns = LOCS.length === 3 ? 'repeat(3, 1fr)' : ''; $('tiles').innerHTML = LOCS.map(function (L) {
      var here = open.filter(function (o) { return locOf(STAGES[IDX[o.stage] || 0], o) === L.k; });
      var bad = here.filter(function (o) { var f = info(o, now); return f.late || f.hold; }).length;
      return '<button class="tile" type="button" data-loc="' + L.k + '" aria-pressed="' + (st.loc === L.k) + '" style="--tc:' + L.c + '"><span class="n">' + here.length + '</span><span class="l">' + L.n + '</span><span class="late">' + (bad ? bad + ' מתעכבות' : '') + '</span></button>';
    }).join('');
  }
  function renderFilters() {
    var agents = {}; st.orders.forEach(function (o) { if (o.agent) agents[o.agent] = 1; });
    // stage filter: every stage with how many open orders stand in it, grouped by where the tub is
    var stSel = $('stageSel'), open = st.orders.filter(function (o) { return o.stage !== 'delivered'; }), cnt = {};
    open.forEach(function (o) { cnt[o.stage] = (cnt[o.stage] || 0) + 1; });
    if (st.stageF && !IDX.hasOwnProperty(st.stageF)) st.stageF = '';
    // a location itself can be chosen too ("loc:<key>"), then each of its stages, indented under it
    var locCnt = {}; open.forEach(function (o) { var k = locOf(STAGES[IDX[o.stage] || 0], o); locCnt[k] = (locCnt[k] || 0) + 1; });
    stSel.innerHTML = '<option value="">כל השלבים (' + open.length + ')</option>' + LOCS.map(function (L) {
      return '<option value="loc:' + L.k + '">■ ' + esc(L.n) + ' · הכול (' + (locCnt[L.k] || 0) + ')</option>' +
        STAGES.filter(function (x) { return x.loc === L.k; }).map(function (x) { return '<option value="' + x.k + '">\u00a0\u00a0\u00a0\u00a0' + esc(x.n) + ' (' + (cnt[x.k] || 0) + ')</option>'; }).join('');
    }).join('');
    stSel.value = st.stageF || (st.loc ? 'loc:' + st.loc : '');
    var sel = $('agentSel'), keys = Object.keys(agents).sort();
    sel.hidden = me.role === 'agent' || !keys.length;
    sel.innerHTML = '<option value="">כל הסוכנים</option>' + keys.map(function (a) { return '<option value="' + esc(a) + '">' + esc(a) + '</option>'; }).join('');
    if (keys.indexOf(st.agent) < 0) st.agent = ''; sel.value = st.agent;
    var nDel = st.orders.filter(function (o) { return o.stage === 'delivered'; }).length;
    $('tabs').innerHTML =
      '<button class="btn small' + (st.tab === 'open' ? ' primary' : '') + '" type="button" data-tab="open">פתוחות (' + (st.orders.length - nDel) + ')</button>' +
      '<button class="btn small' + (st.tab === 'done' ? ' primary' : '') + '" type="button" data-tab="done">סופקו (' + nDel + ')</button>' +
      (st.loc || st.stageF ? '<button class="btn small" type="button" data-loc-clear="1">הצג הכול</button>' : '');
  }
  // where the tub is at a stage: a1 still in Ashdod, bk in Barkan, a2 back in Ashdod; a truck ride counts as its destination
  function phaseOf(k, o) { var j = IDX[k], s = STAGES[j]; while (s && s.loc === 'road' && STAGES[j + 1]) s = STAGES[++j]; return s ? locOf(s, o) : 'a1'; }
  function stepsBar(o) {
    var list = STAGES.filter(function (s) { return s.k !== 'delivered' && !skips(s, o); }), cur = list.findIndex(function (s) { return s.k === o.stage; });
    return '<div class="steps" aria-hidden="true">' + list.map(function (s, j) { return '<i class="' + (j < cur ? 'd' : j === cur ? 'c' : '') + '" style="--pc:' + LOCC[phaseOf(s.k, o)] + '"></i>'; }).join('') + '</div>';
  }
  // On a wide screen the list stays on the right and the chosen order opens in a side panel on the left;
  // on a phone the card opens in place.
  var wideMq = window.matchMedia ? window.matchMedia('(min-width: 1000px)') : null, WIDE = !!(wideMq && wideMq.matches);
  if (wideMq) { var onWide = function (e) { WIDE = e.matches; render(); }; if (wideMq.addEventListener) wideMq.addEventListener('change', onWide); else if (wideMq.addListener) wideMq.addListener(onWide); }
  function cardHtml(x) {
    var o = x.o, f = x.f, del = o.stage === 'delivered', open = st.openId === o.id;
    var h = '<div class="card' + (f.hold ? ' hold' : f.late ? ' late' : '') + (open && WIDE ? ' sel' : '') + '" style="--lc:' + LOCC[f.loc] + '"><button type="button" data-open="' + esc(o.id) + '" aria-expanded="' + open + '">' + summaryHtml(o, f) + '</button>';
    if (open && !WIDE) h += detailHtml(o, f);
    return h + '</div>';
  }
  function summaryHtml(o, f) {
    var del = o.stage === 'delivered';
    var chips = kindOf(o) === 'jacuzzi' && o.stage === 'toBarkan' && rcvChip(o) ? '' : '<span class="chip' + (del ? ' ok' : '') + '">' + f.s.n + '</span>';
    if (f.hold) chips += '<span class="chip hold">מעוכב: ' + esc(o.hold.reason) + '</span>';
    else if (f.late) chips += '<span class="chip late">חריגה של ' + dayWord(f.over) + '</span>';
    var ca = custAnswer(o);
    if (ca && ca.status === 'changes') chips += '<span class="chip hold">הלקוח ביקש שינוי</span>';
    else if (o.stage === 'approval' && o.approvalSentAt) chips += '<span class="chip">נשלח ללקוח</span>';
    chips += rcvChip(o);
    var eta = del ? 'סופק ב-' + fmt(o.stageAt) : f.hold ? 'אספקה צפויה: לא ידוע עד שהעיכוב יוסר'
      : 'בשלב הזה ' + dayWord(f.el) + ' · אספקה צפויה יום ' + DAYS[f.eta.getDay()] + "' " + pad(f.eta.getDate()) + '/' + pad(f.eta.getMonth() + 1);
    var meta = (kindOf(o) === 'spa' ? [mname(o.model), o.equipName, o.acrylic ? 'אקריל ' + pick(SPA.acrylics, o.acrylic) : '', o.cabinet ? 'חיפוי ' + pick(SPA.cabinets, o.cabinet) : '']
      : [omodel(o), o.system, o.panel ? 'כולל פאנל' : '']).concat([o.agent ? 'סוכן: ' + o.agent : '']).filter(Boolean).map(esc).join(' · ');
    return '<div class="c-top"><span class="c-cust">' + esc(titleOf(o)) + '</span><span class="c-num">' + [o.tubNum ? 'סידורי ' + esc(o.tubNum) : '', o.num ? 'הזמנה ' + esc(o.num) : ''].filter(Boolean).join(' · ') + '</span></div>' +
      (meta ? '<div class="c-meta">' + meta + '</div>' : '') + '<div class="c-stage">' + chips + '</div>' + (del ? '' : stepsBar(o)) + '<div class="c-eta">' + eta + '</div>';
  }
  function renderSide(now) {
    var box = $('side');
    if (!WIDE) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    var o = st.openId && find(st.openId);
    if (!o) { box.className = 'card side empty'; box.style.removeProperty('--lc'); box.innerHTML = '<div class="state">' + (st.orders.length ? 'בוחרים הזמנה מהרשימה כדי לראות כאן את הפרטים.' : '') + '</div>'; return; }
    var f = info(o, now);
    box.className = 'card side' + (f.hold ? ' hold' : f.late ? ' late' : ''); box.style.setProperty('--lc', LOCC[f.loc]);
    box.innerHTML = '<div class="side-head">' + summaryHtml(o, f) + '<button class="btn small" type="button" data-open="' + esc(o.id) + '">סגירה</button></div>' + detailHtml(o, f);
  }
  function detailHtml(o, f) {
    var id = esc(o.id), busy = st.busy[o.id] ? ' disabled' : '', del = o.stage === 'delivered', h = '<div class="detail">';
    if (o.notes) h += '<div class="notes">' + esc(o.notes) + '</div>';
    if (kindOf(o) === 'spa') h += spaSpec(o);
    else { var al = addonLines(o).map(function (x) { return x.n + (x.q > 1 ? ' ×' + x.q : ''); }); if (o.waste && o.waste !== 'chrome') al.push('אביק ' + pick(ADD.waste, o.waste)); if (al.length) h += '<dl class="spec"><dt>תוספות</dt><dd>' + al.map(esc).join('<br>') + '</dd></dl>'; }
    if (isOffice() && !del) h += '<button class="btn" type="button" data-edit="' + id + '">עריכת פרטי ההזמנה</button>';
    if (canWrite()) h += '<div class="row tubrow"><label for="tn-' + id + '">מספר סידורי</label><input id="tn-' + id + '" inputmode="numeric" maxlength="' + (kindOf(o) === 'spa' ? 8 : 4) + '" autocomplete="off" value="' + esc(o.tubNum || '') + '"><button class="btn small" type="button" data-savetub="' + id + '">שמור</button></div>';
    if (drawModel(o)) h += '<button class="btn" type="button" data-sketch="' + id + '">' + (o.sketch ? (canDraw(o) ? 'עריכת השרטוט' : 'צפייה בשרטוט') : (canDraw(o) ? 'יצירת שרטוט' : 'אין עדיין שרטוט')) + '</button>';
    if (drawModel(o) && o.sketch && me.role !== 'agent') h += '<button class="btn" type="button" data-skprint="' + id + '">הדפסת סקיצה למאבזר</button>';
    if (kindOf(o) === 'jacuzzi' && canWrite() && me.role !== 'driver' && !del) h += '<div class="row stkrow"><span>מדבקות QR:</span><button class="btn small" type="button" data-stk="' + id + '" data-parts="tub,kit">אמבטיה + קיט (4)</button><button class="btn small" type="button" data-stk="' + id + '" data-parts="tub">רק אמבטיה</button><button class="btn small" type="button" data-stk="' + id + '" data-parts="kit">רק קיט (3)</button></div>';
    h += sendBox(o, '');
    if (f.unknown) return h + '<div class="issue warn">המסך הזה פועל בגרסה ישנה ולא מכיר את השלב של ההזמנה. <button class="btn small" type="button" data-reload="1">רענון</button></div></div>';
    if (!del) h += kitHtml(o, f);
    h += rcvHtml(o);
    if (!del && canWrite()) {
      h += '<div class="who">מי מעדכן עכשיו: ' + (missOpen(o) && !tubSent(o) ? 'משרד / מחסן אשדוד: לשלוח את האמבטיה לברקן' : f.s.who) + '</div>';
      if (f.hold) h += '<button class="btn primary big" type="button" data-unhold="' + id + '"' + busy + '>העיכוב הוסר, ממשיכים</button>';
      else {
        // jacuzzi stages that only a sticker scan closes: no button, just say what moves it on
        var scanHint = kindOf(o) === 'jacuzzi' && SCAN_HINT[f.s.k];
        if (scanHint && !(f.s.k === 'toBarkan' && o.rcvTub && o.rcvKit)) h += '<div class="scanhint">📷 ' + scanHint + '</div>';
        else if (canAct(f.s)) {
          var blockTxt = '';
          if (f.s.k === TR.kitStage && !kitNow(o).length) blockTxt = 'הרשימה ריקה. מוסיפים לפחות פריט אחד.';
          if (f.s.k === 'tech' && (!o.shell || !o.equipLoc || !o.install)) blockTxt = 'לפני האישור בוחרים סוג התקנה, מקור קליפה ומקום איבזור (בעריכת פרטי ההזמנה).';
          if (f.s.k === 'approval' && MODEL[o.model]) { if (!o.sketch) blockTxt = 'אי אפשר לאשר לפני שיש שרטוט.'; else if (o.sketchBlocking) blockTxt = 'בשרטוט יש בעיה מסומנת באדום. צריך לתקן לפני אישור.'; }
          h += '<button class="btn primary big" type="button" data-next="' + id + '"' + (busy || (blockTxt ? ' disabled' : '')) + '>' + f.s.done + (f.s.k === 'inspect' && o.panel ? ' (כולל פאנל)' : '') + '</button>';
          if (blockTxt) h += '<div class="who">' + blockTxt + '</div>';
          // the customer already approved a drawing with the order (e.g. through the store): skip sending it for approval
          if (kindOf(o) === 'jacuzzi' && IDX[o.stage] <= IDX.approval) {
            var skipBlock = o.sketch && o.sketchBlocking;
            h += '<button class="btn" type="button" data-skipappr="' + id + '"' + (busy || (skipBlock ? ' disabled' : '')) + '>' + 'דילוג על אישור הלקוח (יש סקיצה מאושרת בהזמנה)' + '</button>';
            if (skipBlock) h += '<div class="who">בשרטוט יש בעיה מסומנת באדום. מתקנים לפני שמדלגים.</div>';
            else if (!o.sketch && drawModel(o)) h += '<div class="who">אין עדיין שרטוט במערכת: אחרי הדילוג רשימת הקיט לא תיגזר משרטוט, ומוסיפים פריטים ידנית.</div>';
          }
          if (f.s.k === 'inspect') h += '<button class="btn danger" type="button" data-fail="' + id + '"' + busy + '>' + 'הבדיקה נכשלה, חוזר לברקן' + '</button>';
        }
        if (st.holdFor === o.id) {
          h += '<div class="holdbox"><strong>מה מעכב?</strong><div class="row">' + HOLDS.map(function (r) { return '<button class="btn small" type="button" data-hold="' + id + '" data-reason="' + r + '">' + r + '</button>'; }).join('') + '</div>' +
            '<div class="row" style="flex-wrap:nowrap"><input id="holdTxt" placeholder="סיבה אחרת" autocomplete="off" aria-label="סיבה אחרת"><button class="btn small" type="button" data-hold="' + id + '">שמור</button></div></div>';
        } else h += '<button class="btn" type="button" data-holdopen="' + id + '"' + busy + '>דיווח על עיכוב</button>';
      }
    }
    h += '<div><h2 style="margin-bottom:6px">מה קרה עד עכשיו</h2><ul class="tl">' + (o.history || []).map(function (e) {
      var s = STAGES[IDX[e.s]] || { n: J_OLD_N[e.s] || e.s };
      return '<li><time>' + fmt(e.at) + '</time><span>' + esc(s.n) + (e.byName ? ' · ' + esc(e.byName) : '') + (e.note ? ' · <span class="note">' + esc(e.note) + '</span>' : '') + '</span></li>';
    }).join('') + '</ul></div>';
    var tools = '';
    if (isOffice() && (o.history || []).length > 1) tools += '<button class="btn small" type="button" data-undo="' + id + '"' + busy + '>' + 'חזרה שלב אחד' + '</button>';
    if (isAdmin()) tools += '<button class="btn small danger" type="button" data-del="' + id + '"' + busy + '>' + 'מחיקת ההזמנה' + '</button>';
    if (tools) h += '<div class="row">' + tools + '</div>';
    return h + '</div>';
  }
  function renderList(now) {
    var box = $('list');
    if (st.err) { box.innerHTML = '<div class="state">' + esc(st.err) + '</div>'; return; }
    if (!st.loaded) { box.innerHTML = '<div class="state">טוען הזמנות…</div>'; return; }
    if (!st.orders.length) { box.innerHTML = '<div class="state">עדיין אין הזמנות במעקב.' + (isOffice() ? '<br>לוחצים על "+ הזמנה חדשה" כדי להוסיף את הראשונה.' : '') + '</div>'; return; }
    var rows = visible(now);
    box.innerHTML = rows.length ? rows.map(cardHtml).join('') : '<div class="state">אין הזמנות שמתאימות לסינון.</div>';
  }
  // One form for a new order and for changing an existing one (st.editId), in the fields of the current tracker.
  function opts(list, cur, empty) { return (empty != null ? '<option value="">' + empty + '</option>' : '') + list.map(function (p) { return '<option value="' + esc(p[0]) + '"' + (p[0] === cur ? ' selected' : '') + '>' + esc(p[1]) + '</option>'; }).join(''); }
  function fSel(id, label, list, cur, empty, cls) { return '<label' + (cls ? ' class="' + cls + '"' : '') + ' for="' + id + '">' + label + '<select id="' + id + '">' + opts(list, cur, empty) + '</select></label>'; }
  function fInp(id, label, val, attrs) { return '<label for="' + id + '">' + label + '<input id="' + id + '" autocomplete="off" value="' + esc(val || '') + '"' + (attrs || '') + '></label>'; }
  function fChk(id, label, on) { return '<label class="chk" for="' + id + '"><input id="' + id + '" type="checkbox"' + (on ? ' checked' : '') + '>' + label + '</label>'; }
  function equipOpts(modelId, cur) { var m = SPA_MODEL[modelId]; return opts(m ? m.equip.map(function (e) { return [e[1], e[1] + (e[0] ? ' · מק"ט ' + e[0] : '')]; }) : [], cur, m ? 'בחירת איבזור' : 'בוחרים קודם דגם'); }
  // picture choices: a hidden field holds the value, the buttons set it
  function pickRow(field, cur, items) {
    return '<input type="hidden" id="' + field + '" value="' + esc(cur || '') + '"><div class="pick" data-for="' + field + '">' +
      '<button type="button" data-val=""' + (cur ? '' : ' class="on"') + '><span class="none">ללא</span></button>' +
      items.map(function (it) { return '<button type="button" data-val="' + esc(it[0]) + '"' + (it[0] === cur ? ' class="on"' : '') + '>' + (it[2] ? '<img src="' + it[2] + '" alt="" loading="lazy">' : '') + '<span>' + esc(it[1]) + '</span></button>'; }).join('') + '</div>';
  }
  function addonsForm(v) {
    var fin = v('tapFin') || 'nickel';
    return '<div class="wide addons"><h3>תוספות</h3>' +
      '<div class="lbl">סט ברזים</div>' + pickRow('nTap', v('tap'), ADD.taps.map(function (t) { return [t[0], t[0] + ' · ' + t[1], tapImg(t[0], fin)]; })) +
      '<div class="row">' + fSel('nTapFin', 'גימור הברז', ADD.tapFin, fin) + '</div>' +
      '<div class="lbl">כרית ראש</div>' + pickRow('nPillow', v('pillow'), ADD.pillows.map(function (p) { return [p[0], p[0] + ' · ' + p[1], 'img/addons/' + p[0] + '.jpg']; })) +
      '<div class="row">' + fSel('nPillowColor', 'גוון הכרית', ADD.pillowColors, v('pillowColor') || 'black') + fInp('nPillowQty', 'כמות כריות', String(v('pillowQty') || 1), ' type="number" min="1" max="4" inputmode="numeric"') + '</div>' +
      '<div class="row">' + fSel('nWaste', 'גוון אביק', ADD.waste, v('waste') || 'chrome') + '</div></div>';
  }
  function renderForm() {
    var f = $('form'), on = st.form || !!st.editId; f.hidden = !on; if (!on) { f.innerHTML = ''; return; }
    if (f.innerHTML) return;
    var o = st.editId ? find(st.editId) : null; if (st.editId && !o) { st.editId = null; f.hidden = true; return; }
    var v = function (k) { return o && o[k] != null ? o[k] : ''; };
    var names = AGENTS.slice(); users.forEach(function (u) { if (u.role === 'agent' && u.name && names.indexOf(u.name) < 0) names.push(u.name); });
    if (o && o.agent && names.indexOf(o.agent) < 0) names.push(o.agent);
    var agentSel = fSel('nAgent', 'סוכן', names.map(function (n) { return [n, n]; }), v('agent'), 'ללא סוכן');
    var h = '<h2>' + (o ? 'עריכת פרטי ההזמנה · ' + esc(titleOf(o)) : 'הזמנה חדשה · ' + TR.word) + '</h2><div class="grid">';
    if (st.kind === 'spa') {
      h += fInp('nNum', 'מס\' הזמנה באינטגרל', v('num'), ' inputmode="numeric"') + (o ? '' : fInp('nTub', 'מספר סידורי', '', ' inputmode="numeric" maxlength="8"')) +
        fInp('nCust', 'לקוח/ה', v('customer')) + fInp('nStore', 'חנות (לא חובה)', v('store')) + fInp('nPhone', 'טלפון הלקוח', v('phone'), ' inputmode="tel" dir="ltr"') + fInp('nAddr', 'כתובת', v('address')) + agentSel +
        fSel('nModel', 'דגם', SPA.models.map(function (m) { return [m.id, m.name + ' · ' + m.dims + (m.swim ? ' · בריכת זרמים' : '')]; }), v('model'), 'בחירת דגם') +
        '<label for="nEquip">איבזור<select id="nEquip">' + equipOpts(v('model'), v('equipName')) + '</select></label>' +
        fSel('nAcrylic', 'צבע אקריל', SPA.acrylics.map(function (a) { return [a[0], a[1] + ' · ' + a[0]]; }), v('acrylic'), 'בחירה') + fSel('nCabinet', 'חיפוי', SPA.cabinets, v('cabinet'), 'בחירה') +
        fSel('nPhase', 'חיבור חשמל', SPA.phases, v('phase'), 'בחירה') + fSel('nInstall', 'סוג התקנה', SPA.installs, v('install'), 'בחירה') +
        fSel('nShell', 'מקור הקליפה (קובי)', SPA.shells, v('shell'), 'עוד לא נקבע') + fSel('nEquipLoc', 'מקום האיבזור (קובי)', SPA.equipLocs, v('equipLoc'), 'עוד לא נקבע') +
        fSel('nDelivery', 'מסירה', SPA.delivery, v('delivery'), 'בחירה') + fSel('nController', 'בקר', SPA.controllers, v('controller'), 'בחירה') +
        fSel('nJetColor', 'גוון ג\'טים', SPA.jetColors, v('jetColor'), 'בחירה') + fSel('nLights', 'תאורה בצדדים', [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']], v('lightSides') ? String(v('lightSides')) : '', 'ללא') +
        '<div class="wide chkrow">' + fChk('nTouch4', 'Spa Touch 4 (WiFi)', v('touch4')) + fChk('nOzone', 'אוזון', v('ozone')) + fChk('nUv', 'UV', v('uv')) + '</div>' +
        '<div class="wide chkrow"><span class="lbl">ספקי ג\'טים</span>' + SPA.jetSuppliers.map(function (n, k) { return fChk('nSup' + k, n, (v('jetSup') || []).indexOf(n) > -1); }).join('') + '</div>' +
        '<div class="wide chkrow"><span class="lbl">אביזרים</span>' + SPA.accessories.map(function (a, k) { return fChk('nAcc' + k, a[1], (v('acc') || []).indexOf(a[0]) > -1); }).join('') + '</div>';
    } else {
      h += fInp('nNum', 'מס\' הזמנה באינטגרל', v('num'), ' inputmode="numeric"') +
        // the next serial is filled in; it can be overwritten for an old jacuzzi that already has a number (the counter then stays where it is)
        (o ? '' : '<label for="nTub">מספר סידורי (אוטומטי, אפשר לשנות)<input id="nTub" inputmode="numeric" maxlength="4" autocomplete="off" value="' + pad4(Math.max(st.nextSerial, serialFloor())) + '"></label>') +
        fInp('nStore', 'לקוח', v('store')) + fInp('nCust', 'לקוח סופי (לא חובה)', v('customer')) +
        fSel('nModel', 'דגם אמבטיה', MODELS.map(function (m) { return [m.code, (m.name || m.code) + ' · ' + m.dims]; }), v('model'), 'בחירת דגם') +
        fSel('nSys', 'מערכת', [['BASIC', 'BASIC'], ['TITANIUM', 'TITANIUM'], ['אחר', 'אחר']], v('system') || 'BASIC') + agentSel +
        fInp('nPhone', 'טלפון הלקוח', v('phone'), ' inputmode="tel" dir="ltr"') + fInp('nEmail', 'מייל הלקוח', v('custEmail'), ' type="email" dir="ltr"') +
        fChk('nPanel', 'הלקוח הזמין פאנל', v('panel')) + addonsForm(v);
    }
    h += '<label class="wide" for="nNotes">הערות<textarea id="nNotes" rows="2">' + esc(v('notes')) + '</textarea></label></div>' +
      '<div class="who" id="nWarn" hidden></div>' +
      '<div class="row"><button class="btn primary" type="button" id="nSave">' + (o ? 'שמירת השינויים' : 'הוספה למעקב') + '</button><button class="btn" type="button" id="nCancel">ביטול</button><span id="nErr" style="color:var(--bad)"></span></div>';
    f.innerHTML = h;
  }
  function renderUsers() {
    var p = $('usersPanel'); p.hidden = !st.usersOpen; if (!st.usersOpen) { p.innerHTML = ''; return; }
    if (p.innerHTML && !st.usersDirty) return; st.usersDirty = false;
    var opts = function (cur) { return Object.keys(ROLES).map(function (r) { return '<option value="' + r + '"' + (r === cur ? ' selected' : '') + '>' + ROLES[r] + '</option>'; }).join(''); };
    p.innerHTML = '<h2>משתמשים והרשאות</h2><div class="who">כל מי שמופיע כאן יכול להיכנס עם חשבון ה-Google שלו. סוכן רואה רק את ההזמנות שלו ולא מעדכן.</div>' +
      '<table class="users">' + users.slice().sort(function (a, b) { return a.email.localeCompare(b.email); }).map(function (u) {
        var self = u.email === me.email;
        return '<tr><td><strong>' + esc(u.name || '') + '</strong><div class="e">' + esc(u.email) + '</div></td><td style="text-align:left;white-space:nowrap"><select data-urole="' + esc(u.email) + '" aria-label="תפקיד"' + (self ? ' disabled' : '') + '>' + opts(u.role) + '</select> ' +
          (self ? '' : '<button class="btn small danger" type="button" data-udel="' + esc(u.email) + '">' + (st.armed['u' + u.email] ? 'בטוח?' : 'הסר') + '</button>') + '</td></tr>';
      }).join('') + '</table>' +
      '<div class="grid"><label for="uEmail">כתובת Gmail<input id="uEmail" type="email" dir="ltr" autocomplete="off"></label><label for="uName">שם<input id="uName" autocomplete="off"></label><label for="uRole">תפקיד<select id="uRole">' + opts('agent') + '</select></label></div>' +
      '<div class="row"><button class="btn primary" type="button" id="uAdd">הוספת משתמש</button><button class="btn" type="button" id="uClose">סגירה</button><span id="uErr" style="color:var(--bad)"></span></div>';
  }
  var pending = false;
  // The box that sends the drawing to the customer for approval. pfx keeps its field ids apart when it also shows in the drawing screen.
  function sendBox(o, pfx) {
    if (!(o && isOffice() && o.approvalToken && o.sketch && !o.sketchBlocking && IDX[o.stage] <= IDX.approval)) return '';
    var id = esc(o.id);
      var ph = intlPhone(o.phone), txt = encodeURIComponent(custMessage(o)), ca = custAnswer(o);
      return '<div class="sendbox"><strong>שליחת השרטוט ללקוח לאישור</strong>' +
        (ca && ca.status === 'changes' ? '<div class="st chg">הלקוח ביקש שינוי (' + fmt(ca.answeredAt) + '): ' + esc(ca.comment) + '<br>אחרי תיקון ושמירת השרטוט שולחים שוב.</div>'
          : o.approvalSentAt ? '<div class="st">נשלח ב-' + fmt(o.approvalSentAt) + '. ממתין לתשובת הלקוח.</div>' : '') +
        '<div class="row"><input id="' + pfx + 'ph-' + id + '" inputmode="tel" dir="ltr" placeholder="טלפון הלקוח" aria-label="טלפון הלקוח" value="' + esc(o.phone || '') + '">' +
        '<input id="' + pfx + 'em-' + id + '" type="email" dir="ltr" placeholder="מייל הלקוח" aria-label="מייל הלקוח" value="' + esc(o.custEmail || '') + '">' +
        '<button class="btn small" type="button" data-savecontact="' + id + '" data-pfx="' + pfx + '">שמור</button></div><div class="row">' +
        (ph ? '<a class="btn small primary" target="_blank" rel="noopener" data-send="' + id + '" data-ch="WhatsApp" href="https://wa.me/' + ph + '?text=' + txt + '">WhatsApp</a>' +
              '<a class="btn small" data-send="' + id + '" data-ch="SMS" href="sms:+' + ph + '?body=' + txt + '">SMS</a>' : '') +
        (o.custEmail ? '<a class="btn small" data-send="' + id + '" data-ch="אימייל" href="mailto:' + esc(o.custEmail) + '?subject=' + encodeURIComponent('MTI · אישור סקיצה לג\'קוזי') + '&body=' + txt + '">אימייל</a>' : '') +
        '<button class="btn small" type="button" data-copy="' + id + '">העתקת קישור</button></div>' +
        (!ph && !o.custEmail ? '<div class="st">כדי לשלוח, מוסיפים טלפון או מייל של הלקוח ושומרים. אפשר גם להעתיק את הקישור ולשלוח ידנית.</div>' : '') + '</div>';
  }
  // while the drawing screen is open, its send box follows the saved order
  function refreshSketchSend() {
    var box = st.sketchId && $('sketchView').querySelector('#skExtra'); if (!box) return;
    var a = document.activeElement; if (a && box.contains(a) && a.tagName === 'INPUT') { pending = true; return; }
    box.innerHTML = sendBox(find(st.sketchId), 'sk-');
    if (st.scrollSend && box.innerHTML) { st.scrollSend = false; setTimeout(function () { if (box.scrollIntoView) box.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 50); }
  }
  function render() {
    if (!me) return;
    var a = document.activeElement;
    if (a && ($('list').contains(a) || $('side').contains(a) || $('usersPanel').contains(a) || ($('sketchView').querySelector('#skExtra') || $('list')).contains(a)) && (a.tagName === 'INPUT')) { pending = true; return; }
    pending = false;
    var now = new Date();
    $('newBtn').hidden = !isOffice(); $('usersBtn').hidden = !isAdmin(); $('scanBtn').hidden = me.role === 'agent'; $('scanBtn').className = 'btn ' + (me.role === 'driver' || me.role === 'barkan' ? 'primary' : 'small'); applyKind();
    $('banner').hidden = me.role !== 'agent'; if (me.role === 'agent') $('banner').textContent = 'תצוגה בלבד: כאן רואים איפה כל ' + TR.word + ' של הלקוחות שלך ומתי הוא צפוי לרדת.';
    renderTiles(now); renderFilters(); renderForm(); renderUsers(); renderAlerts(); renderList(now); renderSide(now); refreshSketchSend();
    $('foot').textContent = st.loaded ? 'ימי עבודה: א\'–ה\'. חריגה מסומנת כשהזמנה נשארת בשלב יותר מהזמן שהוקצב לו.' : '';
  }
  document.addEventListener('focusout', function () { if (pending) setTimeout(render, 0); });

  // ---------- writes ----------
  function find(id) { return st.orders.find(function (o) { return o.id === id; }); }
  async function write(id, fn) {
    if (st.busy[id]) return; st.busy[id] = true; render();
    var failed = false; try { await fn(); } catch (e) { failed = true; }
    st.busy[id] = false; render();
    if (failed) { $('banner').hidden = false; $('banner').textContent = 'העדכון לא נשמר. ייתכן שאין הרשאה או שאין חיבור. נסו שוב.'; }
  }
  function event(key, note) { var ev = { s: key, at: new Date().toISOString(), by: me.email, byName: me.name || me.email }; if (note) ev.note = note; return ev; }
  // Receiving at Barkan is two separate things: the tub and the kit. Either may come first, and the tub may arrive
  // before the kit is ready. The order leaves "on the way to Barkan" only when both are there.
  function rcvOn(o) { return kindOf(o) === 'jacuzzi' && o.stage !== 'delivered' && IDX[o.stage] <= IDX.toBarkan; }
  function rcvMark() { return { at: new Date().toISOString(), by: me.email, byName: me.name || me.email }; }
  // one plain line on the card: where the tub and the kit are right now, until both are in Barkan
  function pieceAt(o, p) {
    var r = p === 'tub' ? o.rcvTub : o.rcvKit, l = o[p + 'Loc'];
    if (r && r.fix) return '';
    if (r) return p === 'tub' && r.stock ? 'מהמלאי בברקן' : 'בברקן';
    if (l && l.at === 'truckB') return 'על המשאית';
    if (p === 'kit' && IDX[o.stage] <= IDX.kit) return 'בהכנה';
    return 'באשדוד';
  }
  function rcvChip(o) {
    if (!rcvOn(o) || (IDX[o.stage] < IDX.toBarkan && !o.rcvTub && !o.tubLoc)) return '';
    var t = pieceAt(o, 'tub'), k = pieceAt(o, 'kit');
    var txt = ['אמבטיה ' + t, k && o.stage !== 'kit' ? 'קיט ' + k : ''].filter(Boolean).join(' · ');
    return '<span class="chip' + (missOpen(o) ? ' hold' : '') + '">' + txt + '</span>';
  }
  // "the tub did not arrive": flagged in Barkan, shown to the office and the Ashdod warehouse until Barkan confirms receipt
  function canSend() { return me && (isOffice() || me.role === 'warehouse'); }
  // also open on its own once the kit is in Barkan and the tub is not: then the tub is Ashdod's job
  function missOpen(o) { return kindOf(o) === 'jacuzzi' && !o.rcvTub && o.stage !== 'delivered' && !!(o.tubMissing || (o.stage === 'toBarkan' && o.rcvKit)); }
  function tubSent(o) { return !!(o.tubMissing && o.tubMissing.sentAt); }
  function missLine(o) { var m = o.tubMissing || {};
    var head = m.at ? '⚠ ברקן סימנו שהאמבטיה לא התקבלה · ' + fmt(m.at) + (m.byName ? ' · ' + esc(m.byName) : '') : '⚠ הקיט כבר בברקן והאמבטיה עוד לא התקבלה' + (o.rcvKit && o.rcvKit.at ? ' · הקיט התקבל ' + fmt(o.rcvKit.at) : '');
    return head + (m.sentAt ? '<br>נסרקה בעלייה למשאית · ' + fmt(m.sentAt) + (m.sentName ? ' · ' + esc(m.sentName) : '') + ' · מחכים לאישור קבלה בברקן' : ''); }
  function renderAlerts() {
    var box = $('alerts'), list = canSend() && st.kind === 'jacuzzi' ? st.orders.filter(missOpen) : [], tr = truckHtml();
    box.hidden = !list.length && !tr; if (!list.length) { box.innerHTML = tr; return; }
    var todo = list.filter(function (o) { return !tubSent(o); }), sent = list.filter(tubSent);
    function line(o) { return '<li><button type="button" class="alink" data-open="' + esc(o.id) + '">' + esc(titleOf(o)) + (o.tubNum ? ' · סידורי ' + esc(o.tubNum) : '') + ' · ' + esc(omodel(o)) + '</button> <span class="who">' + (tubSent(o) ? 'עלתה למשאית ' + fmt(o.tubMissing.sentAt) : 'מ-' + fmt((o.tubMissing && o.tubMissing.at) || (o.rcvKit && o.rcvKit.at) || o.stageAt)) + '</span>' + (tubSent(o) ? '' : ' <span class="who">· תעבור כשהנהג יסרוק את המדבקה</span>') + '</li>'; }
    box.innerHTML = (todo.length ? '<div class="alert bad"><strong>צריך לשלוח אמבטיה לברקן (' + todo.length + ')</strong><ul>' + todo.map(line).join('') + '</ul></div>' : '') +
      (sent.length ? '<div class="alert"><strong>אמבטיות שעלו למשאית ועוד לא נסרקו בברקן (' + sent.length + ')</strong><ul>' + sent.map(line).join('') + '</ul></div>' : '') + tr;
  }
  function rcvHtml(o) {
    if (!rcvOn(o)) return '';
    var id = esc(o.id), can = canWrite() && canAct(STAGES[IDX.toBarkan]), busy = st.busy[o.id] ? ' disabled' : '', kitOut = IDX[o.stage] >= IDX.toBarkan;
    function row(key, label, btn, wait) {
      var r = o[key], v;
      if (r) v = '<span class="rcv-ok">✓ ' + (r.fix ? 'לא נדרש (חזרה לתיקון)' : (r.stock ? 'מהמלאי בברקן' : key === 'rcvTub' ? 'התקבלה מאשדוד' : 'התקבל') + ' · ' + fmt(r.at) + (r.byName ? ' · ' + esc(r.byName) : '')) + '</span>' + (can && !r.fix ? ' <button class="btn small" type="button" data-rcvundo="' + id + '" data-part="' + key + '"' + busy + '>ביטול</button>' : '');
      else if (wait) v = '<span class="who">' + wait + '</span>';
      else v = can ? '<button class="btn primary" type="button" data-rcv="' + id + '" data-part="' + key + '"' + busy + '>' + btn + '</button>' +
        (key === 'rcvTub' ? '<button class="btn primary" type="button" data-rcv="' + id + '" data-part="' + key + '" data-stock="1"' + busy + '>יש במלאי בברקן</button>' +
          (missOpen(o) ? '' : '<button class="btn danger" type="button" data-tubmiss="' + id + '"' + busy + '>האמבטיה לא התקבלה</button>') : '') : '<span class="who">עוד לא התקבל</span>';
      if (key === 'rcvTub' && !r && missOpen(o)) v += '<div class="tubmiss">' + missLine(o) + '</div>';
      var lc = o[(key === 'rcvTub' ? 'tub' : 'kit') + 'Loc'];
      if (!r && lc && lc.at === 'truckB') v = '<span class="rcv-truck">🚚 על המשאית לברקן · ' + fmt(lc.t) + (lc.byName ? ' · ' + esc(lc.byName) : '') + '</span>' + v;
      return '<div class="rcv-row"><strong>' + label + '</strong>' + v + '</div>';
    }
    return '<div class="rcvbox"><h2>קבלה בברקן</h2>' +
      row('rcvTub', 'אמבטיה', 'התקבלה מאשדוד', '') +
      row('rcvKit', 'קיט', 'הקיט התקבל בברקן', kitOut ? '' : 'הקיט עוד באשדוד') +
      '<div class="who">ההזמנה עוברת לאיבזור כשגם האמבטיה וגם הקיט בברקן.</div></div>';
  }
  function move(o, key, note, extra) { var ev = event(key, note), u = { stage: key, stageAt: ev.at, hold: null, history: (o.history || []).concat([ev]) }; if (extra) Object.keys(extra).forEach(function (k) { u[k] = extra[k]; }); return col.doc(o.id).update(u); }
  // Kit order: what the warehouse has to pick. Until the office hands it over it follows the drawing plus lines the
  // office added by hand; at hand-over it is frozen into o.kitList, where the warehouse ticks each line.
  // the spa kit for now: the equipment level by its item number, plus the options that were ordered (exact lists to follow)
  function kitBase(o) {
    if (kindOf(o) !== 'spa') return Sketch.kitOf(o.sketch).concat(addonLines(o, true));
    var m = SPA_MODEL[o.model], out = [], c = pick(SPA.controllers, o.controller);
    if (m) out.push({ n: 'איבזור ' + (o.equipName || '') + ' · ' + m.name, q: 1, sku: o.equip || '' });
    if (c) out.push({ n: 'בקר ' + c, q: 1, sku: '' });
    if (o.touch4) out.push({ n: 'פאנל Spa Touch 4 (WiFi)', q: 1, sku: '' });
    if (o.ozone) out.push({ n: 'אוזון', q: 1, sku: '' });
    if (o.uv) out.push({ n: 'UV', q: 1, sku: '' });
    if (o.lightSides) out.push({ n: 'תאורה בצדדים', q: o.lightSides, sku: '' });
    (o.acc || []).forEach(function (a) { var l = pick(SPA.accessories, a); if (l) out.push({ n: l, q: 1, sku: '' }); });
    return out;
  }
  function spaSpec(o) {
    var rows = [['דגם', mname(o.model)], ['איבזור', o.equipName], ['צבע אקריל', pick(SPA.acrylics, o.acrylic)], ['חיפוי', pick(SPA.cabinets, o.cabinet)], ['חשמל', pick(SPA.phases, o.phase)],
      ['התקנה', pick(SPA.installs, o.install)], ['מקור הקליפה', pick(SPA.shells, o.shell)], ['מקום האיבזור', pick(SPA.equipLocs, o.equipLoc)], ['מסירה', pick(SPA.delivery, o.delivery)],
      ['בקר', pick(SPA.controllers, o.controller) + (o.touch4 ? ' + Spa Touch 4' : '')], ['חיטוי', [o.ozone ? 'אוזון' : '', o.uv ? 'UV' : ''].filter(Boolean).join(', ')],
      ['ג\'טים', [pick(SPA.jetColors, o.jetColor), (o.jetSup || []).join(', ')].filter(Boolean).join(' · ')], ['תאורה בצדדים', o.lightSides ? String(o.lightSides) : ''],
      ['אביזרים', (o.acc || []).map(function (a) { return pick(SPA.accessories, a); }).filter(Boolean).join(', ')], ['כתובת', o.address], ['טלפון', o.phone]];
    return '<dl class="spec">' + rows.filter(function (r) { return r[1]; }).map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>';
  }
  // the kit list while it is being prepared: the live draft, or the list already frozen for orders that reached the kit stage before the merge
  function kitNow(o) { var d = kitDraft(o); return d.length || !(o.kitList && o.kitList.length) ? d : o.kitList; }
  function kitDraft(o) { var l = kitBase(o); return l.concat((o.kitExtra || []).map(function (x, i) { return { n: x.n, q: x.q, sku: x.sku || '', extra: i }; })); }
  function skuHtml(x) { return x.sku ? '<span class="sku">מק"ט ' + esc(x.sku) + '</span>' : ''; }
  function kitHtml(o, f) {
    var id = esc(o.id), k = f.s.k, h = '';
    if (k === TR.kitStage && isOffice()) {
      var lines = kitNow(o);
      h += '<div class="kitbox"><strong>הזמנת קיט למחסנאי</strong>' + (o.sketch || kindOf(o) === 'spa' ? '' : '<div class="st">אין שרטוט שמור, אז הרשימה לא נגזרת אוטומטית. מוסיפים פריטים ידנית.</div>') +
        '<ul class="kitlist">' + lines.map(function (x) { return '<li><span class="q">' + esc(x.q) + '</span><span class="n">' + esc(x.n) + skuHtml(x) + '</span>' + (x.extra != null ? '<button class="btn small danger" type="button" data-kitdel="' + id + '" data-i="' + x.extra + '">הסר</button>' : '') + '</li>'; }).join('') + '</ul>' +
        '<div class="row"><input id="kn-' + id + '" placeholder="פריט נוסף" aria-label="פריט נוסף" autocomplete="off"><input id="ks-' + id + '" class="skuin" inputmode="numeric" placeholder="מק&quot;ט" aria-label="מק&quot;ט" autocomplete="off"><input id="kq-' + id + '" class="qty" inputmode="numeric" value="1" aria-label="כמות"><button class="btn small" type="button" data-kitadd="' + id + '">הוספה</button></div>' + '<div class="row"><button class="btn" type="button" data-kitprint="' + id + '">הורדת PDF / הדפסה</button></div>' + '</div>';
    } else if (k === TR.kitStage && kindOf(o) === 'jacuzzi') {
      h += '<div class="kitbox"><strong>רשימת הקיט להכנה</strong><ul class="kitlist">' + kitNow(o).map(function (x) { return '<li><span class="q">' + esc(x.q) + '</span><span class="n">' + esc(x.n) + skuHtml(x) + '</span></li>'; }).join('') + '</ul>' +
        '<div class="row"><button class="btn" type="button" data-kitprint="' + id + '">הורדת PDF / הדפסה</button></div></div>';
    } else if (o.kitList && o.kitList.length && IDX[k] >= IDX[TR.kitFrom] && IDX[k] <= IDX[TR.kitTo]) {
      h += '<div class="kitbox"><strong>' + (k === TR.kitFrom && kindOf(o) === 'spa' ? 'רשימת הקיט להכנה' : 'הקיט שנשלח') + '</strong>' +
        '<ul class="kitlist">' + o.kitList.map(function (x) { return '<li><span class="q">' + esc(x.q) + '</span><span class="n">' + esc(x.n) + skuHtml(x) + '</span></li>'; }).join('') + '</ul>' +
        '<div class="row"><button class="btn" type="button" data-kitprint="' + id + '">הורדת PDF / הדפסה</button></div></div>';
    }
    return h;
  }
  // A4 sheet for the fitter in Barkan, who works without a screen: the jacuzzi number, the drawing and which jets go in. No customer details.
  function printSketch(o) {
    var model = drawModel(o), sk = o.sketch, spa = kindOf(o) === 'spa'; if (!model || !sk) return;
    var tmp = document.createElement('div'); tmp.style.display = 'none'; document.body.appendChild(tmp);
    Sketch.open(tmp, { kind: spa ? 'spa' : '', model: model, system: o.system, data: sk, readOnly: true, print: !spa });
    var svg = tmp.querySelector('#skSvg').outerHTML.replace('id="skSvg"', '');
    tmp.querySelector('#skClose').click(); tmp.remove();
    var parts = spa ? Sketch.spaCounts(sk) : Sketch.kitOf(sk).filter(function (x) { return /^ג'ט|^מנוע|^פנס|^יניקה|^ברז|^מזלף/.test(x.n); }).concat(addonLines(o));
    var facts = spa ? [['דגם', mname(o.model)], ['איבזור', o.equipName], ['גוון ג\'טים', pick(SPA.jetColors, o.jetColor)], ['בקר', pick(SPA.controllers, o.controller)], ['התקנה', pick(SPA.installs, o.install)]].filter(function (f) { return f[1]; }) : [['דגם', mname(o.model) + ' · ' + model.dims], ['מערכת', o.system], ['כיוון', !model.sides ? '' : sk.side === 'R' ? 'ימין' : sk.side === 'L' ? 'שמאל' : ''], ['פנס', sk.light === true ? 'יש' : 'אין'], ['גימור ג\'טים', sk.series === 'prime' ? 'ניקל · PRIME' : sk.finish === 'white' ? 'לבן' : 'גרפיט'], ['פאנל', o.panel ? 'כן' : '']].filter(function (f) { return f[1]; });
    $('printArea').innerHTML = '<div class="p-page"><div class="p-head"><div><div class="p-brand">MTI</div><h1>סקיצה לאיבזור</h1></div><div class="p-serial"><span>' + (spa ? 'ספא מס\'' : 'ג\'קוזי מס\'') + '</span><b>' + esc(o.tubNum || '') + '</b></div></div>' +
      '<div class="p-facts">' + facts.map(function (f) { return '<div><span>' + esc(f[0]) + '</span><b>' + esc(f[1]) + '</b></div>'; }).join('') + '</div>' +
      '<div class="p-sketch">' + svg + '</div>' + (spa ? '' : '<div class="p-legend' + (sk.finish === 'white' ? ' wh' : '') + '"><span><i class="lg j3"></i>ג\'ט 3"</span><span><i class="lg j2"></i>ג\'ט 2"</span><span><b>' + (sk.series === 'prime' ? 'ג\'טים ניקל (PRIME)' : sk.finish === 'white' ? 'ג\'טים לבנים' : 'ג\'טים גרפיט') + '</b></span></div>') +
      '<table class="p-kit' + (!spa && sk.finish === 'white' ? ' wh' : '') + '"><thead><tr><th>פריט</th><th class="c">כמות</th></tr></thead><tbody>' + parts.map(function (x) { var m = /^ג'ט (\d)"/.exec(x.n); return '<tr><td>' + (m && !spa ? '<i class="lg j' + m[1] + '"></i> ' : '') + esc(x.n) + '</td><td class="c q">' + esc(x.q) + '</td></tr>'; }).join('') + '</tbody></table>' +
      (sk.notes ? '<p class="p-notes"><b>הערות למאבזר:</b> ' + esc(sk.notes) + '</p>' : '') + '</div>' + tagPage(o);
    var t = document.title, img = $('printArea').querySelector('image'), go = function () { document.title = 'סקיצה ' + (o.tubNum || ''); window.print(); document.title = t; };
    // wait for the tub picture so it is on the paper
    if (img) { var pre = new Image(), fired = false, once = function () { if (!fired) { fired = true; go(); } }; pre.onload = pre.onerror = once; pre.src = img.getAttribute('href'); setTimeout(once, 2500); } else go();
  }
  // ---------- QR stickers and scanning ----------
  // Every jacuzzi gets two stickers: the tub and the kit. A scan says where that piece is now, by who scans it:
  // the driver = loaded on the truck, Barkan = arrived in Barkan, the Ashdod warehouse = arrived in Ashdod.
  // Admins and the office get a choice instead, since they may be standing anywhere.
  var SCAN_BASE = location.href.split(/[?#]/)[0].replace(/[^/]*$/, '');
  var SCAN_ARG = new URLSearchParams(location.search).get('scan');
  var PART = { t: 'tub', k: 'kit' }, PART_N = { tub: 'אמבטיה', kit: 'קיט' };
  function scanUrl(o, p) { return SCAN_BASE + '?scan=' + encodeURIComponent(o.id) + '.' + (p === 'kit' ? 'k' : 't'); }
  function parseScan(text) {
    var m = /[?&]scan=([^&#]+)/.exec(String(text || '')) || /^([A-Za-z0-9_-]+)\.([tk])$/.exec(String(text || '').trim());
    if (!m) return null; var v = decodeURIComponent(m[2] ? m[1] + '.' + m[2] : m[1]), i = v.lastIndexOf('.');
    return i > 0 && PART[v.slice(i + 1)] ? { id: v.slice(0, i), p: PART[v.slice(i + 1)] } : null;
  }
  function locMark(at) { return { at: at, t: new Date().toISOString(), by: me.email, byName: me.name || me.email }; }
  var LOC_N = { truckB: 'על המשאית לברקן', barkan: 'בברקן', truckA: 'על המשאית לאשדוד', ashdod: 'באשדוד' };
  // what a scan of this piece can mean right now
  function scanActs(o, p) {
    if (kindOf(o) !== 'jacuzzi' || o.stage === 'delivered' || IDX[o.stage] == null) return [];
    var i = IDX[o.stage], loc = o[p + 'Loc'], a = [];
    if (p === 'tub') {
      if (!o.rcvTub && i <= IDX.toBarkan) {
        if (!loc || loc.at !== 'truckB') a.push({ k: 'loadB', who: ['driver'], n: 'עלתה על המשאית לברקן' });
        a.push({ k: 'atB', who: ['barkan'], n: 'הגיעה לברקן' });
      }
      if (o.stage === 'fitting' || o.stage === 'loadBk') a.push({ k: 'loadA', who: ['driver'], n: "הג'קוזי עלה על המשאית לאשדוד" });
      if (o.stage === 'toAshdod') a.push({ k: 'atA', who: ['warehouse'], n: "הג'קוזי הגיע לאשדוד" });
    } else if (!o.rcvKit && (o.stage === 'kit' || o.stage === 'toBarkan')) {
      if (!loc || loc.at !== 'truckB') a.push({ k: 'loadB', who: ['driver'], n: 'הקיט עלה על המשאית לברקן' });
      a.push({ k: 'atB', who: ['barkan'], n: 'הקיט הגיע לברקן' });
    }
    return a;
  }
  function scanState(o, p) { // a plain sentence for "nothing to do with this scan"
    if (kindOf(o) !== 'jacuzzi') return 'המדבקה שייכת להזמנת ספא. סריקה עובדת כרגע רק בג\'קוזי.';
    var loc = o[p + 'Loc'];
    if (p === 'kit' && IDX[o.stage] < IDX.kit) return 'הקיט עוד לא בהכנה במחסן (ההזמנה בשלב "' + STAGES[IDX[o.stage]].n + '").';
    return 'אין מה לעדכן. ההזמנה בשלב "' + (STAGES[IDX[o.stage]] || { n: o.stage }).n + '"' + (loc ? ', ה' + PART_N[p] + ' ' + LOC_N[loc.at] : '') + '.';
  }
  // apply one action; returns a promise of the previous values, for undo
  function scanApply(o, p, k) {
    var L = { loadB: 'truckB', atB: 'barkan', loadA: 'truckA', atA: 'ashdod' }[k], u = {}, to = null, note = '';
    u[p + 'Loc'] = locMark(L);
    if (k === 'loadB' && p === 'tub' && o.tubMissing && !o.tubMissing.sentAt) u.tubMissing = Object.assign({}, o.tubMissing, { sentAt: u.tubLoc.t, sentBy: me.email, sentName: me.name || me.email });
    if (k === 'loadB' && p === 'kit' && o.stage === 'kit') { to = 'toBarkan'; note = 'הקיט נסרק בעלייה למשאית'; }
    if (k === 'atB') {
      u[p === 'tub' ? 'rcvTub' : 'rcvKit'] = rcvMark(); if (p === 'tub') u.tubMissing = null;
      var other = p === 'tub' ? o.rcvKit : o.rcvTub;
      if (other) { to = 'fitting'; note = (p === 'tub' ? 'האמבטיה' : 'הקיט') + ' נסרק בברקן, ' + (p === 'tub' ? 'הקיט' : 'האמבטיה') + ' כבר שם'; }
      else if (p === 'kit' && o.stage === 'kit') { to = 'toBarkan'; note = 'הקיט נסרק בברקן'; }
    }
    if (k === 'loadA') { to = 'toAshdod'; note = 'נסרק בעלייה למשאית' + (o.stage === 'fitting' ? ' (האיבזור הסתיים)' : ''); }
    if (k === 'atA') { to = 'inspect'; note = 'נסרק בהגעה לאשדוד'; }
    var ev = { p: p, k: k, at: u[p + 'Loc'].t, by: me.email, byName: me.name || me.email };
    u.scans = (o.scans || []).concat([ev]).slice(-40);
    if (to && o.stage === 'kit') u.kitList = kitNow(o).map(function (x) { return { n: x.n, q: x.q, sku: x.sku || '', done: false }; });
    if (to) { var e2 = event(to, note); u.stage = to; u.stageAt = e2.at; u.hold = null; u.history = (o.history || []).concat([e2]); }
    var prev = {}; Object.keys(u).forEach(function (key) { prev[key] = o[key] === undefined ? null : o[key]; });
    return col.doc(o.id).update(u).then(function () { return prev; });
  }
  // the scan screen: what happened, with undo; on a phone with a camera it keeps scanning
  var scanUi = { open: false, rows: [], cam: null, last: {} };
  function scanBox() {
    var b = $('scanBox'); if (!b) { b = document.createElement('div'); b.id = 'scanBox'; b.className = 'modal scanbox'; document.body.appendChild(b); b.addEventListener('click', onScanClick); }
    return b;
  }
  function renderScan() {
    var b = scanBox(); b.hidden = !scanUi.open; if (!scanUi.open) { b.innerHTML = ''; return; }
    var cam = !!scanUi.cam;
    if (!b.querySelector('.scan-card')) b.innerHTML = '<div class="modal-card scan-card" role="dialog" aria-modal="true" aria-labelledby="scTitle"><h2 id="scTitle">סריקת מדבקות</h2><div class="scan-cam"></div><div class="scan-msg" role="status"></div><ul class="scan-rows"></ul><div class="row"><button class="btn big" type="button" data-scan="close">סגירה</button></div></div>';
    var camBox = b.querySelector('.scan-cam');
    if (cam && !camBox.querySelector('video')) camBox.appendChild(scanUi.cam.video);
    camBox.hidden = !cam;
    b.querySelector('.scan-msg').innerHTML = scanUi.msg || (cam ? 'מכוונים את המצלמה אל המדבקה.' : '');
    b.querySelector('.scan-rows').innerHTML = scanUi.rows.map(function (r, i) {
      return '<li class="' + r.cls + '"><div><b>' + esc(r.head) + '</b><div>' + r.text + '</div></div>' +
        (r.prev && !r.undone ? '<button class="btn small" type="button" data-scan="undo" data-i="' + i + '">ביטול</button>' : '') +
        (r.choices ? r.choices.map(function (c) { return '<button class="btn small primary" type="button" data-scan="do" data-i="' + i + '" data-k="' + c.k + '">' + esc(c.n) + '</button>'; }).join('') : '') + '</li>';
    }).join('');
  }
  function beep(ok) { try { var C = window.AudioContext || window.webkitAudioContext; scanUi.ac = scanUi.ac || new C(); var ac = scanUi.ac, os = ac.createOscillator(), g = ac.createGain(); os.frequency.value = ok ? 1200 : 300; g.gain.value = 0.15; os.connect(g); g.connect(ac.destination); os.start(); os.stop(ac.currentTime + (ok ? 0.12 : 0.35)); } catch (e) {} }
  function handleScan(text) {
    var s = parseScan(text); scanUi.open = true;
    if (!s) { scanUi.rows.unshift({ cls: 'bad', head: 'קוד לא מוכר', text: 'זו לא מדבקה של המערכת.' }); beep(false); renderScan(); return; }
    var o = st.all.find(function (x) { return x.id === s.id; });
    var head = PART_N[s.p] + (o && o.tubNum ? ' · ' + o.tubNum : '');
    if (!o) { scanUi.rows.unshift({ cls: 'bad', head: head, text: 'ההזמנה לא נמצאה (אולי נמחקה).' }); beep(false); renderScan(); return; }
    var who = esc(titleOf(o)) + ' · ' + esc(omodel(o));
    if (me.role === 'agent') { scanUi.rows.unshift({ cls: '', head: head, text: who + '<br>' + esc(scanState(o, s.p)) }); renderScan(); return; }
    var acts = scanActs(o, s.p), mine = acts.filter(function (a) { return a.who.indexOf(me.role) > -1; });
    if (!acts.length) { scanUi.rows.unshift({ cls: 'warn', head: head, text: who + '<br>' + esc(scanState(o, s.p)) }); beep(false); renderScan(); return; }
    if (!mine.length && (isAdmin() || me.role === 'office')) { // choose what happened
      scanUi.rows.unshift({ cls: 'ask', head: head, text: who + '<br>מה קרה עם ה' + PART_N[s.p] + '?', choices: acts, o: o, p: s.p }); beep(true); renderScan(); return; }
    if (!mine.length) { scanUi.rows.unshift({ cls: 'warn', head: head, text: who + '<br>' + esc(scanState(o, s.p)) + '<br>הסריקה הבאה צפויה אצל: ' + acts.map(function (a) { return a.who.map(function (w) { return ROLES[w]; }).join(' / '); }).join(' או ') }); beep(false); renderScan(); return; }
    runAct({ cls: 'ok', head: head, who: who, o: o, p: s.p }, mine[0]);
  }
  function runAct(row, act) {
    row.text = row.who + '<br>' + esc(act.n) + '…'; row.cls = 'ok'; row.choices = null;
    if (scanUi.rows.indexOf(row) < 0) scanUi.rows.unshift(row); renderScan();
    scanApply(row.o, row.p, act.k).then(function (prev) { row.prev = prev; row.text = row.who + '<br>✓ ' + esc(act.n); beep(true); renderScan(); },
      function () { row.cls = 'bad'; row.text = row.who + '<br>הסריקה לא נשמרה. בדקו את החיבור ונסו שוב.'; beep(false); renderScan(); });
  }
  function onScanClick(ev) {
    var b = ev.target.closest('button[data-scan]'); if (!b) return; var r = scanUi.rows[+b.dataset.i];
    if (b.dataset.scan === 'close') { stopCam(); scanUi.open = false; scanUi.rows = []; scanUi.msg = ''; renderScan(); return; }
    if (b.dataset.scan === 'undo' && r && r.prev) { b.disabled = true; col.doc(r.o.id).update(r.prev).then(function () { r.undone = true; r.cls = ''; r.text += ' · <b>בוטל</b>'; renderScan(); }, function () { r.text += ' · הביטול לא נשמר'; renderScan(); }); return; }
    if (b.dataset.scan === 'do' && r) { var o = st.all.find(function (x) { return x.id === r.o.id; }) || r.o, act = (scanActs(o, r.p).filter(function (a) { return a.k === b.dataset.k; }))[0]; if (!act) return; r.o = o; r.who = esc(titleOf(o)) + ' · ' + esc(omodel(o)); runAct(r, act); }
  }
  // camera scanning, where the browser can read QR codes itself (Chrome on Android)
  function canCam() { return 'BarcodeDetector' in window && navigator.mediaDevices && navigator.mediaDevices.getUserMedia; }
  async function openScanner() {
    scanUi.open = true; scanUi.msg = ''; renderScan();
    if (!canCam()) { scanUi.msg = 'בטלפון הזה סורקים עם אפליקציית המצלמה הרגילה: מכוונים אל המדבקה ולוחצים על הקישור שמופיע. המערכת תיפתח ותרשום את הסריקה.'; renderScan(); return; }
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      var video = document.createElement('video'); video.setAttribute('playsinline', ''); video.muted = true; video.srcObject = stream; await video.play();
      var det = new window.BarcodeDetector({ formats: ['qr_code'] });
      scanUi.cam = { video: video, stream: stream, timer: null }; renderScan();
      var tick = async function () {
        if (!scanUi.cam) return;
        try { var codes = await det.detect(video); codes.forEach(function (c) { var t = c.rawValue, now = Date.now(); if (scanUi.last[t] && now - scanUi.last[t] < 5000) return; scanUi.last[t] = now; handleScan(t); }); } catch (e) {}
        if (scanUi.cam) scanUi.cam.timer = setTimeout(tick, 250);
      };
      tick();
    } catch (e) { scanUi.msg = 'אין גישה למצלמה. צריך לאשר לדפדפן להשתמש במצלמה, או לסרוק עם אפליקציית המצלמה הרגילה.'; renderScan(); }
  }
  function stopCam() { var c = scanUi.cam; scanUi.cam = null; if (!c) return; clearTimeout(c.timer); try { c.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} }
  // what is on the truck right now (scanned on, not yet scanned off)
  function truckList() {
    var out = []; st.all.forEach(function (o) { if (kindOf(o) !== 'jacuzzi' || o.stage === 'delivered') return;
      ['tub', 'kit'].forEach(function (p) { var l = o[p + 'Loc']; if (!l || (l.at !== 'truckB' && l.at !== 'truckA')) return;
        if (p === 'kit' && o.rcvKit) return; if (p === 'tub' && l.at === 'truckB' && o.rcvTub) return; if (l.at === 'truckA' && o.stage !== 'toAshdod') return;
        out.push({ o: o, p: p, l: l }); }); });
    return out;
  }
  function truckHtml() {
    if (!me || me.role === 'agent' || st.kind !== 'jacuzzi') return '';
    var t = truckList(); if (!t.length) return '';
    return '<div class="alert truck"><strong>על המשאית עכשיו (' + t.length + ')</strong><ul>' + t.map(function (x) {
      var late = (Date.now() - new Date(x.l.t)) > 20 * 3600 * 1000;
      return '<li><button type="button" class="alink" data-open="' + esc(x.o.id) + '">' + PART_N[x.p] + (x.o.tubNum ? ' ' + esc(x.o.tubNum) : '') + ' · ' + esc(titleOf(x.o)) + ' · ' + esc(omodel(x.o)) + '</button> <span class="who">' + (x.l.at === 'truckB' ? 'לברקן' : 'לאשדוד') + ' · עלה ' + fmt(x.l.t) + (x.l.byName ? ' · ' + esc(x.l.byName) : '') + '</span>' + (late ? ' <span class="chip hold">עלה ולא נסרק בירידה</span>' : '') + '</li>'; }).join('') + '</ul></div>';
  }
  // stickers: 100 x 150 mm, portrait, one per page
  function stickerHtml(o, p) {
    return '<div class="stk"><div class="stk-top"><span class="stk-brand">MTI</span><span class="stk-part">' + PART_N[p] + '</span></div>' +
      '<div class="stk-num">' + esc(o.tubNum || '----') + '</div><div class="stk-model">' + esc(mname(o.model)) + (o.system ? ' · ' + esc(o.system) : '') + '</div>' + (sideOf(o) ? '<div class="stk-side">' + sideTxt(o) + '</div>' : '') +
      '<div class="stk-qr">' + MTIQR.svg(scanUrl(o, p)) + '</div>' +
      '<div class="stk-foot">' + (o.num ? 'הזמנה ' + esc(o.num) + ' · ' : '') + 'לסרוק בכל העמסה ופריקה</div></div>';
  }
  function printStickers(o, parts) {
    // the kit always goes out with 3 stickers (one per box), the tub with one
    var pages = []; parts.forEach(function (p) { for (var c = 0; c < (p === 'kit' ? 3 : 1); c++) pages.push(stickerHtml(o, p)); });
    $('printArea').innerHTML = '<div class="stks">' + pages.join('') + '</div>';
    var ps = document.createElement('style'); ps.id = 'pageSize'; ps.textContent = '@page { size: 100mm 150mm; margin: 0; }'; document.head.appendChild(ps);
    var t = document.title; document.title = 'מדבקות ' + (o.tubNum || ''); window.print(); document.title = t;
    setTimeout(function () { ps.remove(); }, 1500);
  }
  // second page of the fitter's sheet: A4 cut into 4 tags with the serial and the model, to stick on the tub
  function tagPage(o) {
    var sm = SPA_MODEL[o.model], code = sm ? ((sm.name.match(/MTI-\d+/) || [''])[0]) : (o.model || '');
    code = code.replace(/^MTI-?\s*/, 'MTI - ');
    var one = '<div class="p-tag"><div class="p-tag-in"><div class="p-tag-n"><small>#</small>' + esc(o.tubNum || '') + '</div><div class="p-tag-m">' + esc(code) + '</div></div></div>';
    return '<div class="p-tags">' + one + one + one + one + '</div>';
  }
  // A4 sheet of one order's kit, sent to the browser's print dialog (where it can also be saved as PDF)
  function printKit(o) {
    var lines = o.stage === TR.kitStage ? kitNow(o) : !(o.kitList && o.kitList.length) ? kitDraft(o) : o.kitList, sk = o.sketch || {};
    var facts = kindOf(o) === 'spa' ? [['לקוח', o.customer], ['הזמנה באינטגרל', o.num], ['מספר סידורי', o.tubNum], ['דגם', mname(o.model)], ['איבזור', o.equipName], ['מקום האיבזור', pick(SPA.equipLocs, o.equipLoc)], ['סוכן', o.agent]].filter(function (f) { return f[1]; }) : [['חנות', o.store], ['לקוח', o.customer], ['הזמנה באינטגרל', o.num], ['מספר סידורי', o.tubNum], ['דגם', mname(o.model)], ['מערכת', o.system], ['כיוון', sk.side === 'R' ? 'ימין' : sk.side === 'L' ? 'שמאל' : ''], ['פנס', sk.light === true ? 'יש' : sk.light === false ? 'אין' : ''], ['פאנל', o.panel ? 'כן (מורכב באשדוד)' : 'לא'], ['סוכן', o.agent]].filter(function (f) { return f[1]; });
    var d = new Date(), date = d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
    $('printArea').innerHTML = '<div class="p-head"><div><div class="p-brand">MTI</div><h1>הזמנת קיט ל' + (kindOf(o) === 'spa' ? 'ספא' : 'ג\'קוזי') + '</h1></div><div class="p-date">' + date + '</div></div>' +
      '<div class="p-facts">' + facts.map(function (f) { return '<div><span>' + esc(f[0]) + '</span><b>' + esc(f[1]) + '</b></div>'; }).join('') + '</div>' +
      '<table class="p-kit"><thead><tr><th class="c">#</th><th>מק"ט</th><th>פריט</th><th class="c">כמות</th></tr></thead><tbody>' +
      lines.map(function (x, i) { return '<tr><td class="c">' + (i + 1) + '</td><td class="p-sku">' + esc(x.sku || '') + '</td><td>' + esc(x.n) + '</td><td class="c q">' + esc(x.q) + '</td></tr>'; }).join('') + '</tbody></table>' +
      (o.notes ? '<p class="p-notes"><b>הערות להזמנה:</b> ' + esc(o.notes) + '</p>' : '') + (sk.notes ? '<p class="p-notes"><b>הערות למאבזר:</b> ' + esc(sk.notes) + '</p>' : '') +
      '<div class="p-sign"><div>הוכן על ידי: ____________________</div><div>תאריך: ______________</div><div>חתימה: ______________</div></div>';
    var t = document.title; document.title = 'קיט ' + (o.tubNum || '') + ' ' + titleOf(o);
    window.print(); document.title = t;
  }
  // The customer approved through the link: move the order on, once, whichever office screen sees it first.
  function autoApprove(orderId, token, a) {
    var ref = col.doc(orderId);
    db.runTransaction(async function (tx) {
      var s = await tx.get(ref); if (!s.exists) return; var o = s.data();
      if (o.stage !== 'approval' || o.approvalToken !== token) return;
      var ev = { s: 'kit', at: new Date().toISOString(), byName: 'הלקוח', note: 'אושר בקישור' + (a.answeredName ? ' על ידי ' + a.answeredName : '') };
      tx.update(ref, { stage: 'kit', stageAt: ev.at, hold: null, history: (o.history || []).concat([ev]) });
    }).catch(function () {});
  }
  function custAnswer(o) { var a = st.appr[o.id]; return a && a.token === o.approvalToken && IDX[o.stage] <= IDX.approval ? a : null; }
  // A small dialog that explains what a button will do, with a final confirm. Escape, the backdrop or "ביטול" cancel.
  function ask(title, body, okText, danger) {
    return new Promise(function (resolve) {
      var box = $('confirmBox'); if (!box) { box = document.createElement('div'); box.id = 'confirmBox'; box.className = 'modal'; document.body.appendChild(box); }
      box.innerHTML = '<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="cfTitle"><h2 id="cfTitle">' + esc(title) + '</h2><div class="modal-body">' + body + '</div>' +
        '<div class="row"><button class="btn ' + (danger ? 'danger' : 'primary') + ' big" type="button" data-cf="1">' + esc(okText) + '</button><button class="btn big" type="button" data-cf="0">ביטול</button></div></div>';
      box.hidden = false;
      var prev = document.activeElement;
      function done(v) { box.hidden = true; box.innerHTML = ''; document.removeEventListener('keydown', key); box.onclick = null; if (prev && prev.focus) try { prev.focus(); } catch (e) {} resolve(v); }
      function key(ev) { if (ev.key === 'Escape') done(false); }
      document.addEventListener('keydown', key);
      box.onclick = function (ev) { var b = ev.target.closest('[data-cf]'); if (b) done(b.dataset.cf === '1'); else if (ev.target === box) done(false); };
      box.querySelector('[data-cf="0"]').focus();
    });
  }
  function orderLine(o) { var ids = [o.tubNum ? 'סידורי ' + esc(o.tubNum) : '', o.num ? 'הזמנה ' + esc(o.num) : ''].filter(Boolean).join(' · '); return '<div><strong>' + esc(titleOf(o)) + '</strong>' + (ids ? '<div class="who">' + ids + '</div>' : '') + '</div>'; }
  function stepLine(from, to) { return '<div class="cf-step"><span>' + esc(from) + '</span><span aria-hidden="true">←</span><strong>' + esc(to) + '</strong></div>'; }
  function arm(key) { if (st.armed[key]) { st.armed[key] = false; return true; } st.armed[key] = true; setTimeout(function () { if (st.armed[key]) { st.armed[key] = false; st.usersDirty = true; render(); } }, 3500); st.usersDirty = true; render(); return false; }

  function openSketch(o) {
    var model = drawModel(o); if (!model) return;
    var edit = canDraw(o), spa = kindOf(o) === 'spa';
    st.sketchId = o.id;
    if (spa) {
      Sketch.open($('sketchView'), { kind: 'spa', model: model, data: o.sketch || null, readOnly: !edit, title: titleOf(o) + (o.equipName ? ' · ' + o.equipName : ''),
        onClose: function () { st.sketchId = null; },
        readOnlyNote: IDX[o.stage] > IDX.tech ? 'השרטוט ננעל אחרי הבדיקה הטכנית.' : 'תצוגה בלבד.',
        onSave: function (data) { return col.doc(o.id).update({ sketch: data, sketchAt: new Date().toISOString() }); } });
      return;
    }
    Sketch.open($('sketchView'), {
      onClose: function () { st.sketchId = null; },
      model: model, system: o.system, data: o.sketch || null, readOnly: !edit || (!o.sketch && !edit),
      title: titleOf(o) + (o.num ? ' · הזמנה ' + o.num : ''),
      readOnlyNote: IDX[o.stage] > IDX.approval ? 'השרטוט אושר על ידי הלקוח ונעול לעריכה.' : 'תצוגה בלבד.',
      onSave: function (data, meta) {
        var token = o.approvalToken || newToken(), at = new Date().toISOString(), b = db.batch();
        b.update(col.doc(o.id), { sketch: data, sketchBlocking: !!meta.blocking, sketchAt: at, approvalToken: token, approvalSentAt: null });
        b.set(apCol.doc(token), { orderId: o.id, customer: o.customer || '', num: o.num || '', model: o.model, system: o.system || '', sketch: data, status: meta.blocking ? 'draft' : 'pending', updatedAt: at });
        o.approvalToken = token;
        if (!meta.blocking) st.scrollSend = true; // bring the send box into view once it appears
        return b.commit();
      }
    });
    refreshSketchSend();
  }

  $('sketchView').addEventListener('click', function (ev) { if (ev.target.closest('#skExtra')) onAct(ev); });
  $('list').addEventListener('click', onAct); $('side').addEventListener('click', onAct); $('alerts').addEventListener('click', onAct);
  function onAct(ev) {
    var a = ev.target.closest('a[data-send]'), o;
    if (a && (o = find(a.dataset.send))) { // the link itself opens WhatsApp / SMS / mail; here we only record that it was sent
      var upd = { approvalSentAt: new Date().toISOString(), approvalVia: a.dataset.ch };
      if (o.stage === 'drawing') { var ev2 = event('approval', 'נשלח ללקוח ב-' + a.dataset.ch); upd.stage = 'approval'; upd.stageAt = ev2.at; upd.history = (o.history || []).concat([ev2]); }
      col.doc(o.id).update(upd).catch(function () {});
      return;
    }
    var b = ev.target.closest('button'); if (!b || b.disabled) return; var d = b.dataset;
    if (d.reload) { hardReload(); return; }
    if (d.savetub && (o = find(d.savetub))) { var tv = $('tn-' + o.id).value.trim(), spaSer = kindOf(o) === 'spa'; if (!(spaSer ? /^\d{1,8}$/ : /^\d{4}$/).test(tv)) { $('banner').hidden = false; $('banner').textContent = spaSer ? 'מספר סידורי הוא ספרות בלבד.' : 'מספר סידורי הוא 4 ספרות.'; return; } document.activeElement && document.activeElement.blur(); write(o.id, function () { return col.doc(o.id).update({ tubNum: tv }); }); }
    else if (d.savecontact && (o = find(d.savecontact))) { var P = d.pfx || '', pv = $(P + 'ph-' + o.id).value.trim(), em = $(P + 'em-' + o.id).value.trim(); document.activeElement && document.activeElement.blur(); write(o.id, function () { return col.doc(o.id).update({ phone: pv, custEmail: em }); }); }
    else if (d.copy && (o = find(d.copy))) { var link = custLink(o); (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function () { b.textContent = 'הקישור הועתק'; }, function () { b.outerHTML = '<input readonly dir="ltr" value="' + esc(link) + '" onfocus="this.select()">'; }); }
    else if (d.edit && (o = find(d.edit))) { st.editId = o.id; st.form = false; st.usersOpen = false; $('form').innerHTML = ''; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    else if (d.open) { st.openId = st.openId === d.open ? null : d.open; st.holdFor = null; render(); if (WIDE) $('side').scrollTop = 0; }
    else if (d.sketch && (o = find(d.sketch))) { if (o.sketch || canDraw(o)) openSketch(o); }
    else if (d.next && (o = find(d.next))) { var nx = nextStage(o), cur = STAGES[IDX[o.stage]]; if (nx && canAct(cur)) (function (o, nx, cur) {
      var extra = o.stage === TR.kitStage ? '<div class="who">' + (kindOf(o) === 'spa' ? 'רשימת הקיט תינעל ותעבור למחסן כמו שהיא עכשיו.' : 'רשימת הקיט תינעל כמו שהיא עכשיו.') + '</div>' : nx.k === 'delivered' ? '<div class="who">ההזמנה תעבור לרשימת "סופקו".</div>' : '';
      ask(cur.done + '?', orderLine(o) + stepLine(cur.n, nx.n) + '<div class="who">מי ממשיך: ' + esc(nx.who || '—') + '</div>' + extra, 'כן, ' + cur.done).then(function (ok) { if (!ok) return;
        write(o.id, function () { return move(o, nx.k, null, o.stage === TR.kitStage ? { kitList: kitNow(o).map(function (x) { return { n: x.n, q: x.q, sku: x.sku || '', done: false }; }) } : null); }); });
    })(o, nx, cur); }
    else if (d.kitadd && (o = find(d.kitadd))) { var kn = $('kn-' + o.id).value.trim().slice(0, 80), kq = parseInt($('kq-' + o.id).value, 10) || 1, ks = $('ks-' + o.id).value.trim().slice(0, 20); if (!kn) return; document.activeElement && document.activeElement.blur(); write(o.id, function () { return col.doc(o.id).update({ kitExtra: (o.kitExtra || []).concat([{ n: kn, q: kq, sku: ks }]) }); }); }
    else if (d.kitdel && (o = find(d.kitdel))) { var ke = (o.kitExtra || []).slice(); ke.splice(+d.i, 1); write(o.id, function () { return col.doc(o.id).update({ kitExtra: ke }); }); }
    else if (d.rcv && (o = find(d.rcv))) (function (o, part, stock) {
      var other = part === 'rcvTub' ? 'rcvKit' : 'rcvTub', what = part === 'rcvTub' ? 'האמבטיה' : 'הקיט', both = !!o[other] && o.stage === 'toBarkan';
      ask(stock ? 'לקחת אמבטיה מהמלאי בברקן?' : part === 'rcvTub' ? 'האמבטיה התקבלה מאשדוד?' : 'הקיט התקבל בברקן?', orderLine(o) + (both ? stepLine(STAGES[IDX.toBarkan].n, STAGES[IDX.fitting].n) + '<div class="who">גם ' + (part === 'rcvTub' ? 'הקיט' : 'האמבטיה') + ' כבר בברקן, אז ההזמנה עוברת לאיבזור.</div>' : '<div class="who">' + (o[other] ? '' : 'עדיין מחכים ל' + (part === 'rcvTub' ? 'קיט' : 'אמבטיה') + '.') + '</div>') + (stock ? '<div class="who">לא צריך לשלוח אמבטיה מאשדוד.</div>' : ''), stock ? 'כן, יש במלאי' : 'כן, התקבל').then(function (ok) {
        if (!ok) return; var x = {}; x[part] = rcvMark(); if (stock) x[part].stock = true; if (part === 'rcvTub') x.tubMissing = null;
        write(o.id, function () { return both ? move(o, 'fitting', (stock || (o.rcvTub && o.rcvTub.stock) ? 'אמבטיה מהמלאי בברקן, הקיט התקבל' : 'האמבטיה והקיט התקבלו בברקן'), x) : col.doc(o.id).update(x); }); });
    })(o, d.part, !!d.stock);
    else if (d.tubmiss && (o = find(d.tubmiss))) (function (o) {
      ask('האמבטיה לא התקבלה בברקן?', orderLine(o) + '<p>ההזמנה תופיע במשרד ובמחסן אשדוד ברשימת "צריך לשלוח אמבטיה לברקן", עד שתסמנו כאן שהאמבטיה התקבלה.</p>', 'כן, לא התקבלה', true).then(function (ok) {
        if (ok) write(o.id, function () { return col.doc(o.id).update({ tubMissing: rcvMark() }); }); });
    })(o);
    else if (d.tubsent && (o = find(d.tubsent))) (function (o) {
      ask('האמבטיה נשלחה לברקן?', orderLine(o) + '<p>ההזמנה תישאר ברשימת המעקב עד שבברקן יאשרו שהאמבטיה התקבלה.</p>', 'כן, נשלחה').then(function (ok) {
        if (ok) write(o.id, function () { var m = Object.assign({}, o.tubMissing, { sentAt: new Date().toISOString(), sentBy: me.email, sentName: me.name || me.email }); return col.doc(o.id).update({ tubMissing: m }); }); });
    })(o);
    else if (d.rcvundo && (o = find(d.rcvundo))) (function (o, part) {
      ask('ביטול הקבלה', orderLine(o) + '<p>' + (part === 'rcvTub' ? 'האמבטיה' : 'הקיט') + ' יסומן שוב כ"עוד לא התקבל".</p>', 'כן, לבטל').then(function (ok) { if (!ok) return; var x = {}; x[part] = null; write(o.id, function () { return col.doc(o.id).update(x); }); });
    })(o, d.part);
    else if (d.kitprint && (o = find(d.kitprint))) printKit(o);
    else if (d.stk && (o = find(d.stk))) printStickers(o, d.parts.split(','));
    else if (d.skprint && (o = find(d.skprint))) printSketch(o);
    else if (d.skipappr && (o = find(d.skipappr))) (function (o) { ask('דילוג על אישור הלקוח', orderLine(o) + stepLine(STAGES[IDX[o.stage]].n, STAGES[IDX.kit].n) +
      '<p>משתמשים בזה רק כשהלקוח כבר אישר סקיצה עם ההזמנה. לא יישלח קישור לאישור, ובהיסטוריה יירשם שהאישור דולג.</p>' + (o.sketch ? '' : '<p class="who">אין שרטוט במערכת: את רשימת הקיט ממלאים ידנית.</p>'), 'כן, לדלג ולעבור להזמנת קיט').then(function (ok) {
      if (ok) write(o.id, function () { return move(o, 'kit', 'דילוג על אישור הלקוח: סקיצה מאושרת בהזמנה'); }); }); })(o);
    else if (d.fail && (o = find(d.fail))) (function (o) { ask('הבדיקה נכשלה?', orderLine(o) + stepLine(STAGES[IDX[o.stage]].n, STAGES[IDX.toBarkan].n) + '<p>הג\'קוזי חוזר לברקן לתיקון.</p>', 'כן, להחזיר לברקן', true).then(function (ok) {
      if (ok) write(o.id, function () { var k = rcvMark(); k.fix = true; return move(o, 'toBarkan', 'הבדיקה נכשלה, חוזר לברקן', { rcvTub: null, rcvKit: k }); }); }); })(o);
    else if (d.holdopen) { st.holdFor = d.holdopen; render(); }
    else if (d.hold && (o = find(d.hold))) {
      var reason = d.reason || (($('holdTxt') || {}).value || '').trim(); if (!reason) return;
      st.holdFor = null; write(o.id, function () { return col.doc(o.id).update({ hold: { reason: reason.slice(0, 80), at: new Date().toISOString(), by: me.email } }); });
    }
    else if (d.unhold && (o = find(d.unhold))) write(o.id, function () { return col.doc(o.id).update({ hold: null }); });
    else if (d.undo && (o = find(d.undo))) (function (o) { var hs = (o.history || []).slice(0, -1), last = hs[hs.length - 1]; if (!last) return;
      ask('חזרה שלב אחד', orderLine(o) + stepLine(STAGES[IDX[o.stage]] ? STAGES[IDX[o.stage]].n : o.stage, (STAGES[IDX[last.s]] || { n: last.s }).n) + '<p>העדכון האחרון בהיסטוריה יימחק.</p>', 'כן, לחזור שלב').then(function (ok) {
      if (ok) write(o.id, function () { var u = { stage: (kindOf(o) === 'jacuzzi' && J_OLD[last.s]) || last.s, stageAt: last.at, history: hs }; if (kindOf(o) === 'jacuzzi' && IDX[last.s] < IDX.toBarkan && o.rcvKit) u.rcvKit = null; return col.doc(o.id).update(u); }); }); })(o);
    else if (d.del && (o = find(d.del))) (function (o) { ask('מחיקת ההזמנה', orderLine(o) + '<p>ההזמנה, השרטוט וההיסטוריה שלה יימחקו לגמרי. אי אפשר לשחזר.</p>', 'כן, למחוק לצמיתות', true).then(function (ok) {
      if (ok) { if (st.openId === o.id) st.openId = null; write(o.id, function () { if (o.approvalToken) apCol.doc(o.approvalToken).delete().catch(function () {}); return col.doc(o.id).delete(); }); } }); })(o);
  }
  $('tiles').addEventListener('click', function (ev) { var b = ev.target.closest('[data-loc]'); if (!b) return; st.loc = st.loc === b.dataset.loc ? '' : b.dataset.loc; st.stageF = ''; st.tab = 'open'; render(); });
  $('tabs').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.tab) { st.tab = b.dataset.tab; if (st.tab === 'done') st.loc = ''; } else if (b.dataset.locClear) { st.loc = ''; st.stageF = ''; }
    render();
  });
  $('q').addEventListener('input', function () { st.q = this.value; renderList(new Date()); });
  $('agentSel').addEventListener('change', function () { st.agent = this.value; render(); });
  $('stageSel').addEventListener('change', function () { var v = this.value; if (v.indexOf('loc:') === 0) { st.loc = v.slice(4); st.stageF = ''; } else { st.stageF = v; st.loc = ''; } if (v) st.tab = 'open'; render(); });
  $('newBtn').addEventListener('click', function () { st.form = !st.form || !!st.editId; st.editId = null; st.usersOpen = false; $('form').innerHTML = ''; render(); if (st.form) $('nCust').focus(); });
  $('usersBtn').addEventListener('click', function () { st.usersOpen = !st.usersOpen; st.form = false; st.usersDirty = true; render(); });
  $('form').addEventListener('input', function (ev) {
    if (ev.target.id !== 'nTub' || st.kind !== 'jacuzzi' || st.editId) return;
    var auto = pad4(Math.max(st.nextSerial, serialFloor())), man = ev.target.value.trim() !== auto, w = $('nWarn');
    if (man) ev.target.dataset.manual = '1'; else delete ev.target.dataset.manual;
    w.hidden = !man; w.textContent = man ? 'מספר ידני (לג\'קוזי שכבר קיבל מספר). המספור האוטומטי ימשיך מ-' + auto + '.' : '';
  });
  $('form').addEventListener('change', function (ev) {
    if (ev.target.id === 'nTapFin') document.querySelectorAll('.pick[data-for="nTap"] button[data-val]').forEach(function (b) { var im = b.querySelector('img'); if (im) im.src = tapImg(b.dataset.val, ev.target.value); });
    var o = st.editId ? find(st.editId) : null;
    if (ev.target.id === 'nModel' && st.kind === 'spa') $('nEquip').innerHTML = equipOpts(ev.target.value, '');
    if (ev.target.id === 'nModel' && st.kind === 'jacuzzi' && o) { var w = $('nWarn'), ch = o.sketch && ev.target.value !== o.model; w.hidden = !ch; w.textContent = ch ? 'שינוי הדגם מוחק את השרטוט הקיים, וצריך לשרטט ולשלוח ללקוח מחדש.' : ''; }
  });
  function formValues() {
    var val = function (id) { var el = $(id); return el ? el.value.trim() : ''; }, on = function (id) { var el = $(id); return !!(el && el.checked); };
    var agentName = val('nAgent'), ag = users.find(function (u) { return u.role === 'agent' && u.name === agentName; });
    var d = { num: val('nNum'), customer: val('nCust'), store: val('nStore'), model: val('nModel'), phone: val('nPhone'), notes: val('nNotes'), agent: agentName, agentEmail: ag ? ag.email : '' };
    if (st.kind === 'spa') {
      var m = SPA_MODEL[d.model], en = val('nEquip'), eq = m && m.equip.find(function (e) { return e[1] === en; });
      Object.assign(d, { kind: 'spa', address: val('nAddr'), equipName: en, equip: eq ? eq[0] : '', acrylic: val('nAcrylic'), cabinet: val('nCabinet'), phase: val('nPhase'), install: val('nInstall'),
        shell: val('nShell'), equipLoc: val('nEquipLoc'), delivery: val('nDelivery'), controller: val('nController'), jetColor: val('nJetColor'), lightSides: parseInt(val('nLights'), 10) || 0,
        touch4: on('nTouch4'), ozone: on('nOzone'), uv: on('nUv'),
        jetSup: SPA.jetSuppliers.filter(function (n, k) { return on('nSup' + k); }), acc: SPA.accessories.filter(function (a, k) { return on('nAcc' + k); }).map(function (a) { return a[0]; }) });
    } else Object.assign(d, { system: val('nSys'), custEmail: val('nEmail'), panel: on('nPanel'),
      tap: val('nTap'), tapFin: val('nTapFin'), pillow: val('nPillow'), pillowColor: val('nPillowColor'), pillowQty: Math.max(1, Math.min(4, parseInt(val('nPillowQty'), 10) || 1)), waste: val('nWaste') });
    return d;
  }
  $('form').addEventListener('click', async function (ev) {
    var pb = ev.target.closest('.pick button[data-val]');
    if (pb) { var row = pb.closest('.pick'); $(row.dataset.for).value = pb.dataset.val; row.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === pb); }); return; }
    if (ev.target.id === 'nCancel') { st.form = false; st.editId = null; render(); return; }
    if (ev.target.id !== 'nSave') return;
    var d = formValues(), o = st.editId ? find(st.editId) : null;
    if (!d.customer && !d.num && !d.store) { $('nErr').textContent = 'צריך לפחות לקוח או מספר הזמנה.'; return; }
    var mdl = MODEL[d.model]; if (st.kind === 'jacuzzi' && mdl && d.system === 'TITANIUM' && mdl.jb && !mdl.jt) { $('nErr').textContent = 'לפי הקטלוג אין ל-' + mdl.code + ' מערכת TITANIUM.'; return; }
    var tub = st.kind === 'spa' && !o ? ($('nTub').value || '').trim() : ''; if (tub && !/^\d{1,8}$/.test(tub)) { $('nErr').textContent = 'מספר סידורי הוא ספרות בלבד.'; return; }
    ev.target.disabled = true;
    try {
      if (o) { // a changed model makes the old drawing meaningless: drop it and its customer link
        if (st.kind === 'jacuzzi' && o.sketch && d.model !== o.model) { if (o.approvalToken) apCol.doc(o.approvalToken).delete().catch(function () {}); Object.assign(d, { sketch: null, sketchBlocking: false, approvalToken: newToken(), approvalSentAt: null }); }
        await col.doc(o.id).update(d);
      } else {
        var ev0 = event(st.kind === 'spa' ? 'draft' : 'drawing');
        var order = Object.assign(d, { stage: ev0.s, stageAt: ev0.at, hold: null, history: [ev0], createdAt: ev0.at });
        if (st.kind === 'spa') { order.tubNum = tub; await col.add(order); }
        else {
          order.approvalToken = newToken();
          var tn = $('nTub'), manual = tn && tn.dataset.manual ? tn.value.trim() : '';
          if (tn && tn.dataset.manual) {
            if (!/^\d{4}$/.test(manual)) { ev.target.disabled = false; $('nErr').textContent = 'מספר סידורי הוא 4 ספרות.'; return; }
            var dup = st.all.find(function (x) { return kindOf(x) === 'jacuzzi' && x.tubNum === manual; });
            if (dup) { ev.target.disabled = false; $('nErr').textContent = 'המספר ' + manual + ' כבר קיים בהזמנה של ' + titleOf(dup) + '.'; return; }
            order.tubNum = manual; await col.add(order);
          } else
          // take the next serial and save the order together, so two people opening orders at once never get the same number
          await db.runTransaction(async function (tx) {
            var s = await tx.get(counterRef), n = Math.max(s.exists && s.data().serial ? s.data().serial : FIRST_SERIAL, serialFloor());
            order.tubNum = pad4(n);
            tx.set(col.doc(), order); tx.set(counterRef, { serial: n + 1 });
          });
        }
      }
      st.form = false; st.editId = null; render();
    } catch (e) { ev.target.disabled = false; $('nErr').textContent = 'ההזמנה לא נשמרה. נסו שוב.'; }
  });
  $('usersPanel').addEventListener('click', async function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    if (b.id === 'uClose') { st.usersOpen = false; render(); return; }
    if (b.dataset.udel) { if (arm('u' + b.dataset.udel)) { try { await usersCol.doc(b.dataset.udel).delete(); } catch (e) {} } return; }
    if (b.id !== 'uAdd') return;
    var email = $('uEmail').value.trim().toLowerCase(), name = $('uName').value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $('uErr').textContent = 'כתובת המייל לא תקינה.'; return; }
    try { await usersCol.doc(email).set({ role: $('uRole').value, name: name, createdAt: new Date().toISOString() }); $('uEmail').value = ''; $('uName').value = ''; $('uErr').textContent = ''; }
    catch (e) { $('uErr').textContent = 'המשתמש לא נשמר. נסו שוב.'; }
  });
  $('usersPanel').addEventListener('change', async function (ev) {
    var s = ev.target.closest('select[data-urole]'); if (!s) return;
    try { await usersCol.doc(s.dataset.urole).update({ role: s.value }); } catch (e) {}
  });
})();

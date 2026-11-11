// MTI jacuzzi tracking board. Sign-in with Google, a role per email, one card per order moving through the stations.
(function () {
  var APP_VERSION = '20261111-074025';
  var auth = firebase.auth(), db = firebase.firestore();

  // Stage targets are working days (Sun–Thu). Barkan is split into waiting and fitting on purpose:
  // fitting takes hours, the queue before it is where the days go.
  // `roles` = who may press the button that completes the stage (admin always may).
  var J_STAGES = [
    { k: 'request',    n: 'בקשת אספקה',           loc: 'a1',   who: 'משרד',        roles: ['office'],                        t: 1, done: 'מתחילים שרטוט ומפרט' },
    { k: 'drawing',    n: 'שרטוט ומפרט',          loc: 'a1',   who: 'משרד',        roles: ['office'],                        t: 1, done: 'השרטוט נשלח ללקוח' },
    { k: 'approval',   n: 'ממתין לאישור לקוח',    loc: 'a1',   who: 'משרד',        roles: ['office'],                        t: 3, done: 'הלקוח אישר את השרטוט' },
    { k: 'kitOrder',   n: 'הזמנת קיט למחסן',      loc: 'a1',   who: 'משרד',        roles: ['office'],                        t: 1, done: 'הזמנת הקיט הועברה למחסן' },
    { k: 'kit',        n: 'הכנת קיט במחסן',       loc: 'a1',   who: 'מחסן אשדוד',  roles: ['warehouse'],                     t: 1, done: 'הקיט מוכן והועמס לברקן' },
    { k: 'toBarkan',   n: 'בדרך לברקן',           loc: 'road', who: 'מנהל ברקן',   roles: ['barkan', 'driver'],              t: 1, done: 'התקבל בברקן' },
    { k: 'waitBarkan', n: 'ממתין לאיבזור בברקן',  loc: 'bk',   who: 'מנהל ברקן',   roles: ['barkan'],                        t: 3, done: 'התחלנו לאבזר' },
    { k: 'fitting',    n: 'באיבזור בברקן',        loc: 'bk',   who: 'מנהל ברקן',   roles: ['barkan'],                        t: 1, done: 'האיבזור הסתיים והועמס לאשדוד' },
    { k: 'toAshdod',   n: 'בדרך חזרה לאשדוד',     loc: 'road', who: 'מחסן אשדוד',  roles: ['warehouse', 'driver'],           t: 1, done: 'התקבל באשדוד' },
    { k: 'inspect',    n: 'בדיקה חיצונית',        loc: 'a2',   who: 'מחסן אשדוד',  roles: ['warehouse'],                     t: 1, done: 'הבדיקה עברה' },
    { k: 'pack',       n: 'אריזה מחדש',           loc: 'a2',   who: 'מחסן אשדוד',  roles: ['warehouse'],                     t: 1, done: 'ארוז ומוכן לאספקה' },
    { k: 'ready',      n: 'מוכן לאספקה',          loc: 'a2',   who: 'נהגים',       roles: ['driver', 'warehouse', 'office'], t: 2, done: 'סופק ללקוח' },
    { k: 'delivered',  n: 'סופק',                 loc: 'done', who: '',            roles: [],                                t: 0, done: '' }
  ];
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
    jacuzzi: { stages: J_STAGES, locs: J_LOCS, kitStage: 'kitOrder', kitFrom: 'kit', kitTo: 'fitting', word: "ג'קוזי" },
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
  var HOLDS = ['חסר חלק', 'ממתין ללקוח', 'תקלה באמבטיה'];
  var DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
  var MODELS = window.MTI_MODELS || [], MODEL = {}; MODELS.forEach(function (m) { MODEL[m.code] = m; });
  // what to show for a stored model code: the model name, plus the size when the model comes in more than one
  var SPA = window.MTI_SPA || { models: [] }, SPA_MODEL = {}; SPA.models.forEach(function (m) { SPA_MODEL[m.id] = m; });
  function pick(list, id) { var x = (list || []).find(function (p) { return p[0] === id; }); return x ? x[1] : ''; }
  function kindOf(o) { return o && o.kind === 'spa' ? 'spa' : 'jacuzzi'; }
  // stations a given order skips, and where an order stands (fitting in Ashdod counts as Ashdod)
  function skips(s, o) { return kindOf(o) === 'spa' && ((s.k === 'cladding' && o.install && o.install !== 'above') || (s.k === 'kitSent' && o.equipLoc === 'ashdod')); }
  function nextStage(o) { for (var j = IDX[o.stage] + 1; j < STAGES.length; j++) if (!skips(STAGES[j], o)) return STAGES[j]; return null; }
  function locOf(s, o) { return s.k === 'equip' && o.equipLoc === 'ashdod' ? 'a2' : s.loc; }
  function mname(code) { var sm = SPA_MODEL[code]; if (sm) return sm.name + ' · ' + sm.dims; var m = MODEL[code]; return !m ? (code || '') : m.name ? m.name + ' (' + m.dims + ')' : m.code; }

  var me = null, col = db.collection('orders'), usersCol = db.collection('users'), apCol = db.collection('approvals'), unsub = [], users = [];
  // Serial numbers run on their own: meta/counters.serial holds the next one to hand out.
  var counterRef = db.collection('meta').doc('counters'), FIRST_SERIAL = 9694;
  function pad4(n) { n = String(n); while (n.length < 4) n = '0' + n; return n; }
  var TOKEN = new URLSearchParams(location.search).get('a'), CUST_PAGE = /\/s\.html$/.test(location.pathname);
  // never hand out a serial that an existing order already carries (covers orders numbered before the counter existed, or by hand)
  function serialFloor() { var m = FIRST_SERIAL; st.all.filter(function (o) { return kindOf(o) === 'jacuzzi'; }).forEach(function (o) { var n = parseInt(o.tubNum, 10); if (n >= m && n < 100000) m = n + 1; }); return m; }
  function showSerial() { var el = $('nTub'); if (el) el.value = pad4(Math.max(st.nextSerial, serialFloor())); }
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
    st.form = false; st.editId = null; st.openId = null; st.loc = ''; st.tab = 'open'; $('form').innerHTML = '';
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
  function canDraw(o) { return isOffice() && IDX[o.stage] <= IDX.approval; }

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
      st.loaded = true; st.all = snap.docs.map(function (d) { var o = Object.assign({}, d.data()); o.id = d.id; return o; }); pickOrders(); render();
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
    var sel = $('agentSel'), keys = Object.keys(agents).sort();
    sel.hidden = me.role === 'agent' || !keys.length;
    sel.innerHTML = '<option value="">כל הסוכנים</option>' + keys.map(function (a) { return '<option value="' + esc(a) + '">' + esc(a) + '</option>'; }).join('');
    if (keys.indexOf(st.agent) < 0) st.agent = ''; sel.value = st.agent;
    var nDel = st.orders.filter(function (o) { return o.stage === 'delivered'; }).length;
    $('tabs').innerHTML =
      '<button class="btn small' + (st.tab === 'open' ? ' primary' : '') + '" type="button" data-tab="open">פתוחות (' + (st.orders.length - nDel) + ')</button>' +
      '<button class="btn small' + (st.tab === 'done' ? ' primary' : '') + '" type="button" data-tab="done">סופקו (' + nDel + ')</button>' +
      (st.loc ? '<button class="btn small" type="button" data-loc-clear="1">הצג את כל המקומות</button>' : '');
  }
  // where the tub is at a stage: a1 still in Ashdod, bk in Barkan, a2 back in Ashdod; a truck ride counts as its destination
  function phaseOf(k, o) { var j = IDX[k], s = STAGES[j]; while (s && s.loc === 'road' && STAGES[j + 1]) s = STAGES[++j]; return s ? locOf(s, o) : 'a1'; }
  function stepsBar(o) {
    var list = STAGES.filter(function (s) { return s.k !== 'delivered' && !skips(s, o); }), cur = list.findIndex(function (s) { return s.k === o.stage; });
    return '<div class="steps" aria-hidden="true">' + list.map(function (s, j) { return '<i class="' + (j < cur ? 'd' : j === cur ? 'c' : '') + '" style="--pc:' + LOCC[phaseOf(s.k, o)] + '"></i>'; }).join('') + '</div>';
  }
  function cardHtml(x) {
    var o = x.o, f = x.f, del = o.stage === 'delivered', open = st.openId === o.id;
    var chips = '<span class="chip' + (del ? ' ok' : '') + '">' + f.s.n + '</span>';
    if (f.hold) chips += '<span class="chip hold">מעוכב: ' + esc(o.hold.reason) + '</span>';
    else if (f.late) chips += '<span class="chip late">חריגה של ' + dayWord(f.over) + '</span>';
    var ca = custAnswer(o);
    if (ca && ca.status === 'changes') chips += '<span class="chip hold">הלקוח ביקש שינוי</span>';
    else if (o.stage === 'approval' && o.approvalSentAt) chips += '<span class="chip">נשלח ללקוח</span>';
    var eta = del ? 'סופק ב-' + fmt(o.stageAt) : f.hold ? 'אספקה צפויה: לא ידוע עד שהעיכוב יוסר'
      : 'בשלב הזה ' + dayWord(f.el) + ' · אספקה צפויה יום ' + DAYS[f.eta.getDay()] + "' " + pad(f.eta.getDate()) + '/' + pad(f.eta.getMonth() + 1);
    var meta = (kindOf(o) === 'spa' ? [mname(o.model), o.equipName, o.acrylic ? 'אקריל ' + pick(SPA.acrylics, o.acrylic) : '', o.cabinet ? 'חיפוי ' + pick(SPA.cabinets, o.cabinet) : '']
      : [mname(o.model), o.system, o.panel ? 'כולל פאנל' : '']).concat([o.agent ? 'סוכן: ' + o.agent : '']).filter(Boolean).map(esc).join(' · ');
    var h = '<div class="card' + (f.hold ? ' hold' : f.late ? ' late' : '') + '" style="--lc:' + LOCC[f.loc] + '"><button type="button" data-open="' + esc(o.id) + '" aria-expanded="' + open + '">' +
      '<div class="c-top"><span class="c-cust">' + esc(titleOf(o)) + '</span><span class="c-num">' + [o.tubNum ? 'סידורי ' + esc(o.tubNum) : '', o.num ? 'הזמנה ' + esc(o.num) : ''].filter(Boolean).join(' · ') + '</span></div>' +
      (meta ? '<div class="c-meta">' + meta + '</div>' : '') + '<div class="c-stage">' + chips + '</div>' + (del ? '' : stepsBar(o)) + '<div class="c-eta">' + eta + '</div></button>';
    if (open) h += detailHtml(o, f);
    return h + '</div>';
  }
  function detailHtml(o, f) {
    var id = esc(o.id), busy = st.busy[o.id] ? ' disabled' : '', del = o.stage === 'delivered', h = '<div class="detail">';
    if (o.notes) h += '<div class="notes">' + esc(o.notes) + '</div>';
    if (kindOf(o) === 'spa') h += spaSpec(o);
    if (isOffice() && !del) h += '<button class="btn" type="button" data-edit="' + id + '">עריכת פרטי ההזמנה</button>';
    if (canWrite()) h += '<div class="row tubrow"><label for="tn-' + id + '">מספר סידורי</label><input id="tn-' + id + '" inputmode="numeric" maxlength="' + (kindOf(o) === 'spa' ? 8 : 4) + '" autocomplete="off" value="' + esc(o.tubNum || '') + '"><button class="btn small" type="button" data-savetub="' + id + '">שמור</button></div>';
    if (MODEL[o.model]) h += '<button class="btn" type="button" data-sketch="' + id + '">' + (o.sketch ? (canDraw(o) ? 'עריכת השרטוט' : 'צפייה בשרטוט') : (canDraw(o) ? 'יצירת שרטוט' : 'אין עדיין שרטוט')) + '</button>';
    if (MODEL[o.model] && o.sketch && me.role !== 'agent') h += '<button class="btn" type="button" data-skprint="' + id + '">הדפסת סקיצה למאבזר</button>';
    h += sendBox(o, '');
    if (f.unknown) return h + '<div class="issue warn">המסך הזה פועל בגרסה ישנה ולא מכיר את השלב של ההזמנה. <button class="btn small" type="button" data-reload="1">רענון</button></div></div>';
    if (!del) h += kitHtml(o, f);
    if (!del && canWrite()) {
      h += '<div class="who">מי מעדכן עכשיו: ' + f.s.who + '</div>';
      if (f.hold) h += '<button class="btn primary big" type="button" data-unhold="' + id + '"' + busy + '>העיכוב הוסר, ממשיכים</button>';
      else {
        if (canAct(f.s)) {
          var blockTxt = '';
          if (f.s.k === TR.kitStage && !kitDraft(o).length) blockTxt = 'הרשימה ריקה. מוסיפים לפחות פריט אחד.';
          if (f.s.k === 'tech' && (!o.shell || !o.equipLoc || !o.install)) blockTxt = 'לפני האישור בוחרים סוג התקנה, מקור קליפה ומקום איבזור (בעריכת פרטי ההזמנה).';
          if (f.s.k === 'approval' && MODEL[o.model]) { if (!o.sketch) blockTxt = 'אי אפשר לאשר לפני שיש שרטוט.'; else if (o.sketchBlocking) blockTxt = 'בשרטוט יש בעיה מסומנת באדום. צריך לתקן לפני אישור.'; }
          h += '<button class="btn primary big" type="button" data-next="' + id + '"' + (busy || (blockTxt ? ' disabled' : '')) + '>' + f.s.done + (f.s.k === 'pack' && o.panel ? ' (כולל פאנל)' : '') + '</button>';
          if (blockTxt) h += '<div class="who">' + blockTxt + '</div>';
          if (f.s.k === 'inspect') h += '<button class="btn danger" type="button" data-fail="' + id + '"' + busy + '>' + (st.armed['fail' + o.id] ? 'ללחוץ שוב: חוזר לברקן' : 'הבדיקה נכשלה, חוזר לברקן') + '</button>';
        }
        if (st.holdFor === o.id) {
          h += '<div class="holdbox"><strong>מה מעכב?</strong><div class="row">' + HOLDS.map(function (r) { return '<button class="btn small" type="button" data-hold="' + id + '" data-reason="' + r + '">' + r + '</button>'; }).join('') + '</div>' +
            '<div class="row" style="flex-wrap:nowrap"><input id="holdTxt" placeholder="סיבה אחרת" autocomplete="off" aria-label="סיבה אחרת"><button class="btn small" type="button" data-hold="' + id + '">שמור</button></div></div>';
        } else h += '<button class="btn" type="button" data-holdopen="' + id + '"' + busy + '>דיווח על עיכוב</button>';
      }
    }
    h += '<div><h2 style="margin-bottom:6px">מה קרה עד עכשיו</h2><ul class="tl">' + (o.history || []).map(function (e) {
      var s = STAGES[IDX[e.s]] || { n: e.s };
      return '<li><time>' + fmt(e.at) + '</time><span>' + esc(s.n) + (e.byName ? ' · ' + esc(e.byName) : '') + (e.note ? ' · <span class="note">' + esc(e.note) + '</span>' : '') + '</span></li>';
    }).join('') + '</ul></div>';
    var tools = '';
    if (isOffice() && (o.history || []).length > 1) tools += '<button class="btn small" type="button" data-undo="' + id + '"' + busy + '>' + (st.armed['undo' + o.id] ? 'ללחוץ שוב כדי לחזור שלב' : 'חזרה שלב אחד') + '</button>';
    if (isAdmin()) tools += '<button class="btn small danger" type="button" data-del="' + id + '"' + busy + '>' + (st.armed['del' + o.id] ? 'ללחוץ שוב כדי למחוק' : 'מחיקת ההזמנה') + '</button>';
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
        fInp('nCust', 'לקוח/ה', v('customer')) + fInp('nStore', 'חנות (רק אם ההזמנה דרך חנות)', v('store')) + fInp('nPhone', 'טלפון הלקוח', v('phone'), ' inputmode="tel" dir="ltr"') + fInp('nAddr', 'כתובת', v('address')) + agentSel +
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
        (o ? '' : '<label for="nTub">מספר סידורי (ניתן אוטומטית)<input id="nTub" readonly value="' + pad4(Math.max(st.nextSerial, serialFloor())) + '"></label>') +
        fInp('nStore', 'חנות', v('store')) + fInp('nCust', 'לקוח (לא חובה)', v('customer')) +
        fSel('nModel', 'דגם אמבטיה', MODELS.map(function (m) { return [m.code, (m.name || m.code) + ' · ' + m.dims]; }), v('model'), 'בחירת דגם') +
        fSel('nSys', 'מערכת', [['BASIC', 'BASIC'], ['TITANIUM', 'TITANIUM'], ['אחר', 'אחר']], v('system') || 'BASIC') + agentSel +
        fInp('nPhone', 'טלפון הלקוח', v('phone'), ' inputmode="tel" dir="ltr"') + fInp('nEmail', 'מייל הלקוח', v('custEmail'), ' type="email" dir="ltr"') +
        fChk('nPanel', 'הלקוח הזמין פאנל', v('panel'));
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
    if (a && ($('list').contains(a) || $('usersPanel').contains(a) || ($('sketchView').querySelector('#skExtra') || $('list')).contains(a)) && (a.tagName === 'INPUT')) { pending = true; return; }
    pending = false;
    var now = new Date();
    $('newBtn').hidden = !isOffice(); $('usersBtn').hidden = !isAdmin(); applyKind();
    $('banner').hidden = me.role !== 'agent'; if (me.role === 'agent') $('banner').textContent = 'תצוגה בלבד: כאן רואים איפה כל ' + TR.word + ' של הלקוחות שלך ומתי הוא צפוי לרדת.';
    renderTiles(now); renderFilters(); renderForm(); renderUsers(); renderList(now); refreshSketchSend();
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
  function move(o, key, note, extra) { var ev = event(key, note), u = { stage: key, stageAt: ev.at, hold: null, history: (o.history || []).concat([ev]) }; if (extra) Object.keys(extra).forEach(function (k) { u[k] = extra[k]; }); return col.doc(o.id).update(u); }
  // Kit order: what the warehouse has to pick. Until the office hands it over it follows the drawing plus lines the
  // office added by hand; at hand-over it is frozen into o.kitList, where the warehouse ticks each line.
  // the spa kit for now: the equipment level by its item number, plus the options that were ordered (exact lists to follow)
  function kitBase(o) {
    if (kindOf(o) !== 'spa') return Sketch.kitOf(o.sketch);
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
  function kitDraft(o) { var l = kitBase(o); return l.concat((o.kitExtra || []).map(function (x, i) { return { n: x.n, q: x.q, sku: x.sku || '', extra: i }; })); }
  function skuHtml(x) { return x.sku ? '<span class="sku">מק"ט ' + esc(x.sku) + '</span>' : ''; }
  function kitHtml(o, f) {
    var id = esc(o.id), k = f.s.k, h = '';
    if (k === TR.kitStage && isOffice()) {
      var lines = kitDraft(o);
      h += '<div class="kitbox"><strong>הזמנת קיט למחסנאי</strong>' + (o.sketch || kindOf(o) === 'spa' ? '' : '<div class="st">אין שרטוט שמור, אז הרשימה לא נגזרת אוטומטית. מוסיפים פריטים ידנית.</div>') +
        '<ul class="kitlist">' + lines.map(function (x) { return '<li><span class="q">' + esc(x.q) + '</span><span class="n">' + esc(x.n) + skuHtml(x) + '</span>' + (x.extra != null ? '<button class="btn small danger" type="button" data-kitdel="' + id + '" data-i="' + x.extra + '">הסר</button>' : '') + '</li>'; }).join('') + '</ul>' +
        '<div class="row"><input id="kn-' + id + '" placeholder="פריט נוסף" aria-label="פריט נוסף" autocomplete="off"><input id="ks-' + id + '" class="skuin" inputmode="numeric" placeholder="מק&quot;ט" aria-label="מק&quot;ט" autocomplete="off"><input id="kq-' + id + '" class="qty" inputmode="numeric" value="1" aria-label="כמות"><button class="btn small" type="button" data-kitadd="' + id + '">הוספה</button></div>' + '<div class="row"><button class="btn" type="button" data-kitprint="' + id + '">הורדת PDF / הדפסה</button></div>' + '</div>';
    } else if (o.kitList && o.kitList.length && IDX[k] >= IDX[TR.kitFrom] && IDX[k] <= IDX[TR.kitTo]) {
      h += '<div class="kitbox"><strong>' + (k === TR.kitFrom ? 'רשימת הקיט להכנה' : 'הקיט שנשלח') + '</strong>' +
        '<ul class="kitlist">' + o.kitList.map(function (x) { return '<li><span class="q">' + esc(x.q) + '</span><span class="n">' + esc(x.n) + skuHtml(x) + '</span></li>'; }).join('') + '</ul>' +
        '<div class="row"><button class="btn" type="button" data-kitprint="' + id + '">הורדת PDF / הדפסה</button></div></div>';
    }
    return h;
  }
  // A4 sheet for the fitter in Barkan, who works without a screen: the jacuzzi number, the drawing and which jets go in. No customer details.
  function printSketch(o) {
    var model = MODEL[o.model], sk = o.sketch; if (!model || !sk) return;
    var tmp = document.createElement('div'); tmp.style.display = 'none'; document.body.appendChild(tmp);
    Sketch.open(tmp, { model: model, system: o.system, data: sk, readOnly: true });
    var svg = tmp.querySelector('#skSvg').outerHTML.replace('id="skSvg"', '');
    tmp.querySelector('#skClose').click(); tmp.remove();
    var parts = Sketch.kitOf(sk).filter(function (x) { return /^ג'ט|^מנוע|^פנס|^יניקה|^ברז|^מזלף/.test(x.n); });
    var facts = [['דגם', mname(o.model) + ' · ' + model.dims], ['מערכת', o.system], ['כיוון', !model.sides ? '' : sk.side === 'R' ? 'ימין' : sk.side === 'L' ? 'שמאל' : ''], ['פנס', sk.light === true ? 'יש' : 'אין'], ['פאנל', o.panel ? 'כן' : '']].filter(function (f) { return f[1]; });
    $('printArea').innerHTML = '<div class="p-head"><div><div class="p-brand">MTI</div><h1>סקיצה לאיבזור</h1></div><div class="p-serial"><span>ג\'קוזי מס\'</span><b>' + esc(o.tubNum || '') + '</b></div></div>' +
      '<div class="p-facts">' + facts.map(function (f) { return '<div><span>' + esc(f[0]) + '</span><b>' + esc(f[1]) + '</b></div>'; }).join('') + '</div>' +
      '<div class="p-sketch">' + svg + '</div>' +
      '<table class="p-kit"><thead><tr><th>פריט</th><th class="c">כמות</th></tr></thead><tbody>' + parts.map(function (x) { return '<tr><td>' + esc(x.n) + '</td><td class="c q">' + esc(x.q) + '</td></tr>'; }).join('') + '</tbody></table>' +
      (sk.notes ? '<p class="p-notes"><b>הערות למאבזר:</b> ' + esc(sk.notes) + '</p>' : '');
    var t = document.title, img = $('printArea').querySelector('image'), go = function () { document.title = 'סקיצה ' + (o.tubNum || ''); window.print(); document.title = t; };
    // wait for the tub picture so it is on the paper
    if (img) { var pre = new Image(), fired = false, once = function () { if (!fired) { fired = true; go(); } }; pre.onload = pre.onerror = once; pre.src = img.getAttribute('href'); setTimeout(once, 2500); } else go();
  }
  // A4 sheet of one order's kit, sent to the browser's print dialog (where it can also be saved as PDF)
  function printKit(o) {
    var lines = o.stage === TR.kitStage || !(o.kitList && o.kitList.length) ? kitDraft(o) : o.kitList, sk = o.sketch || {};
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
      var ev = { s: 'kitOrder', at: new Date().toISOString(), byName: 'הלקוח', note: 'אושר בקישור' + (a.answeredName ? ' על ידי ' + a.answeredName : '') };
      tx.update(ref, { stage: 'kitOrder', stageAt: ev.at, hold: null, history: (o.history || []).concat([ev]) });
    }).catch(function () {});
  }
  function custAnswer(o) { var a = st.appr[o.id]; return a && a.token === o.approvalToken && IDX[o.stage] <= IDX.approval ? a : null; }
  function arm(key) { if (st.armed[key]) { st.armed[key] = false; return true; } st.armed[key] = true; setTimeout(function () { if (st.armed[key]) { st.armed[key] = false; st.usersDirty = true; render(); } }, 3500); st.usersDirty = true; render(); return false; }

  function openSketch(o) {
    var model = MODEL[o.model]; if (!model) return;
    var edit = canDraw(o);
    st.sketchId = o.id;
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
  $('list').addEventListener('click', onAct);
  function onAct(ev) {
    var a = ev.target.closest('a[data-send]'), o;
    if (a && (o = find(a.dataset.send))) { // the link itself opens WhatsApp / SMS / mail; here we only record that it was sent
      var upd = { approvalSentAt: new Date().toISOString(), approvalVia: a.dataset.ch };
      if (o.stage === 'request' || o.stage === 'drawing') { var ev2 = event('approval', 'נשלח ללקוח ב-' + a.dataset.ch); upd.stage = 'approval'; upd.stageAt = ev2.at; upd.history = (o.history || []).concat([ev2]); }
      col.doc(o.id).update(upd).catch(function () {});
      return;
    }
    var b = ev.target.closest('button'); if (!b || b.disabled) return; var d = b.dataset;
    if (d.reload) { hardReload(); return; }
    if (d.savetub && (o = find(d.savetub))) { var tv = $('tn-' + o.id).value.trim(), spaSer = kindOf(o) === 'spa'; if (!(spaSer ? /^\d{1,8}$/ : /^\d{4}$/).test(tv)) { $('banner').hidden = false; $('banner').textContent = spaSer ? 'מספר סידורי הוא ספרות בלבד.' : 'מספר סידורי הוא 4 ספרות.'; return; } document.activeElement && document.activeElement.blur(); write(o.id, function () { return col.doc(o.id).update({ tubNum: tv }); }); }
    else if (d.savecontact && (o = find(d.savecontact))) { var P = d.pfx || '', pv = $(P + 'ph-' + o.id).value.trim(), em = $(P + 'em-' + o.id).value.trim(); document.activeElement && document.activeElement.blur(); write(o.id, function () { return col.doc(o.id).update({ phone: pv, custEmail: em }); }); }
    else if (d.copy && (o = find(d.copy))) { var link = custLink(o); (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function () { b.textContent = 'הקישור הועתק'; }, function () { b.outerHTML = '<input readonly dir="ltr" value="' + esc(link) + '" onfocus="this.select()">'; }); }
    else if (d.edit && (o = find(d.edit))) { st.editId = o.id; st.form = false; st.usersOpen = false; $('form').innerHTML = ''; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    else if (d.open) { st.openId = st.openId === d.open ? null : d.open; st.holdFor = null; render(); }
    else if (d.sketch && (o = find(d.sketch))) { if (o.sketch || canDraw(o)) openSketch(o); }
    else if (d.next && (o = find(d.next))) { var nx = nextStage(o); if (nx && canAct(STAGES[IDX[o.stage]])) write(o.id, function () {
      return move(o, nx.k, null, o.stage === TR.kitStage ? { kitList: kitDraft(o).map(function (x) { return { n: x.n, q: x.q, sku: x.sku || '', done: false }; }) } : null); }); }
    else if (d.kitadd && (o = find(d.kitadd))) { var kn = $('kn-' + o.id).value.trim().slice(0, 80), kq = parseInt($('kq-' + o.id).value, 10) || 1, ks = $('ks-' + o.id).value.trim().slice(0, 20); if (!kn) return; document.activeElement && document.activeElement.blur(); write(o.id, function () { return col.doc(o.id).update({ kitExtra: (o.kitExtra || []).concat([{ n: kn, q: kq, sku: ks }]) }); }); }
    else if (d.kitdel && (o = find(d.kitdel))) { var ke = (o.kitExtra || []).slice(); ke.splice(+d.i, 1); write(o.id, function () { return col.doc(o.id).update({ kitExtra: ke }); }); }
    else if (d.kitprint && (o = find(d.kitprint))) printKit(o);
    else if (d.skprint && (o = find(d.skprint))) printSketch(o);
    else if (d.fail && (o = find(d.fail))) { if (arm('fail' + o.id)) write(o.id, function () { return move(o, 'toBarkan', 'הבדיקה נכשלה, חוזר לברקן'); }); }
    else if (d.holdopen) { st.holdFor = d.holdopen; render(); }
    else if (d.hold && (o = find(d.hold))) {
      var reason = d.reason || (($('holdTxt') || {}).value || '').trim(); if (!reason) return;
      st.holdFor = null; write(o.id, function () { return col.doc(o.id).update({ hold: { reason: reason.slice(0, 80), at: new Date().toISOString(), by: me.email } }); });
    }
    else if (d.unhold && (o = find(d.unhold))) write(o.id, function () { return col.doc(o.id).update({ hold: null }); });
    else if (d.undo && (o = find(d.undo))) { if (arm('undo' + o.id)) { var hs = (o.history || []).slice(0, -1), last = hs[hs.length - 1]; write(o.id, function () { return col.doc(o.id).update({ stage: last.s, stageAt: last.at, history: hs }); }); } }
    else if (d.del && (o = find(d.del))) { if (arm('del' + o.id)) write(o.id, function () { if (o.approvalToken) apCol.doc(o.approvalToken).delete().catch(function () {}); return col.doc(o.id).delete(); }); }
  }
  $('tiles').addEventListener('click', function (ev) { var b = ev.target.closest('[data-loc]'); if (!b) return; st.loc = st.loc === b.dataset.loc ? '' : b.dataset.loc; st.tab = 'open'; render(); });
  $('tabs').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.tab) { st.tab = b.dataset.tab; if (st.tab === 'done') st.loc = ''; } else if (b.dataset.locClear) st.loc = '';
    render();
  });
  $('q').addEventListener('input', function () { st.q = this.value; renderList(new Date()); });
  $('agentSel').addEventListener('change', function () { st.agent = this.value; render(); });
  $('newBtn').addEventListener('click', function () { st.form = !st.form || !!st.editId; st.editId = null; st.usersOpen = false; $('form').innerHTML = ''; render(); if (st.form) $('nCust').focus(); });
  $('usersBtn').addEventListener('click', function () { st.usersOpen = !st.usersOpen; st.form = false; st.usersDirty = true; render(); });
  $('form').addEventListener('change', function (ev) {
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
    } else Object.assign(d, { system: val('nSys'), custEmail: val('nEmail'), panel: on('nPanel') });
    return d;
  }
  $('form').addEventListener('click', async function (ev) {
    if (ev.target.id === 'nCancel') { st.form = false; st.editId = null; render(); return; }
    if (ev.target.id !== 'nSave') return;
    var d = formValues(), o = st.editId ? find(st.editId) : null;
    if (!d.customer && !d.num && !d.store) { $('nErr').textContent = 'צריך לפחות חנות, לקוח או מספר הזמנה.'; return; }
    var mdl = MODEL[d.model]; if (st.kind === 'jacuzzi' && mdl && d.system === 'TITANIUM' && mdl.jb && !mdl.jt) { $('nErr').textContent = 'לפי הקטלוג אין ל-' + mdl.code + ' מערכת TITANIUM.'; return; }
    var tub = st.kind === 'spa' && !o ? ($('nTub').value || '').trim() : ''; if (tub && !/^\d{1,8}$/.test(tub)) { $('nErr').textContent = 'מספר סידורי הוא ספרות בלבד.'; return; }
    ev.target.disabled = true;
    try {
      if (o) { // a changed model makes the old drawing meaningless: drop it and its customer link
        if (st.kind === 'jacuzzi' && o.sketch && d.model !== o.model) { if (o.approvalToken) apCol.doc(o.approvalToken).delete().catch(function () {}); Object.assign(d, { sketch: null, sketchBlocking: false, approvalToken: newToken(), approvalSentAt: null }); }
        await col.doc(o.id).update(d);
      } else {
        var ev0 = event(st.kind === 'spa' ? 'draft' : 'request');
        var order = Object.assign(d, { stage: ev0.s, stageAt: ev0.at, hold: null, history: [ev0], createdAt: ev0.at });
        if (st.kind === 'spa') { order.tubNum = tub; await col.add(order); }
        else {
          order.approvalToken = newToken();
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

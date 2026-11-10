// MTI jacuzzi tracking board. Sign-in with Google, a role per email, one card per order moving through the stations.
(function () {
  var auth = firebase.auth(), db = firebase.firestore();

  // Stage targets are working days (Sun–Thu). Barkan is split into waiting and fitting on purpose:
  // fitting takes hours, the queue before it is where the days go.
  // `roles` = who may press the button that completes the stage (admin always may).
  var STAGES = [
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
  var IDX = {}; STAGES.forEach(function (s, i) { IDX[s.k] = i; });
  var LOCS = [
    { k: 'a1',   n: 'אשדוד · הכנה',           c: 'var(--ashdod)' },
    { k: 'road', n: 'בדרך במשאית',            c: 'var(--road)' },
    { k: 'bk',   n: 'ברקן',                   c: 'var(--barkan)' },
    { k: 'a2',   n: 'אשדוד · בדיקה ואספקה',   c: 'var(--ashdod)' }
  ];
  var LOCC = { a1: 'var(--ashdod)', a2: 'var(--ashdod)', bk: 'var(--barkan)', road: 'var(--road)', done: 'var(--ok)' };
  var ROLES = { admin: 'מנהל', office: 'משרד', warehouse: 'מחסן אשדוד', barkan: 'מנהל ברקן', driver: 'נהג', agent: 'סוכן' };
  // Field agents by name. An agent who should sign in and see only their own orders is also added under Users
  // with the role 'agent' and exactly the same name; new orders are then linked to that account.
  var AGENTS = ['רונן', 'מתן', 'יניב', 'אסתר'];
  var HOLDS = ['חסר חלק', 'ממתין ללקוח', 'תקלה באמבטיה'];
  var DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
  var MODELS = window.MTI_MODELS || [], MODEL = {}; MODELS.forEach(function (m) { MODEL[m.code] = m; });

  var me = null, col = db.collection('orders'), usersCol = db.collection('users'), apCol = db.collection('approvals'), unsub = [], users = [];
  var TOKEN = new URLSearchParams(location.search).get('a');
  var st = { orders: [], loaded: false, err: '', loc: '', q: '', agent: '', tab: 'open', openId: null, holdFor: null, form: false, usersOpen: false, armed: {}, busy: {}, appr: {} };

  function $(id) { return document.getElementById(id); }
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
    var i = IDX[o.stage]; if (i == null) i = 0;
    var s = STAGES[i], el = workDays(o.stageAt, now), late = s.k !== 'delivered' && el > s.t, rem = Math.max(0, s.t - el);
    for (var j = i + 1; j < STAGES.length; j++) rem += STAGES[j].t;
    return { i: i, s: s, el: el, late: late, over: el - s.t, eta: addWork(now, rem), hold: !!(o.hold && o.hold.reason) };
  }
  function dayWord(n) { return n === 0 ? 'מהיום' : n === 1 ? 'יום עבודה אחד' : n + ' ימי עבודה'; }

  // ---------- permissions (screen level; the database rules are the coarse backstop) ----------
  function isAdmin() { return me && me.role === 'admin'; }
  function isOffice() { return me && (me.role === 'admin' || me.role === 'office'); }
  function canWrite() { return me && me.role !== 'agent'; }
  function canAct(stage) { return isAdmin() || (me && stage.roles.indexOf(me.role) > -1); }
  function canDraw(o) { return isOffice() && IDX[o.stage] <= IDX.approval; }

  // ---------- customer link ----------
  // The customer opens index.html?a=<token> without signing in, sees the drawing and approves it or sends a note.
  // approvals/<token> holds a copy of the drawing; the token is the only key to it.
  function newToken() { var a = new Uint8Array(16); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join(''); }
  function custLink(o) { return location.origin + location.pathname + '?a=' + o.approvalToken; }
  function intlPhone(p) { var d = String(p || '').replace(/\D/g, ''); if (d.indexOf('972') === 0) return d; if (d.charAt(0) === '0') return '972' + d.slice(1); return d; }
  function custMessage(o) { return 'שלום' + (o.customer ? ' ' + o.customer : '') + ', כאן MTI. מצורף שרטוט הג\'קוזי שהזמנת' + (o.model ? ' (' + o.model + ')' : '') + '. נא לבדוק את הקירות, פריסת הג\'טים ופתח השירות, ולאשר בקישור:\n' + custLink(o); }
  async function customerMode() {
    ['loginView', 'noAccessView', 'appView'].forEach(function (v) { $(v).hidden = true; });
    $('custView').hidden = false;
    function msg(s) { $('custMsg').hidden = false; $('custMsg').textContent = s; $('custSub').textContent = ''; }
    if (!/^[a-f0-9]{32}$/.test(TOKEN)) { msg('הקישור אינו תקף. אפשר לבקש מ-MTI קישור חדש.'); return; }
    var ref = apCol.doc(TOKEN), d;
    try { var snap = await ref.get(); d = snap.exists ? snap.data() : null; } catch (e) { msg('לא הצלחנו לטעון את השרטוט. בדקו את החיבור ונסו שוב.'); return; }
    var model = d && MODEL[d.model];
    if (!d || !model || !d.sketch) { msg('הקישור אינו תקף. אפשר לבקש מ-MTI קישור חדש.'); return; }
    if (d.status === 'draft') { msg('השרטוט עדיין בהכנה. נשלח קישור כשיהיה מוכן.'); return; }
    $('custSub').textContent = [d.customer, d.model + ' · ' + model.dims + ' ס"מ', d.system].filter(Boolean).join(' · ');
    Sketch.open($('custSketch'), { model: model, system: d.system, data: d.sketch, readOnly: true, customer: true,
      readOnlyNote: 'בדקו את הקירות, פריסת הג\'טים ופתח השירות.' });
    var box = $('custApprove'); box.hidden = false;
    function done(status, name, at) {
      box.innerHTML = status === 'approved'
        ? '<div class="stamp">השרטוט אושר' + (name ? ' על ידי ' + esc(name) : '') + (at ? ' · ' + fmt(at) : '') + '<br>תודה! מתחילים בהכנה.</div>'
        : '<div class="issue warn">ההערה שלך התקבלה. נעדכן את השרטוט ונשלח קישור חדש.</div>';
    }
    if (d.status !== 'pending') { done(d.status, d.answeredName, d.answeredAt); return; }
    box.innerHTML = '<h2 style="margin:0">אישור השרטוט</h2><div>אחרי האישור מתחילים בהכנת הג\'קוזי לפי השרטוט הזה.</div>' +
      '<label class="f" for="cName">שם המאשר/ת<input id="cName" autocomplete="name"></label>' +
      '<button class="btn primary big" type="button" id="cOk">אני מאשר/ת את השרטוט</button>' +
      '<label class="f" for="cNote">משהו לא נכון? כתבו מה צריך לשנות<textarea id="cNote" rows="3"></textarea></label>' +
      '<button class="btn" type="button" id="cChange">שליחת בקשה לשינוי</button><div id="cErr" style="color:var(--bad)"></div>';
    $('cName').value = d.customer || '';
    async function answer(status) {
      var name = $('cName').value.trim().slice(0, 80), note = $('cNote').value.trim().slice(0, 1000), at = new Date().toISOString();
      if (status === 'approved' && !name) { $('cErr').textContent = 'נא לכתוב את שם המאשר/ת.'; return; }
      if (status === 'changes' && !note) { $('cErr').textContent = 'נא לכתוב מה צריך לשנות.'; return; }
      $('cOk').disabled = $('cChange').disabled = true;
      try { await ref.update({ status: status, answeredAt: at, answeredName: name, comment: status === 'changes' ? note : '' }); done(status, name, at); }
      catch (e) { $('cOk').disabled = $('cChange').disabled = false; $('cErr').textContent = 'השליחה לא הצליחה. ייתכן שהשרטוט כבר אושר או השתנה. רעננו את הדף ונסו שוב.'; }
    }
    $('cOk').addEventListener('click', function () { answer('approved'); });
    $('cChange').addEventListener('click', function () { answer('changes'); });
  }
  if (TOKEN) { customerMode(); return; }

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
    st.loaded = false; st.err = ''; st.orders = [];
    show('appView');
    $('whoami').textContent = (me.name || me.email) + ' · ' + ROLES[me.role];
    var q = me.role === 'agent' ? col.where('agentEmail', '==', me.email) : col;
    unsub.push(q.onSnapshot(function (snap) {
      st.loaded = true; st.orders = snap.docs.map(function (d) { var o = Object.assign({}, d.data()); o.id = d.id; return o; }); render();
    }, function () { st.err = 'לא הצלחנו לטעון את ההזמנות. בדקו את החיבור ופתחו שוב.'; render(); }));
    if (me.role !== 'agent') unsub.push(apCol.where('status', 'in', ['approved', 'changes']).onSnapshot(function (snap) {
      st.appr = {}; snap.docs.forEach(function (d) { var a = d.data(); a.token = d.id; if (a.orderId) st.appr[a.orderId] = a; });
      if (isOffice()) snap.docs.forEach(function (d) { var a = d.data(); if (a.status === 'approved' && a.orderId) autoApprove(a.orderId, d.id, a); });
      render();
    }, function () {}));
    if (isOffice()) unsub.push(usersCol.onSnapshot(function (snap) { users = snap.docs.map(function (d) { return Object.assign({ email: d.id }, d.data()); }); st.usersDirty = true; render(); }, function () {}));
    render();
  }

  // ---------- rendering ----------
  function visible(now) {
    var q = st.q.trim().toLowerCase();
    return st.orders.filter(function (o) {
      var del = o.stage === 'delivered';
      if (st.tab === 'open' ? del : !del) return false;
      if (st.loc && STAGES[IDX[o.stage] || 0].loc !== st.loc) return false;
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
    $('tiles').innerHTML = LOCS.map(function (L) {
      var here = open.filter(function (o) { return STAGES[IDX[o.stage] || 0].loc === L.k; });
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
  function stepsBar(i) { var h = ''; for (var j = 0; j < STAGES.length - 1; j++) h += '<i class="' + (j < i ? 'd' : j === i ? 'c' : '') + '"></i>'; return '<div class="steps" aria-hidden="true">' + h + '</div>'; }
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
    var meta = [o.model, o.system, o.panel ? 'כולל פאנל' : '', o.agent ? 'סוכן: ' + o.agent : '', o.store].filter(Boolean).map(esc).join(' · ');
    var h = '<div class="card' + (f.hold ? ' hold' : f.late ? ' late' : '') + '" style="--lc:' + LOCC[f.s.loc] + '"><button type="button" data-open="' + esc(o.id) + '" aria-expanded="' + open + '">' +
      '<div class="c-top"><span class="c-cust">' + esc(o.customer || 'ללא שם לקוח') + '</span><span class="c-num">' + [o.tubNum ? 'סידורי ' + esc(o.tubNum) : '', o.num ? 'הזמנה ' + esc(o.num) : ''].filter(Boolean).join(' · ') + '</span></div>' +
      (meta ? '<div class="c-meta">' + meta + '</div>' : '') + '<div class="c-stage">' + chips + '</div>' + (del ? '' : stepsBar(f.i)) + '<div class="c-eta">' + eta + '</div></button>';
    if (open) h += detailHtml(o, f);
    return h + '</div>';
  }
  function detailHtml(o, f) {
    var id = esc(o.id), busy = st.busy[o.id] ? ' disabled' : '', del = o.stage === 'delivered', h = '<div class="detail">';
    if (o.notes) h += '<div class="notes">' + esc(o.notes) + '</div>';
    if (canWrite()) h += '<div class="row tubrow"><label for="tn-' + id + '">מספר סידורי</label><input id="tn-' + id + '" inputmode="numeric" maxlength="4" autocomplete="off" value="' + esc(o.tubNum || '') + '"><button class="btn small" type="button" data-savetub="' + id + '">שמור</button></div>';
    if (MODEL[o.model]) h += '<button class="btn" type="button" data-sketch="' + id + '">' + (o.sketch ? (canDraw(o) ? 'עריכת השרטוט' : 'צפייה בשרטוט') : (canDraw(o) ? 'יצירת שרטוט' : 'אין עדיין שרטוט')) + '</button>';
    if (isOffice() && o.approvalToken && o.sketch && !o.sketchBlocking && IDX[o.stage] <= IDX.approval) {
      var ph = intlPhone(o.phone), txt = encodeURIComponent(custMessage(o)), ca = custAnswer(o);
      h += '<div class="sendbox"><strong>שליחת השרטוט ללקוח לאישור</strong>' +
        (ca && ca.status === 'changes' ? '<div class="st chg">הלקוח ביקש שינוי (' + fmt(ca.answeredAt) + '): ' + esc(ca.comment) + '<br>אחרי תיקון ושמירת השרטוט שולחים שוב.</div>'
          : o.approvalSentAt ? '<div class="st">נשלח ב-' + fmt(o.approvalSentAt) + '. ממתין לתשובת הלקוח.</div>' : '') +
        '<div class="row"><input id="ph-' + id + '" inputmode="tel" dir="ltr" placeholder="טלפון הלקוח" aria-label="טלפון הלקוח" value="' + esc(o.phone || '') + '">' +
        '<input id="em-' + id + '" type="email" dir="ltr" placeholder="מייל הלקוח" aria-label="מייל הלקוח" value="' + esc(o.custEmail || '') + '">' +
        '<button class="btn small" type="button" data-savecontact="' + id + '">שמור</button></div><div class="row">' +
        (ph ? '<a class="btn small primary" target="_blank" rel="noopener" data-send="' + id + '" data-ch="WhatsApp" href="https://wa.me/' + ph + '?text=' + txt + '">WhatsApp</a>' +
              '<a class="btn small" data-send="' + id + '" data-ch="SMS" href="sms:+' + ph + '?body=' + txt + '">SMS</a>' : '') +
        (o.custEmail ? '<a class="btn small" data-send="' + id + '" data-ch="אימייל" href="mailto:' + esc(o.custEmail) + '?subject=' + encodeURIComponent('שרטוט הג\'קוזי שלך לאישור · MTI') + '&body=' + txt + '">אימייל</a>' : '') +
        '<button class="btn small" type="button" data-copy="' + id + '">העתקת קישור</button></div>' +
        (!ph && !o.custEmail ? '<div class="st">כדי לשלוח, מוסיפים טלפון או מייל של הלקוח ושומרים. אפשר גם להעתיק את הקישור ולשלוח ידנית.</div>' : '') + '</div>';
    }
    if (!del) h += kitHtml(o, f);
    if (!del && canWrite()) {
      h += '<div class="who">מי מעדכן עכשיו: ' + f.s.who + '</div>';
      if (f.hold) h += '<button class="btn primary big" type="button" data-unhold="' + id + '"' + busy + '>העיכוב הוסר, ממשיכים</button>';
      else {
        if (canAct(f.s)) {
          var blockTxt = '';
          if (f.s.k === 'kitOrder' && !kitDraft(o).length) blockTxt = 'הרשימה ריקה. מוסיפים לפחות פריט אחד.';
          if (f.s.k === 'kit' && o.kitList && o.kitList.some(function (x) { return !x.done; })) blockTxt = 'מסמנים קודם את כל הפריטים ברשימה.';
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
  function renderForm() {
    var f = $('form'); f.hidden = !st.form; if (!st.form) { f.innerHTML = ''; return; }
    if (f.innerHTML) return;
    var names = AGENTS.slice(); users.forEach(function (u) { if (u.role === 'agent' && u.name && names.indexOf(u.name) < 0) names.push(u.name); });
    f.innerHTML = '<h2>הזמנה חדשה למעקב</h2><div class="grid">' +
      '<label for="nNum">מס\' הזמנה באינטגרל<input id="nNum" inputmode="numeric" autocomplete="off"></label>' +
      '<label for="nTub">מספר סידורי (4 ספרות)<input id="nTub" inputmode="numeric" maxlength="4" autocomplete="off"></label>' +
      '<label for="nCust">לקוח<input id="nCust" autocomplete="off"></label>' +
      '<label for="nModel">דגם אמבטיה<select id="nModel"><option value="">בחירת דגם</option>' + MODELS.map(function (m) { return '<option value="' + m.code + '">' + m.code + ' · ' + m.dims + '</option>'; }).join('') + '</select></label>' +
      '<label for="nSys">מערכת<select id="nSys"><option>BASIC</option><option>TITANIUM</option><option>אחר</option></select></label>' +
      '<label for="nAgent">סוכן<select id="nAgent"><option value="">ללא סוכן</option>' + names.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('') + '</select></label>' +
      '<label for="nStore">חנות<input id="nStore" autocomplete="off"></label>' +
      '<label for="nPhone">טלפון הלקוח<input id="nPhone" inputmode="tel" dir="ltr" autocomplete="off"></label>' +
      '<label for="nEmail">מייל הלקוח<input id="nEmail" type="email" dir="ltr" autocomplete="off"></label>' +
      '<label class="chk" for="nPanel"><input id="nPanel" type="checkbox">הלקוח הזמין פאנל</label>' +
      '<label class="wide" for="nNotes">הערות<textarea id="nNotes" rows="2"></textarea></label></div>' +
      '<div class="row"><button class="btn primary" type="button" id="nSave">הוספה למעקב</button><button class="btn" type="button" id="nCancel">ביטול</button><span id="nErr" style="color:var(--bad)"></span></div>';
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
  function render() {
    if (!me) return;
    var a = document.activeElement;
    if (a && ($('list').contains(a) || $('usersPanel').contains(a)) && (a.tagName === 'INPUT')) { pending = true; return; }
    pending = false;
    var now = new Date();
    $('newBtn').hidden = !isOffice(); $('usersBtn').hidden = !isAdmin();
    $('banner').hidden = me.role !== 'agent'; if (me.role === 'agent') $('banner').textContent = 'תצוגה בלבד: כאן רואים איפה כל ג\'קוזי של הלקוחות שלך ומתי הוא צפוי לרדת.';
    renderTiles(now); renderFilters(); renderForm(); renderUsers(); renderList(now);
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
  function kitDraft(o) { var l = Sketch.kitOf(o.sketch); return l.concat((o.kitExtra || []).map(function (x, i) { return { n: x.n, q: x.q, extra: i }; })); }
  function kitHtml(o, f) {
    var id = esc(o.id), k = f.s.k, h = '';
    if (k === 'kitOrder' && isOffice()) {
      var lines = kitDraft(o);
      h += '<div class="kitbox"><strong>הזמנת קיט למחסנאי</strong>' + (o.sketch ? '' : '<div class="st">אין שרטוט שמור, אז הרשימה לא נגזרת אוטומטית. מוסיפים פריטים ידנית.</div>') +
        '<ul class="kitlist">' + lines.map(function (x) { return '<li><span class="q">' + esc(x.q) + '</span><span class="n">' + esc(x.n) + '</span>' + (x.extra != null ? '<button class="btn small danger" type="button" data-kitdel="' + id + '" data-i="' + x.extra + '">הסר</button>' : '') + '</li>'; }).join('') + '</ul>' +
        '<div class="row"><input id="kn-' + id + '" placeholder="פריט נוסף" aria-label="פריט נוסף" autocomplete="off"><input id="kq-' + id + '" class="qty" inputmode="numeric" value="1" aria-label="כמות"><button class="btn small" type="button" data-kitadd="' + id + '">הוספה</button></div></div>';
    } else if (o.kitList && o.kitList.length && IDX[k] >= IDX.kit && IDX[k] <= IDX.fitting) {
      var can = k === 'kit' && canAct(f.s), left = o.kitList.filter(function (x) { return !x.done; }).length;
      h += '<div class="kitbox"><strong>' + (k === 'kit' ? 'רשימת הקיט להכנה' : 'הקיט שנשלח') + '</strong>' + (k === 'kit' ? '<div class="st">' + (left ? 'מסמנים כל פריט שנכנס לקיט. נשארו ' + left + '.' : 'כל הפריטים בקיט.') + '</div>' : '') +
        '<ul class="kitlist">' + o.kitList.map(function (x, i) {
          var row = '<span class="chk">' + (x.done ? '✓' : '') + '</span><span class="q">' + esc(x.q) + '</span><span class="n">' + esc(x.n) + '</span>';
          return '<li class="' + (x.done ? 'done' : '') + '">' + (can ? '<button type="button" class="kitrow" data-kittick="' + id + '" data-i="' + i + '" aria-pressed="' + !!x.done + '">' + row + '</button>' : row) + '</li>'; }).join('') + '</ul></div>';
    }
    return h;
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
    Sketch.open($('sketchView'), {
      model: model, system: o.system, data: o.sketch || null, readOnly: !edit || (!o.sketch && !edit),
      title: (o.customer || '') + (o.num ? ' · הזמנה ' + o.num : ''),
      readOnlyNote: IDX[o.stage] > IDX.approval ? 'השרטוט אושר על ידי הלקוח ונעול לעריכה.' : 'תצוגה בלבד.',
      onSave: function (data, meta) {
        var token = o.approvalToken || newToken(), at = new Date().toISOString(), b = db.batch();
        b.update(col.doc(o.id), { sketch: data, sketchBlocking: !!meta.blocking, sketchAt: at, approvalToken: token, approvalSentAt: null });
        b.set(apCol.doc(token), { orderId: o.id, customer: o.customer || '', num: o.num || '', model: o.model, system: o.system || '', sketch: data, status: meta.blocking ? 'draft' : 'pending', updatedAt: at });
        o.approvalToken = token;
        return b.commit();
      }
    });
  }

  $('list').addEventListener('click', function (ev) {
    var a = ev.target.closest('a[data-send]'), o;
    if (a && (o = find(a.dataset.send))) { // the link itself opens WhatsApp / SMS / mail; here we only record that it was sent
      var upd = { approvalSentAt: new Date().toISOString(), approvalVia: a.dataset.ch };
      if (o.stage === 'request' || o.stage === 'drawing') { var ev2 = event('approval', 'נשלח ללקוח ב-' + a.dataset.ch); upd.stage = 'approval'; upd.stageAt = ev2.at; upd.history = (o.history || []).concat([ev2]); }
      col.doc(o.id).update(upd).catch(function () {});
      return;
    }
    var b = ev.target.closest('button'); if (!b || b.disabled) return; var d = b.dataset;
    if (d.savetub && (o = find(d.savetub))) { var tv = $('tn-' + o.id).value.trim(); if (!/^\d{4}$/.test(tv)) { $('banner').hidden = false; $('banner').textContent = 'מספר סידורי הוא 4 ספרות.'; return; } document.activeElement && document.activeElement.blur(); write(o.id, function () { return col.doc(o.id).update({ tubNum: tv }); }); }
    else if (d.savecontact && (o = find(d.savecontact))) { var pv = $('ph-' + o.id).value.trim(), em = $('em-' + o.id).value.trim(); document.activeElement && document.activeElement.blur(); write(o.id, function () { return col.doc(o.id).update({ phone: pv, custEmail: em }); }); }
    else if (d.copy && (o = find(d.copy))) { var link = custLink(o); (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function () { b.textContent = 'הקישור הועתק'; }, function () { b.outerHTML = '<input readonly dir="ltr" value="' + esc(link) + '" onfocus="this.select()">'; }); }
    else if (d.open) { st.openId = st.openId === d.open ? null : d.open; st.holdFor = null; render(); }
    else if (d.sketch && (o = find(d.sketch))) { if (o.sketch || canDraw(o)) openSketch(o); }
    else if (d.next && (o = find(d.next))) { var nx = STAGES[IDX[o.stage] + 1]; if (nx && canAct(STAGES[IDX[o.stage]])) write(o.id, function () {
      return move(o, nx.k, null, o.stage === 'kitOrder' ? { kitList: kitDraft(o).map(function (x) { return { n: x.n, q: x.q, done: false }; }) } : null); }); }
    else if (d.kitadd && (o = find(d.kitadd))) { var kn = $('kn-' + o.id).value.trim().slice(0, 80), kq = parseInt($('kq-' + o.id).value, 10) || 1; if (!kn) return; document.activeElement && document.activeElement.blur(); write(o.id, function () { return col.doc(o.id).update({ kitExtra: (o.kitExtra || []).concat([{ n: kn, q: kq }]) }); }); }
    else if (d.kitdel && (o = find(d.kitdel))) { var ke = (o.kitExtra || []).slice(); ke.splice(+d.i, 1); write(o.id, function () { return col.doc(o.id).update({ kitExtra: ke }); }); }
    else if (d.kittick && (o = find(d.kittick))) { var kl = (o.kitList || []).map(function (x, i) { return i === +d.i ? { n: x.n, q: x.q, done: !x.done } : x; }); write(o.id, function () { return col.doc(o.id).update({ kitList: kl }); }); }
    else if (d.fail && (o = find(d.fail))) { if (arm('fail' + o.id)) write(o.id, function () { return move(o, 'toBarkan', 'הבדיקה נכשלה, חוזר לברקן'); }); }
    else if (d.holdopen) { st.holdFor = d.holdopen; render(); }
    else if (d.hold && (o = find(d.hold))) {
      var reason = d.reason || (($('holdTxt') || {}).value || '').trim(); if (!reason) return;
      st.holdFor = null; write(o.id, function () { return col.doc(o.id).update({ hold: { reason: reason.slice(0, 80), at: new Date().toISOString(), by: me.email } }); });
    }
    else if (d.unhold && (o = find(d.unhold))) write(o.id, function () { return col.doc(o.id).update({ hold: null }); });
    else if (d.undo && (o = find(d.undo))) { if (arm('undo' + o.id)) { var hs = (o.history || []).slice(0, -1), last = hs[hs.length - 1]; write(o.id, function () { return col.doc(o.id).update({ stage: last.s, stageAt: last.at, history: hs }); }); } }
    else if (d.del && (o = find(d.del))) { if (arm('del' + o.id)) write(o.id, function () { if (o.approvalToken) apCol.doc(o.approvalToken).delete().catch(function () {}); return col.doc(o.id).delete(); }); }
  });
  $('tiles').addEventListener('click', function (ev) { var b = ev.target.closest('[data-loc]'); if (!b) return; st.loc = st.loc === b.dataset.loc ? '' : b.dataset.loc; st.tab = 'open'; render(); });
  $('tabs').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.tab) { st.tab = b.dataset.tab; if (st.tab === 'done') st.loc = ''; } else if (b.dataset.locClear) st.loc = '';
    render();
  });
  $('q').addEventListener('input', function () { st.q = this.value; renderList(new Date()); });
  $('agentSel').addEventListener('change', function () { st.agent = this.value; render(); });
  $('newBtn').addEventListener('click', function () { st.form = !st.form; st.usersOpen = false; render(); if (st.form) $('nCust').focus(); });
  $('usersBtn').addEventListener('click', function () { st.usersOpen = !st.usersOpen; st.form = false; st.usersDirty = true; render(); });
  $('form').addEventListener('click', async function (ev) {
    if (ev.target.id === 'nCancel') { st.form = false; render(); return; }
    if (ev.target.id !== 'nSave') return;
    var cust = $('nCust').value.trim(), num = $('nNum').value.trim();
    if (!cust && !num) { $('nErr').textContent = 'צריך לפחות שם לקוח או מספר הזמנה.'; return; }
    if (!/^\d{4}$/.test($('nTub').value.trim())) { $('nErr').textContent = 'צריך מספר סידורי בן 4 ספרות.'; return; }
    var agentName = $('nAgent').value, ag = users.find(function (u) { return u.role === 'agent' && u.name === agentName; }), ev0 = event('request');
    ev.target.disabled = true;
    try {
      await col.add({ num: num, customer: cust, model: $('nModel').value, system: $('nSys').value, panel: $('nPanel').checked, notes: $('nNotes').value.trim(), store: $('nStore').value.trim(), tubNum: $('nTub').value.trim(), phone: $('nPhone').value.trim(), custEmail: $('nEmail').value.trim(), approvalToken: newToken(),
        agentEmail: ag ? ag.email : '', agent: agentName, stage: 'request', stageAt: ev0.at, hold: null, history: [ev0], createdAt: ev0.at });
      st.form = false; render();
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

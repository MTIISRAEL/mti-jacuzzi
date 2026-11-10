// Drawing screen: top view of one jacuzzi with walls, jets (2" or 3"), faucet, hand shower and service opening.
// Sketch.open(host, { model, system, data, readOnly, customer, title, onSave(data) -> Promise, onClose() })
// All positions are in centimetres from the tub's top-left corner (back wall, left end).
window.Sketch = (function () {
  var CM = 'ס"מ';
  var TYPES = {
    jet:     { name: "ג'ט", r: 2.7 },
    suction: { name: 'יניקה', r: 2.9 },
    ctrl:    { name: 'לחצן הפעלה', r: 2.1 },
    air:     { name: 'וסת אוויר', r: 1.9 },
    faucet:  { name: 'ברז', r: 3.4 },
    shower:  { name: 'מזלף יד', r: 2.4 },
    motor:   { name: 'מנוע', r: 9 },
    service: { name: 'פתח שירות', r: 6, len: 40 }
  };
  var ORDER = ['jet', 'suction', 'ctrl', 'air', 'motor', 'service', 'faucet', 'shower'];
  var SIDES = { top: 'אחורי', bottom: 'קדמי', left: 'שמאלי', right: 'ימני' };
  var JETS = { BASIC: 6, TITANIUM: 10 };

  // Standard jet layouts, measured from the catalog renders. Only MTI-114 has them so far.
  var TEMPLATES = {
    'MTI-114': {
      BASIC: [[75, 14.1], [75, 55.4], [29.8, 27.8], [29.8, 41.2], [120.5, 27.8], [120.5, 40.8]],
      TITANIUM: [[54.5, 14.1], [97, 14.5], [54.7, 55.6], [97, 55.2], [26.5, 27.1], [35.7, 28.5], [26.5, 42.6], [35.7, 41.2], [120.5, 28.1], [120.5, 41.8]]
    }
  };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function r1(v) { return Math.round(v); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function open(host, opt) {
    var model = opt.model, W = model.w, H = model.h, system = opt.system || '';
    var tpl = TEMPLATES[model.code] || null, readOnly = !!opt.readOnly;
    var uid = 0, selId = null, drag = null, armed = {}, dirty = false, saving = false;

    function template() {
      var items = [];
      function add(type, x, y, side) { var it = { id: 's' + (++uid), type: type, x: x, y: y, std: { x: x, y: y } }; if (type === 'jet') { it.size = 3; it.std.size = 3; } if (side) { it.side = side; it.std.side = side; } items.push(it); }
      ((tpl && tpl[system]) || []).forEach(function (p) { add('jet', p[0], p[1]); });
      if (model.sides) { // right-handed layout: the square corner is top right
        add('service', W - 26, H, 'bottom');
      } else {
        add('ctrl', 4.2, H - 7.9);
        add('air', 8.9, H - 4.8);
        add('service', Math.min(24, W / 2), H, 'bottom');
      }
      return items;
    }
    function fresh() { return { finish: 'grey', side: null, items: template(), removed: [], walls: { top: true, right: true, bottom: false, left: false }, notes: '' }; }
    var S = opt.data ? JSON.parse(JSON.stringify(opt.data)) : fresh();
    S.items = S.items || []; S.removed = S.removed || []; S.walls = S.walls || {};
    // suction and motor are no longer drawn (only the service opening is); drop them from drawings saved before that change
    function drawn(i) { return i.type !== 'suction' && i.type !== 'motor'; }
    S.items = S.items.filter(drawn); S.removed = S.removed.filter(drawn);
    S.items.concat(S.removed).forEach(function (i) { var n = +String(i.id).slice(1); if (n > uid) uid = n; });

    host.innerHTML =
      '<div class="wrap">' +
      '<div class="head"><div><h1>שרטוט · ' + esc(model.code) + '</h1><div class="sub">' + esc(opt.title || '') + ' · ' + esc(model.dims) + ' ' + CM + (system ? ' · ' + esc(system) : '') + '</div></div>' +
      '<div class="row"><button class="btn primary" type="button" id="skSave" hidden>שמירת השרטוט</button><button class="btn" type="button" id="skClose">חזרה ללוח</button></div></div>' +
      '<div class="banner" id="skNote" hidden></div>' +
      '<div class="row" id="skSide"></div>' +
      '<div class="row" id="skFinish"></div>' +
      '<div class="board"><svg id="skSvg" viewBox="-20 -20 ' + (W + 40) + ' ' + (H + 32) + '" role="img" aria-label="מבט על של האמבטיה"></svg>' +
      '<div class="legend"><span><i style="background:var(--warn)"></i>הוזז מהסטנדרט</span><span><i style="background:var(--ok)"></i>נוסף</span><span><i style="background:var(--bad)"></i>הוסר</span></div>' +
      '<p class="hint" id="skHint"></p></div>' +
      '<div class="sel" id="skSel" hidden></div>' +
      '<div id="skPalWrap"><h2>הוספת פריט</h2><div class="palette" id="skPal"></div></div>' +
      '<div class="issues" id="skIssues"></div>' +
      '<div class="panel"><h2>שינויים מהסטנדרט</h2><ul class="list" id="skChanges"></ul></div>' +
      '<div class="panel"><h2>קיט אביזרים לפי השרטוט</h2><table class="kit" id="skKit"></table></div>' +
      '<div class="panel"><label class="f wide" for="skNotes">הערות למאבזר בברקן<textarea id="skNotes" rows="2"></textarea></label></div>' +
      '<div class="row"><button class="btn danger" id="skReset" type="button">איפוס לסטנדרט</button></div>' +
      '</div>';
    function $(id) { return host.querySelector('#' + id); }
    var svg = $('skSvg');
    if (opt.customer) { // the customer sees the drawing and the list of walls and changes, not the workshop panels
      host.querySelector('.head').hidden = true; $('skIssues').hidden = true; $('skFinish').hidden = true;
      $('skKit').closest('.panel').hidden = true; $('skNotes').closest('.panel').hidden = true;
    }

    // Jets come in two sizes, 2" and 3". Drawings saved before sizes existed count as 3".
    function jsize(it) { return it.size === 2 ? 2 : 3; }
    function nameOf(it) { return it.type === 'jet' ? "ג'ט " + jsize(it) + '"' : TYPES[it.type].name; }
    function status(it) {
      if (!it.std) return 'added';
      if (it.type === 'jet' && it.std.size && jsize(it) !== it.std.size) return 'moved';
      if (dist(it, it.std) > 1.5 || (it.type === 'service' && it.side !== it.std.side)) return 'moved';
      return '';
    }
    function statusColor(st) { return st === 'added' ? 'var(--ok)' : st === 'moved' ? 'var(--warn)' : 'none'; }
    function symbol(it, small) {
      var t = it.type, f = S.finish === 'white';
      var body = f ? '#f6f6f3' : '#3a3d42', ring = f ? '#8d949b' : '#9a9da3', core = f ? '#c9cdd1' : '#17191c';
      if (t === 'jet') { var jr = jsize(it) === 2 ? 2.0 : 3.0; return '<circle r="' + jr + '" fill="' + body + '" stroke="' + ring + '" stroke-width=".7"/><circle r="' + (jr * 0.4) + '" fill="' + core + '"/>'; }
      if (t === 'suction') return '<circle r="2.9" fill="#b9bdc2" stroke="#70767d" stroke-width=".6"/><path d="M-1.8 -1h3.6M-2.2 0h4.4M-1.8 1h3.6" stroke="#4d5359" stroke-width=".45" fill="none"/>';
      if (t === 'ctrl') return '<circle r="2.1" fill="#c9c5c2" stroke="#7d7672" stroke-width=".5"/><circle r=".8" fill="#7d7672"/>';
      if (t === 'air') return '<circle r="1.9" fill="#d4d0cd" stroke="#7d7672" stroke-width=".5"/><path d="M0 -1.2V1.2" stroke="#7d7672" stroke-width=".5"/>';
      if (t === 'faucet') return '<rect x="-3.4" y="-2" width="6.8" height="4" rx="1.2" fill="#c7ccd1" stroke="#5f666d" stroke-width=".5"/><rect x="-.9" y="0" width="1.8" height="5" rx=".9" fill="#aeb4ba" stroke="#5f666d" stroke-width=".5"/>';
      if (t === 'shower') return '<circle r="2.4" fill="#c7ccd1" stroke="#5f666d" stroke-width=".5"/><circle r=".35" cx="-.9" fill="#5f666d"/><circle r=".35" cx=".9" fill="#5f666d"/><circle r=".35" cy="-.9" fill="#5f666d"/><circle r=".35" cy=".9" fill="#5f666d"/>';
      if (t === 'motor') return '<rect x="-11" y="-7.5" width="22" height="15" rx="2.5" fill="rgba(11,110,124,.16)" stroke="#0b6e7c" stroke-width=".7" stroke-dasharray="2 1.4"/>' + (small ? '' : '<text class="t-lbl" text-anchor="middle" y="1.5" fill="#0b4f59">מנוע</text>');
      if (t === 'service') return '<rect x="-20" y="-2.2" width="40" height="4.4" rx="1" fill="var(--accent)"/>' + (small ? '' : '<text class="t-lbl" text-anchor="middle" y="1.45" fill="var(--accent-ink)">פתח שירות</text>');
      return '';
    }
    function tf(it) {
      var rot = it.type === 'service' && (it.side === 'left' || it.side === 'right') ? ' rotate(90)' : '';
      return 'translate(' + it.x.toFixed(1) + ' ' + it.y.toFixed(1) + ')' + rot;
    }
    function ringFor(it) {
      var st = status(it), out = '', T = TYPES[it.type], sel = it.id === selId;
      if (it.type === 'service') {
        if (st) out += '<rect x="-21.3" y="-3.5" width="42.6" height="7" rx="2" fill="none" stroke="' + statusColor(st) + '" stroke-width="1"/>';
        if (sel) out += '<rect x="-23" y="-5.2" width="46" height="10.4" rx="3" fill="none" stroke="var(--accent)" stroke-width=".7" stroke-dasharray="1.6 1.2"/>';
      } else if (it.type === 'motor') {
        if (st) out += '<rect x="-12.3" y="-8.8" width="24.6" height="17.6" rx="3.4" fill="none" stroke="' + statusColor(st) + '" stroke-width="1"/>';
        if (sel) out += '<rect x="-14" y="-10.5" width="28" height="21" rx="4.5" fill="none" stroke="#0b6e7c" stroke-width=".7" stroke-dasharray="1.6 1.2"/>';
      } else {
        if (st) out += '<circle r="' + (T.r + 1.5) + '" fill="none" stroke="' + statusColor(st) + '" stroke-width="1.1"/>';
        if (sel) out += '<circle r="' + (T.r + 3.2) + '" fill="none" stroke="#0b6e7c" stroke-width=".7" stroke-dasharray="1.6 1.2"/>';
      }
      return out;
    }
    function hit(it) {
      if (it.type === 'service') return '<rect x="-22" y="-7" width="44" height="14" fill="transparent"/>';
      if (it.type === 'motor') return '<rect x="-12" y="-9" width="24" height="18" fill="transparent"/>';
      return '<circle r="6.5" fill="transparent"/>';
    }
    function wallSvg() {
      var o = '', t = 8, geo = {
        top:    { x: -t, y: -t, w: W + 2 * t, h: t, tx: W / 2, ty: -2.4, rot: 0 },
        bottom: { x: -t, y: H, w: W + 2 * t, h: t, tx: W / 2, ty: H + 5.6, rot: 0 },
        left:   { x: -t, y: 0, w: t, h: H, tx: -2.6, ty: H / 2, rot: -90 },
        right:  { x: W, y: 0, w: t, h: H, tx: W + 5.4, ty: H / 2, rot: -90 }
      };
      Object.keys(geo).forEach(function (s) {
        var g = geo[s], on = S.walls[s], tr = g.rot ? ' transform="rotate(' + g.rot + ' ' + g.tx + ' ' + g.ty + ')"' : '';
        var box = 'x="' + g.x + '" y="' + g.y + '" width="' + g.w + '" height="' + g.h + '"';
        o += '<g class="wallzone" data-wall="' + s + '"' + (readOnly ? '' : ' style="cursor:pointer"') + '>';
        if (on) o += '<rect ' + box + ' fill="var(--wall)"/><rect ' + box + ' fill="url(#skHatch)"/><text class="t-wall" text-anchor="middle" x="' + g.tx + '" y="' + g.ty + '"' + tr + '>קיר</text>';
        else if (!readOnly) o += '<rect ' + box + ' fill="transparent" stroke="var(--line)" stroke-width=".5" stroke-dasharray="2 1.6"/><text class="t-add" text-anchor="middle" x="' + g.tx + '" y="' + g.ty + '"' + tr + '>+ קיר</text>';
        o += '</g>';
      });
      return o;
    }
    function tubSvg() {
      if (model.img) return '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/><image href="img/' + model.code + (model.sides ? '-' + (S.side || 'R') : '') + '.jpg" x="0" y="0" width="' + W + '" height="' + H + '" preserveAspectRatio="none"/>';
      // no picture for this model yet: a plain outline at the model's size
      if (model.shape === 'corner') return '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/><path d="M0 0H' + W + 'V' + H + 'H' + (W * 0.72) + 'Q' + (W * 0.05) + ' ' + (H * 0.95) + ' 0 ' + (H * 0.28) + 'Z" fill="#f1efed" stroke="#cfcac6" stroke-width=".6"/>' +
        '<path d="M' + (W * 0.14) + ' ' + (H * 0.12) + 'H' + (W * 0.88) + 'V' + (H * 0.86) + 'H' + (W * 0.74) + 'Q' + (W * 0.16) + ' ' + (H * 0.84) + ' ' + (W * 0.14) + ' ' + (H * 0.3) + 'Z" fill="#fbfaf9" stroke="#cfcac6" stroke-width=".6"/>';
      var o = '<rect x="0" y="0" width="' + W + '" height="' + H + '" rx="1" fill="#f1efed"/>';
      if (model.shape === 'round') o += '<ellipse cx="' + W / 2 + '" cy="' + H / 2 + '" rx="' + (W / 2 - 7) + '" ry="' + (H / 2 - 7) + '" fill="#fbfaf9" stroke="#cfcac6" stroke-width=".6"/>';
      else o += '<rect x="7" y="7" width="' + (W - 14) + '" height="' + (H - 14) + '" rx="' + Math.min(18, H / 3) + '" fill="#fbfaf9" stroke="#cfcac6" stroke-width=".6"/>';
      return o;
    }
    function renderBoard() {
      var o = '<defs><clipPath id="skClip"><rect x="0" y="0" width="' + W + '" height="' + H + '" rx="1"/></clipPath>' +
        '<pattern id="skHatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1" height="3" fill="rgba(0,0,0,.22)"/></pattern></defs>';
      o += wallSvg() + tubSvg();
      if (!model.sides && model.shape !== 'corner') o += '<rect x="0" y="0" width="' + W + '" height="' + H + '" rx="1" fill="none" stroke="var(--muted)" stroke-width=".5"/>';
      o += '<path d="M0 -14H' + W + 'M0 -16V-12M' + W + ' -16V-12" stroke="var(--muted)" stroke-width=".4" fill="none"/>' +
        '<rect x="' + (W / 2 - 13) + '" y="-17.2" width="26" height="6.4" fill="var(--surface)"/><text class="t-dim" text-anchor="middle" x="' + (W / 2) + '" y="-12.4">' + W + ' ' + CM + '</text>' +
        '<path d="M-14 0V' + H + 'M-16 0H-12M-16 ' + H + 'H-12" stroke="var(--muted)" stroke-width=".4" fill="none"/>' +
        '<rect x="-17.2" y="' + (H / 2 - 10) + '" width="6.4" height="20" fill="var(--surface)"/><text class="t-dim" text-anchor="middle" x="-12.4" y="' + (H / 2) + '" transform="rotate(-90 -12.4 ' + (H / 2) + ')">' + H + ' ' + CM + '</text>';
      S.removed.forEach(function (it) {
        o += '<g data-ghost="' + it.id + '" transform="' + tf({ type: it.type, x: it.std.x, y: it.std.y, side: it.std.side }) + '"' + (readOnly ? '' : ' style="cursor:pointer"') + '>' +
          '<circle r="6.5" fill="transparent"/><circle r="3.4" fill="none" stroke="var(--bad)" stroke-width=".7" stroke-dasharray="1.4 1"/><path d="M-1.9 -1.9L1.9 1.9M1.9 -1.9L-1.9 1.9" stroke="var(--bad)" stroke-width=".8"/></g>';
      });
      S.items.slice().sort(function (a, b) { return (b.type === 'motor') - (a.type === 'motor') || (b.type === 'service') - (a.type === 'service'); })
        .forEach(function (it) { o += '<g class="it" data-id="' + it.id + '" transform="' + tf(it) + '">' + hit(it) + ringFor(it) + symbol(it) + '</g>'; });
      svg.innerHTML = o;
    }
    function where(it) {
      if (it.type === 'service') return 'בצד ה' + SIDES[it.side] + ' · מרכז הפתח ' + ((it.side === 'top' || it.side === 'bottom') ? r1(it.x) + ' ' + CM + ' מהקצה השמאלי' : r1(it.y) + ' ' + CM + ' מהדופן האחורית');
      return r1(it.x) + ' ' + CM + ' מהקצה השמאלי · ' + r1(it.y) + ' ' + CM + ' מהדופן האחורית';
    }
    function find(id) { return S.items.find(function (i) { return i.id === id; }); }
    function renderSel() {
      var box = $('skSel'), it = find(selId);
      if (!it) { box.hidden = true; box.innerHTML = ''; return; }
      var st = status(it), stTxt = st === 'added' ? ' · נוסף' : st === 'moved' ? ' · הוזז ' + r1(dist(it, it.std)) + ' ' + CM + ' מהסטנדרט' : ' · במקום הסטנדרטי';
      box.hidden = false;
      box.innerHTML = '<div><strong>' + nameOf(it) + '</strong>' + stTxt + '<div class="where">' + where(it) + '</div></div>' + (readOnly ? '' :
        '<div class="row"><div class="nudge" aria-label="הזזה עדינה"><button class="btn" type="button" data-n="-1,0" aria-label="שמאלה">←</button><button class="btn" type="button" data-n="0,-1" aria-label="למעלה">↑</button>' +
        '<button class="btn" type="button" data-n="0,1" aria-label="למטה">↓</button><button class="btn" type="button" data-n="1,0" aria-label="ימינה">→</button></div>' +
        (it.type === 'jet' ? '<button class="btn" type="button" data-act="size">החלף ל-' + (jsize(it) === 2 ? 3 : 2) + '"</button>' : '') +
        (st === 'moved' ? '<button class="btn" type="button" data-act="back">החזר למקום</button>' : '') + '<button class="btn danger" type="button" data-act="del">הסר</button></div>');
    }
    function counts(items) { var c = {}; items.forEach(function (i) { c[i.type] = (c[i.type] || 0) + 1; }); return c; }
    function motorToService(m, s) {
      var horiz = s.side === 'top' || s.side === 'bottom', half = TYPES.service.len / 2;
      var px = horiz ? clamp(m.x, s.x - half, s.x + half) : s.x, py = horiz ? s.y : clamp(m.y, s.y - half, s.y + half);
      return Math.hypot(m.x - px, m.y - py);
    }
    function issues() {
      var out = [], svc = S.items.filter(function (i) { return i.type === 'service'; }), motors = S.items.filter(function (i) { return i.type === 'motor'; });
      if (model.sides && !S.side) out.push(['bad', 'לא נבחר כיוון האמבטיה: ימין או שמאל.']);
      if (!svc.length) out.push(['bad', 'אין פתח שירות בשרטוט.']);
      svc.forEach(function (s) { if (S.walls[s.side]) out.push(['bad', 'פתח השירות בצד ה' + SIDES[s.side] + ', ושם מסומן קיר. צריך להעביר את הפתח לצד פתוח.']); });
      if (!Object.keys(SIDES).some(function (k) { return !S.walls[k]; })) out.push(['bad', 'האמבטיה סגורה בקירות מכל ארבעת הצדדים. אין מאיפה לגשת.']);
      var jets = S.items.filter(function (i) { return i.type === 'jet'; }), close = 0;
      for (var a = 0; a < jets.length; a++) for (var b = a + 1; b < jets.length; b++) if (dist(jets[a], jets[b]) < 6) close++;
      if (close) out.push(['warn', "יש ג'טים במרחק של פחות מ-6 " + CM + ' זה מזה.']);
      if (JETS[system] && jets.length !== JETS[system]) out.push(['warn', 'במערכת ' + system + " יש " + JETS[system] + " ג'טים, ובשרטוט מסומנים " + jets.length + '.']);
      return out;
    }
    function renderLists() {
      var list = issues();
      $('skIssues').innerHTML = list.length ? list.map(function (i) { return '<div class="issue ' + i[0] + '">' + esc(i[1]) + '</div>'; }).join('') : '<div class="issue ok">השרטוט תקין: פתח השירות פונה לצד פתוח.</div>';
      var li = [], walls = Object.keys(SIDES).filter(function (k) { return S.walls[k]; }).map(function (k) { return SIDES[k]; });
      if (model.sides) li.push('<li><span class="dot wall"></span><span>כיוון האמבטיה: ' + (S.side === 'R' ? 'ימין' : S.side === 'L' ? 'שמאל' : 'לא נבחר') + '</span></li>');
      li.push('<li><span class="dot wall"></span><span>קירות: ' + (walls.length ? walls.join(', ') : 'אין (אמבטיה חופשית)') + '</span></li>');
      S.items.forEach(function (it) {
        var st = status(it);
        if (st === 'moved') li.push('<li><span class="dot moved"></span><span>' + nameOf(it) + (dist(it, it.std) > 1.5 || it.type === 'service' ? ' הוזז ' + r1(dist(it, it.std)) + ' ' + CM : ' במקום ' + it.std.size + '"') + ' · עכשיו ' + where(it) + '</span></li>');
        if (st === 'added') li.push('<li><span class="dot added"></span><span>' + (it.type === 'jet' && !(tpl && tpl[system]) ? '' : 'נוסף ') + nameOf(it) + ' · ' + where(it) + '</span></li>');
      });
      S.removed.forEach(function (it) { li.push('<li><span class="dot removed"></span><span>הוסר ' + nameOf(it) + ' סטנדרטי</span></li>'); });
      if (S.finish === 'white') li.push('<li><span class="dot added"></span><span>' + "גימור ג'טים לבן (שדרוג)" + '</span></li>');
      if (li.length === (model.sides ? 2 : 1)) li.push('<li class="empty">אין שינויים מהתבנית הסטנדרטית.</li>');
      $('skChanges').innerHTML = li.join('');
      function counts2(items) { var c = {}; items.forEach(function (i) { var k = i.type === 'jet' ? 'jet' + jsize(i) : i.type; c[k] = (c[k] || 0) + 1; }); return c; }
      var c = counts2(S.items), std = counts2(template()), rows = '', fin = S.finish === 'white' ? 'לבן' : 'אפור';
      [2, 3].forEach(function (z) {
        var n = c['jet' + z] || 0, s0 = std['jet' + z] || 0; if (!n && !s0) return;
        var d = n - s0, diff = d && tpl && tpl[system] ? '<span class="diff">' + (d > 0 ? '+' + d : d) + ' מהסטנדרט</span>' : '';
        rows += '<tr><td>' + "ג'ט " + z + '" ' + fin + diff + '</td><td class="n">' + n + '</td></tr>';
      });
      ORDER.forEach(function (t) {
        if (t === 'jet') return;
        var n = c[t] || 0, s = std[t] || 0; if (!n && !s) return;
        var d = n - s, diff = d && (t !== 'jet' || (tpl && tpl[system])) ? '<span class="diff">' + (d > 0 ? '+' + d : d) + ' מהסטנדרט</span>' : '';
        rows += '<tr><td>' + TYPES[t].name + (t === 'jet' ? ' ' + (S.finish === 'white' ? 'לבן' : 'אפור') : '') + diff + '</td><td class="n">' + n + '</td></tr>';
      });
      $('skKit').innerHTML = rows;
      return list;
    }
    function renderAll() {
      renderBoard(); renderSel(); renderLists();
      $('skSide').hidden = !model.sides || !!opt.customer;
      if (model.sides) $('skSide').innerHTML = '<span>כיוון האמבטיה:</span>' + [['R', 'ימין'], ['L', 'שמאל']].map(function (f) {
        return '<button class="btn' + (S.side === f[0] ? ' primary' : '') + '" type="button" data-side="' + f[0] + '"' + (readOnly ? ' disabled' : '') + '>' + f[1] + '</button>'; }).join('') + (S.side ? '' : '<span class="who">צריך לבחור</span>');
      $('skFinish').innerHTML = '<span>' + "גימור ג'טים:" + '</span>' + [['grey', 'אפור · סטנדרט'], ['white', 'לבן · שדרוג']].map(function (f) {
        return '<button class="btn' + (S.finish === f[0] ? ' primary' : '') + '" type="button" data-finish="' + f[0] + '"' + (readOnly ? ' disabled' : '') + '>' + f[1] + '</button>'; }).join('');
      var hasMotor = S.items.some(function (i) { return i.type === 'motor'; });
      $('skPalWrap').hidden = readOnly;
      $('skPal').innerHTML = [['jet', 2], ['jet', 3], ['faucet'], ['shower'], ['service']].map(function (p) {
        var t = p[0], demo = { type: t, size: p[1] };
        var vb = t === 'service' ? '-22 -8 44 16' : t === 'motor' ? '-13 -10 26 20' : '-5 -5 10 10';
        return '<button class="btn" type="button" data-add="' + t + '"' + (p[1] ? ' data-size="' + p[1] + '"' : '') + (t === 'motor' && hasMotor ? ' disabled' : '') + '><svg viewBox="' + vb + '" aria-hidden="true">' + symbol(demo, true) + '</svg><span>' + nameOf(demo) + '</span></button>'; }).join('');
      $('skHint').textContent = readOnly ? (opt.readOnlyNote || 'תצוגה בלבד.') : 'גוררים פריט כדי להזיז. לוחצים על צד של האמבטיה כדי להוסיף או להסיר קיר.';
      var note = $('skNote'); note.hidden = !!(tpl && tpl[system]) || readOnly;
      note.textContent = "לדגם הזה עדיין אין תבנית ג'טים סטנדרטית, אז מסמנים את הג'טים ידנית. מיקום פתח השירות הוא נקודת התחלה בלבד.";
      $('skSave').hidden = readOnly; $('skSave').disabled = saving || !dirty; $('skSave').textContent = saving ? 'שומר…' : dirty ? 'שמירת השרטוט' : 'נשמר';
      $('skReset').hidden = readOnly; $('skReset').textContent = armed.reset ? 'ללחוץ שוב כדי לאפס' : 'איפוס לסטנדרט';
      $('skClose').textContent = armed.close ? 'לצאת בלי לשמור?' : 'חזרה ללוח';
      $('skNotes').disabled = readOnly;
    }
    function touch() { dirty = true; renderAll(); }
    function arm(key) { if (armed[key]) { armed[key] = false; return true; } armed[key] = true; setTimeout(function () { if (armed[key]) { armed[key] = false; renderAll(); } }, 3500); renderAll(); return false; }
    function place(it, x, y) {
      if (it.type === 'service') {
        var d = { top: Math.abs(y), bottom: Math.abs(y - H), left: Math.abs(x), right: Math.abs(x - W) }, best = 'top', half = Math.min(TYPES.service.len / 2, Math.min(W, H) / 2);
        Object.keys(d).forEach(function (k) { if (d[k] < d[best]) best = k; });
        it.side = best;
        if (best === 'top' || best === 'bottom') { it.x = clamp(x, half, W - half); it.y = best === 'top' ? 0 : H; }
        else { it.y = clamp(y, half, H - half); it.x = best === 'left' ? 0 : W; }
      } else if (it.type === 'motor') { it.x = clamp(x, 11, W - 11); it.y = clamp(y, 7.5, H - 7.5); }
      else { var r = TYPES[it.type].r; it.x = clamp(x, r, W - r); it.y = clamp(y, r, H - r); }
    }
    function pt(ev) { var p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; var m = svg.getScreenCTM(); return m ? p.matrixTransform(m.inverse()) : { x: 0, y: 0 }; }

    svg.addEventListener('pointerdown', function (ev) {
      var g = ev.target.closest && ev.target.closest('.it'); if (!g) return;
      var it = find(g.getAttribute('data-id')); if (!it) return;
      if (readOnly) { selId = it.id; renderAll(); return; }
      var p = pt(ev);
      drag = { it: it, g: g, dx: it.x - p.x, dy: it.y - p.y, moved: false, sx: ev.clientX, sy: ev.clientY, pid: ev.pointerId };
      try { svg.setPointerCapture(ev.pointerId); } catch (e) {}
      ev.preventDefault();
    });
    svg.addEventListener('pointermove', function (ev) {
      if (!drag || ev.pointerId !== drag.pid) return;
      if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < 4) return;
      drag.moved = true; var p = pt(ev); place(drag.it, p.x + drag.dx, p.y + drag.dy); drag.g.setAttribute('transform', tf(drag.it));
    });
    function endDrag(ev) { if (!drag || ev.pointerId !== drag.pid) return; selId = drag.it.id; var m = drag.moved; drag = null; if (m) dirty = true; renderAll(); }
    svg.addEventListener('pointerup', endDrag); svg.addEventListener('pointercancel', endDrag);
    svg.addEventListener('click', function (ev) {
      if (readOnly) return;
      var w = ev.target.closest && ev.target.closest('[data-wall]');
      if (w) { var s = w.getAttribute('data-wall'); S.walls[s] = !S.walls[s]; touch(); return; }
      var gh = ev.target.closest && ev.target.closest('[data-ghost]');
      if (gh) { var id = gh.getAttribute('data-ghost'), idx = S.removed.findIndex(function (i) { return i.id === id; });
        if (idx > -1) { var it = S.removed.splice(idx, 1)[0]; it.x = it.std.x; it.y = it.std.y; if (it.std.side) it.side = it.std.side; S.items.push(it); selId = it.id; touch(); } return; }
      if (!(ev.target.closest && ev.target.closest('.it'))) { selId = null; renderAll(); }
    });
    $('skSel').addEventListener('click', function (ev) {
      var b = ev.target.closest('button'), it = find(selId); if (!b || !it || readOnly) return;
      if (b.dataset.n) { var d = b.dataset.n.split(','); place(it, it.x + (+d[0]), it.y + (+d[1])); }
      else if (b.dataset.act === 'size') { it.size = jsize(it) === 2 ? 3 : 2; }
      else if (b.dataset.act === 'back') { it.x = it.std.x; it.y = it.std.y; if (it.std.side) it.side = it.std.side; if (it.std.size) it.size = it.std.size; }
      else if (b.dataset.act === 'del') { S.items = S.items.filter(function (i) { return i.id !== it.id; }); if (it.std) S.removed.push(it); selId = null; }
      touch();
    });
    $('skPal').addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-add]'); if (!b || b.disabled || readOnly) return;
      var t = b.dataset.add, n = S.items.filter(function (i) { return i.type === t && !i.std; }).length, it = { id: 'a' + (++uid), type: t, x: 0, y: 0, std: null };
      if (t === 'jet') it.size = b.dataset.size === '2' ? 2 : 3;
      if (t === 'faucet') place(it, W * 0.74 - n * 9, 3.6);
      else if (t === 'shower') place(it, W * 0.83 - n * 9, 3.6);
      else if (t === 'service') { var o = ['bottom', 'left', 'right', 'top'].filter(function (k) { return !S.walls[k]; })[0] || 'bottom', at = { bottom: [W / 2, H], top: [W / 2, 0], left: [0, H / 2], right: [W, H / 2] }[o]; place(it, at[0], at[1]); }
      else if (t === 'motor') place(it, 22, H - 22);
      else place(it, W * 0.4 + (n % 6) * 8, H / 2);
      S.items.push(it); selId = it.id; touch();
    });
    $('skSide').addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-side]'); if (!b || b.disabled || b.dataset.side === S.side) return;
      if ((S.side || 'R') !== b.dataset.side) { // the drawing starts right-handed; switching hand mirrors it left to right
        var flip = function (it) { it.x = W - it.x; if (it.side === 'left') it.side = 'right'; else if (it.side === 'right') it.side = 'left'; };
        S.items.forEach(function (it) { flip(it); if (it.std) flip(it.std); }); S.removed.forEach(function (it) { if (it.std) flip(it.std); });
        var l = S.walls.left; S.walls.left = S.walls.right; S.walls.right = l;
      }
      S.side = b.dataset.side; touch();
    });
    $('skFinish').addEventListener('click', function (ev) { var b = ev.target.closest('button[data-finish]'); if (!b || b.disabled) return; S.finish = b.dataset.finish; touch(); });
    $('skReset').addEventListener('click', function () { if (readOnly) return; if (arm('reset')) { var notes = S.notes; uid = 0; S = fresh(); S.notes = notes; selId = null; touch(); } });
    $('skNotes').value = S.notes || '';
    $('skNotes').addEventListener('input', function () { S.notes = this.value; dirty = true; $('skSave').disabled = false; $('skSave').textContent = 'שמירת השרטוט'; });
    $('skSave').addEventListener('click', async function () {
      if (saving || !dirty) return; saving = true; renderAll();
      try { await opt.onSave(JSON.parse(JSON.stringify(S)), { blocking: issues().some(function (i) { return i[0] === 'bad'; }) }); dirty = false; }
      catch (e) { var n = $('skNote'); n.hidden = false; n.textContent = 'השרטוט לא נשמר. בדקו את החיבור ונסו שוב.'; saving = false; $('skSave').disabled = false; $('skSave').textContent = 'שמירת השרטוט'; return; }
      saving = false; renderAll();
    });
    $('skClose').addEventListener('click', function () { if (dirty && !readOnly && !arm('close')) return; host.hidden = true; host.innerHTML = ''; if (opt.onClose) opt.onClose(); });
    host.hidden = false; host.scrollTop = 0;
    renderAll();
  }
  // True when a saved drawing has a problem that must be fixed before the customer can approve it.
  function hasBlocking(data) { return !!(data && data.blocking); }
  return { open: open, hasBlocking: hasBlocking };
})();

/* ===========================================================
   履歴(日別タイムライン)と編集ダイアログ
   =========================================================== */

var HOUR_PX = 46;
var MIN_BLOCK_PX = 30;
var editingId = null;

function renderHistory() {
  if (!App.currentDay) App.currentDay = todayKeyLocal();
  document.getElementById('day-label').textContent = dayLabel(App.currentDay);

  api('sessionsForDay', [App.currentDay])
    .then(function (d) {
      document.getElementById('day-total').textContent = fmtHM(d.total);
      drawTimeline(d.sessions);
    })
    .catch(function (e) { toast(e.message); });
}

function shiftDay(delta) {
  var p = App.currentDay.split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  d.setUTCDate(d.getUTCDate() + delta);
  App.currentDay = d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  renderHistory();
}

function drawTimeline(sessions) {
  var wrap = document.getElementById('timeline');
  wrap.textContent = '';

  if (!sessions.length) {
    wrap.appendChild(el('div', 'tl-empty', 'この日の記録はありません'));
    return;
  }

  var startHours = sessions.map(function (s) { return hourOf(s.start); });
  var endHours = sessions.map(function (s) { return hourOf(s.end) + 1; });
  var from = Math.max(0, Math.min.apply(null, startHours));
  var to = Math.min(24, Math.max.apply(null, endHours));
  if (to - from < 4) to = Math.min(24, from + 4);

  var axis = el('div', 'tl-axis');
  for (var h = from; h < to; h++) {
    var row = el('div', 'tl-hour num', h + ':00');
    row.style.height = HOUR_PX + 'px';
    axis.appendChild(row);
  }
  wrap.appendChild(axis);

  var track = el('div', 'tl-track');
  track.style.height = (to - from) * HOUR_PX + 'px';

  sessions.forEach(function (s) {
    var startMin = minutesOf(s.start) - from * 60;
    var block = el('button', 'tl-block');
    block.type = 'button';
    block.style.setProperty('--c', subjectColor(s.subject));
    block.style.top = (startMin / 60) * HOUR_PX + 'px';
    block.style.height = Math.max(MIN_BLOCK_PX, (s.minutes / 60) * HOUR_PX) + 'px';

    block.appendChild(el('div', 's', s.subject));
    var meta = isoTime(s.start) + ' – ' + isoTime(s.end) + ' · ' + s.minutes + '分';
    if (s.format) meta += ' · ' + s.format;
    if (s.source === 'atimelogger') meta += ' · aTimeLogger';
    block.appendChild(el('div', 'm num', meta));
    if (s.memo) block.appendChild(el('div', 'm', s.memo));

    block.addEventListener('click', function () { openSheet(s); });
    track.appendChild(block);
  });

  wrap.appendChild(track);
}

function hourOf(iso) { return parseInt(String(iso).substr(11, 2), 10) || 0; }
function minutesOf(iso) {
  return (parseInt(String(iso).substr(11, 2), 10) || 0) * 60 +
         (parseInt(String(iso).substr(14, 2), 10) || 0);
}

/* ---------- 編集 / 追加 ---------- */

function fillSelects() {
  var subj = document.getElementById('f-subject');
  var fmt = document.getElementById('f-format');
  if (subj.childElementCount) return;

  (App.stats.subjectOrder || []).forEach(function (s) {
    var o = el('option', null, s);
    o.value = s;
    subj.appendChild(o);
  });
  var none = el('option', null, '（未設定）');
  none.value = '';
  fmt.appendChild(none);
  (App.stats.formats || []).forEach(function (f) {
    var o = el('option', null, f);
    o.value = f;
    fmt.appendChild(o);
  });
}

function openSheet(session) {
  fillSelects();
  editingId = session ? session.id : null;

  document.getElementById('sheet-title').textContent = session ? '記録を編集' : '記録を追加';
  document.getElementById('sheet-delete').hidden = !session;
  document.getElementById('sheet-error').hidden = true;

  if (session) {
    document.getElementById('f-subject').value = session.subject;
    document.getElementById('f-format').value = session.format || '';
    document.getElementById('f-start').value = isoToLocalInput(session.start);
    document.getElementById('f-end').value = isoToLocalInput(session.end);
    document.getElementById('f-memo').value = session.memo || '';
  } else {
    document.getElementById('f-subject').value = (App.stats.subjectOrder || [''])[0];
    document.getElementById('f-format').value = App.lastFormat || '';
    document.getElementById('f-start').value = App.currentDay + 'T09:00';
    document.getElementById('f-end').value = App.currentDay + 'T10:00';
    document.getElementById('f-memo').value = '';
  }
  document.getElementById('sheet').hidden = false;
}

function closeSheet() {
  document.getElementById('sheet').hidden = true;
  editingId = null;
}

function sheetError(msg) {
  var e = document.getElementById('sheet-error');
  e.textContent = msg;
  e.hidden = false;
}

function saveSheet() {
  var payload = {
    subject: document.getElementById('f-subject').value,
    format: document.getElementById('f-format').value,
    start: localInputToIso(document.getElementById('f-start').value),
    end: localInputToIso(document.getElementById('f-end').value),
    memo: document.getElementById('f-memo').value,
  };
  if (!payload.start || !payload.end) {
    sheetError('開始と終了の両方を入れてください。');
    return;
  }

  var wasEditing = editingId;
  var p = wasEditing
    ? api('editSession', [wasEditing, payload])
    : api('addManual', [payload]);

  p.then(function (d) {
    closeSheet();
    applyStats(d.stats);
    renderHistory();
    toast(wasEditing ? '更新しました' : fmtJp(d.session.minutes) + '記録しました');
  }).catch(function (e) { sheetError(e.message); });
}

function deleteSheet() {
  if (!editingId) return;
  api('deleteSession', [editingId])
    .then(function (d) {
      closeSheet();
      applyStats(d.stats);
      renderHistory();
      toast('削除しました');
    })
    .catch(function (e) { sheetError(e.message); });
}

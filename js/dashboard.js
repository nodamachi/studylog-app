/* ===========================================================
   ダッシュボード
   =========================================================== */

var RING1_CIRC = 2 * Math.PI * 70;
var RING2_CIRC = 2 * Math.PI * 55;
var BAR_MAX = 78;          // バー本体に使える高さ(px)。残りはラベル。
var BAR_LABEL_SPACE = 22;
var HEAT_LEVELS = ['#1d2230', '#2b3348', '#3f4b6b', '#5d6f9c', '#8fa0c4'];

function renderDashboard() {
  var s = App.stats;
  if (!s) return;

  document.getElementById('dash-date').textContent = dayLabel(s.today.dayKey);

  renderRing(s.today);
  renderStreak(s.streak);
  renderWeek(s.week);
  renderStale(s.stale, s.colors);
  renderDonut(s.subjects, s.colors);
  renderHeatmap(s.heatmap);
  renderTotals(s.totals, s.exam);
}

/* ---------- 達成リング ---------- */

function renderRing(today) {
  var p1 = Math.min(1, today.target > 0 ? today.minutes / today.target : 0);
  var span = Math.max(1, today.stretch - today.target);
  var p2 = Math.max(0, Math.min(1, (today.minutes - today.target) / span));

  var a1 = document.getElementById('ring-arc-1');
  a1.setAttribute('stroke-dasharray', RING1_CIRC);
  a1.setAttribute('stroke-dashoffset', RING1_CIRC * (1 - p1));

  var a2 = document.getElementById('ring-arc-2');
  a2.setAttribute('stroke-dasharray', RING2_CIRC);
  a2.setAttribute('stroke-dashoffset', RING2_CIRC * (1 - p2));

  document.getElementById('ring-value').textContent = fmtHM(today.minutes);
  document.getElementById('ring-target').textContent = '目標 ' + fmtHM(today.target);
  document.getElementById('legend-target').textContent = today.target;
  document.getElementById('legend-stretch').textContent = today.stretch;
}

/* ---------- ストリーク ---------- */

function renderStreak(streak) {
  document.getElementById('streak-days').textContent = streak.days;

  var note;
  if (streak.days === 0) {
    note = 'まだ記録がありません。';
  } else if (!streak.studiedToday && streak.restsLast7 >= 1) {
    note = '今日はまだ記録がありません。あと1日空けると途切れます。';
  } else if (streak.restsLast7 >= 1) {
    note = '直近7日の休みは ' + streak.restsLast7 + ' 日。あと1日空けると途切れます。';
  } else {
    note = '直近7日は休みなし。';
  }
  document.getElementById('streak-note').textContent = note;
}

/* ---------- 週次バー ---------- */

function renderWeek(week) {
  var wrap = document.getElementById('week-bars');
  wrap.textContent = '';

  var maxMin = 0;
  week.bars.forEach(function (b) { if (b.minutes > maxMin) maxMin = b.minutes; });
  var scale = Math.max(maxMin, week.dailyTarget) * 1.15 || 1;
  var goalBottom = BAR_LABEL_SPACE + (week.dailyTarget / scale) * BAR_MAX;

  var line = el('div', 'goal-line');
  line.style.bottom = goalBottom + 'px';
  wrap.appendChild(line);

  var tag = el('span', 'goal-tag', week.dailyTarget + '分');
  tag.style.bottom = goalBottom + 'px';
  wrap.appendChild(tag);

  week.bars.forEach(function (b) {
    var col = el('div', 'bar-col');
    var bar = el('div', 'bar' + (b.isToday ? ' is-today' : ''));
    bar.style.height = Math.max(2, (b.minutes / scale) * BAR_MAX) + 'px';
    bar.title = dayLabel(b.dayKey) + ' ' + fmtJp(b.minutes);
    col.appendChild(bar);
    col.appendChild(el('div', 'bar-lab', WEEKDAYS[b.weekdayIndex]));
    wrap.appendChild(col);
  });
}

/* ---------- 科目バランス警告 ---------- */

function renderStale(stale, colors) {
  var card = document.getElementById('stale-card');
  var list = document.getElementById('stale-list');
  list.textContent = '';

  if (!stale.items.length) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  stale.items.forEach(function (item) {
    var row = el('div', 'stale');
    row.style.setProperty('--c', (colors && colors[item.subject]) || '#9ba6b1');
    row.appendChild(el('i'));
    row.appendChild(el('span', 'stale-name', item.subject));
    row.appendChild(el('span', 'stale-pill num',
      item.never ? '記録なし' : item.daysSince + '日ぶり'));
    list.appendChild(row);
  });
}

/* ---------- 科目別ドーナツ ---------- */

function renderDonut(subjects, colors) {
  var svg = document.getElementById('donut');
  var legend = document.getElementById('donut-legend');
  svg.textContent = '';
  legend.textContent = '';

  if (!subjects.items.length) {
    legend.appendChild(el('div', 'legend-item', 'この4週の記録はありません'));
    return;
  }

  var offset = 0;
  subjects.items.forEach(function (item) {
    var pct = item.ratio * 100;
    var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', '21');
    c.setAttribute('cy', '21');
    c.setAttribute('r', '15.9');
    c.setAttribute('stroke', (colors && colors[item.subject]) || '#9ba6b1');
    c.setAttribute('stroke-dasharray', pct.toFixed(2) + ' ' + (100 - pct).toFixed(2));
    c.setAttribute('stroke-dashoffset', String(-offset.toFixed(2)));
    svg.appendChild(c);
    offset += pct;
  });

  var top = subjects.items.slice(0, 5);
  var rest = subjects.items.slice(5);

  top.forEach(function (item) {
    legend.appendChild(legendRow(item.subject, Math.round(item.ratio * 100) + '%',
      (colors && colors[item.subject]) || '#9ba6b1'));
  });
  if (rest.length) {
    var restPct = rest.reduce(function (t, x) { return t + x.ratio; }, 0);
    legend.appendChild(legendRow('他' + rest.length + '科目',
      Math.round(restPct * 100) + '%', '#9ba6b1'));
  }
}

function legendRow(name, value, color) {
  var row = el('div', 'legend-item');
  row.style.setProperty('--c', color);
  row.appendChild(el('i'));
  row.appendChild(document.createTextNode(name));
  row.appendChild(el('span', 'num', value));
  return row;
}

/* ---------- ヒートマップ ---------- */

function renderHeatmap(heat) {
  var wrap = document.getElementById('heatmap');
  wrap.textContent = '';
  var max = Math.max(heat.maxMinutes, 1);

  heat.weeks.forEach(function (week) {
    var col = el('div', 'heat-col');
    week.forEach(function (day) {
      var cell = el('div', 'heat-cell');
      if (!day.future) {
        cell.style.background = HEAT_LEVELS[heatLevel(day.minutes, max)];
        cell.title = dayLabel(day.dayKey) + ' ' + fmtJp(day.minutes);
      } else {
        cell.style.visibility = 'hidden';
      }
      col.appendChild(cell);
    });
    wrap.appendChild(col);
  });
  wrap.scrollLeft = wrap.scrollWidth;
}

function heatLevel(minutes, max) {
  if (minutes <= 0) return 0;
  var r = minutes / max;
  if (r <= 0.25) return 1;
  if (r <= 0.5) return 2;
  if (r <= 0.8) return 3;
  return 4;
}

/* ---------- 累計 ---------- */

function renderTotals(totals, exam) {
  document.getElementById('total-minutes').textContent = fmtHM(totals.minutes);
  document.getElementById('total-days').textContent = totals.days;

  var cd = document.getElementById('countdown');
  cd.textContent = '';
  if (exam && exam.daysLeft !== null && exam.daysLeft !== undefined) {
    cd.appendChild(document.createTextNode(exam.label + 'まで'));
    cd.appendChild(el('b', 'num', exam.daysLeft));
    cd.appendChild(document.createTextNode('日'));
  }
}

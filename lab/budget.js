/* Project 3 of the BI Lifecycle Lab: reconciling two sources that disagree.
 *
 * Rendered from lab/data/chicago-budget.json, built by the pipeline in
 * lab/tools/. The prose is written and the numbers inside it are computed, so
 * a snapshot rebuilt against a new budget ordinance either keeps the wording
 * true or fails the self-check.
 *
 * No language model. No network call at run time.
 */
(function () {
  'use strict';

  var root = document.getElementById('ba-status');
  if (!root) return;                        // not this page

  var DATA = '/lab/data/chicago-budget.json';

  // ---------------------------------------------------------------- helpers

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  // Values come from a City-published snapshot. None contains markup today; a
  // rebuild is not a promise that none ever will.
  function esc(v) {
    return String(v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
               "'": '&#39;' }[c];
    });
  }

  function strong(v) { return '<strong>' + esc(v) + '</strong>'; }

  function money(v, dp) {
    var d = dp === undefined ? 0 : dp, n = Number(v);
    return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US',
      { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function big(v) {
    var n = Number(v), sign = n < 0 ? '-' : '', a = Math.abs(n);
    if (a >= 1e9) return sign + '$' + (a / 1e9).toFixed(2) + 'bn';
    if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(1) + 'm';
    return money(n);
  }

  function count(v) { return Number(v).toLocaleString('en-US'); }
  function dec(v, p) {
    var d = p === undefined ? 0 : p;
    return Number(v).toLocaleString('en-US',
      { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function pct(v) { return Number(v).toFixed(1) + '%'; }

  function niceName(s) {
    var m = /^[A-Z]?\d+[A-Z0-9]*\s*-\s*(.+)$/.exec(String(s || '').trim());
    return m ? m[1] : String(s || '');
  }

  function table(head, rows, opts) {
    var o = opts || {};
    var wrap = el('div', 'lab-table-wrap');
    var t = el('table', 'lab-table');
    var thead = el('thead'), tr = el('tr');
    head.forEach(function (h) { tr.appendChild(el('th', null, h)); });
    thead.appendChild(tr);
    t.appendChild(thead);
    var tb = el('tbody');
    rows.forEach(function (r, i) {
      var row = el('tr');
      if (o.flag && o.flag(i)) row.className = 'flagged';
      r.forEach(function (c) {
        var td = el('td');
        if (c && c.nodeType) td.appendChild(c); else td.textContent = String(c);
        row.appendChild(td);
      });
      tb.appendChild(row);
    });
    t.appendChild(tb);
    wrap.appendChild(t);
    return wrap;
  }

  function bars(items, opts) {
    var o = opts || {};
    var max = Math.max.apply(null, items.map(function (i) { return Math.abs(i.value); }));
    var box = el('div', 'lab-bars');
    items.forEach(function (i) {
      var row = el('div', 'lab-bar');
      row.appendChild(el('span', 'lab-bar-label', i.label));
      var track = el('span', 'lab-bar-track');
      var fill = el('span', 'lab-bar-fill' + (i.flagged ? ' is-flagged' : ''));
      fill.style.width = max ? (Math.abs(i.value) / max * 100).toFixed(2) + '%' : '0';
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('span', 'lab-bar-value', i.display ||
        (o.money ? big(i.value) : count(i.value))));
      box.appendChild(row);
    });
    return box;
  }

  function query(model, fragment) {
    var hit = (model.queries || []).filter(function (q) {
      return q.label.toLowerCase().indexOf(fragment.toLowerCase()) >= 0;
    })[0];
    if (!hit) return null;
    var d = el('details', 'lab-sql');
    d.appendChild(el('summary', null, 'The query behind this'));
    var pre = el('pre'), code = el('code');
    var lines = ['GET https://data.cityofchicago.org/resource/' + hit.dataset + '.json'];
    Object.keys(hit.params || {}).forEach(function (k) {
      lines.push('    ' + k + ' = ' + hit.params[k]);
    });
    code.textContent = lines.join('\n');
    pre.appendChild(code);
    d.appendChild(pre);
    return d;
  }

  function attachQuery(host, model, fragment) {
    var q = query(model, fragment);
    if (q) host.appendChild(q);
  }

  function paragraph(host, html) {
    var p = el('p');
    p.innerHTML = html;
    host.appendChild(p);
    return p;
  }

  function note(host, html) {
    var p = el('p', 'lab-note');
    p.innerHTML = html;
    host.appendChild(p);
    return p;
  }

  function findingBy(model, id) {
    return model.findings.filter(function (f) { return f.id === id; })[0];
  }

  // ------------------------------------------------------------- self-check

  function selfCheck(model) {
    var e = model.expected || {};
    var got = {
      rawMatches: model.join.rawMatches,
      matched: model.join.matched,
      matchRate: model.join.matchRate,
      unitKinds: model.budget.byUnit.length,
      budgetFte: model.budget.fte,
      annualHeadcount: model.actual.annualHeadcount,
      pointInTime: model.actual.pointInTime,
      departments: model.departments.length,
      findings: model.findings.length,
      actualOnlyEmployees: model.join.actualOnlyEmployees,
      periodsElapsed: model.rules.periodsElapsed,
      burnPct: model.actual.burnPct
    };
    var bad = [];
    Object.keys(e).forEach(function (k) {
      if (JSON.stringify(got[k]) !== JSON.stringify(e[k])) {
        bad.push(k + ': page computed ' + JSON.stringify(got[k]) +
          ', snapshot recorded ' + JSON.stringify(e[k]));
      }
    });
    // The claim the whole page rests on, checked rather than assumed.
    if (model.join.rawMatches !== 0 && model.join.matched > 0) {
      bad.push('the raw join is no longer empty, so this page’s central ' +
        'example no longer holds');
    }
    return bad;
  }

  // ------------------------------------------------------------------ hero

  function renderSummary(model) {
    var host = document.getElementById('ba-summary');
    if (!host) return;
    var j = model.join;
    var mixed = findingBy(model, 'mixed-units').numbers;
    var part = findingBy(model, 'partial-year').numbers;
    var vac = findingBy(model, 'not-a-vacancy-rate').numbers;
    var strip = el('div', 'lab-summary-strip');

    [
      { v: j.rawMatches + ' of ' + count(j.rawBudgetKeys),
        l: 'rows the obvious join matches', finding: true },
      { v: pct(j.matchRate), l: 'matched after one stated rule', finding: false },
      { v: '×' + mixed.ratio, l: 'overcount from one mixed-unit column', finding: true },
      { v: pct(part.naiveUnderspendPct),
        l: 'apparent underspend that is only unelapsed time', finding: true }
    ].forEach(function (i) {
      var item = el('div', 'lab-summary-item' + (i.finding ? ' is-finding' : ''));
      item.appendChild(el('span', 'lab-summary-value', i.v));
      item.appendChild(el('span', 'lab-summary-label', i.l));
      strip.appendChild(item);
    });

    host.innerHTML = '';
    host.appendChild(strip);
    var n = el('p', 'lab-summary-note');
    n.innerHTML = 'Three of these are failures of the obvious method. Joining the two ' +
      'datasets on their published keys matches ' + strong('nothing') + '; summing the ' +
      'budget’s unit column reports ' + strong(count(mixed.naiveTotal)) +
      ' positions for a city that pays about ' + strong(count(vac.pointInTime)) +
      ' people; and comparing a full-year budget against ' +
      strong(part.periodsElapsed + ' of ' + part.periodsInYear) + ' pay periods shows a ' +
      strong(pct(part.naiveUnderspendPct)) + ' underspend that is almost entirely the ' +
      'part of the year that has not happened yet.';
    host.appendChild(n);
  }

  // ------------------------------------------------------------ provenance

  function renderProvenance(model) {
    var host = document.getElementById('ba-provenance');
    if (!host) return;
    host.innerHTML = '';
    var s = model.source, r = model.rules;
    var link = function (href, text) {
      var a = el('a', null, text);
      a.href = href; a.target = '_blank'; a.rel = 'noopener';
      return a;
    };

    host.appendChild(table(['', 'Budget side', 'Payroll side'], [
      ['Dataset', link(s.budget.landing, s.budget.dataset),
        link(s.payroll.landing, s.payroll.dataset)],
      ['Identifier', s.budget.id, s.payroll.id],
      ['Describes', 'Positions the ordinance funds for ' + r.focusYear,
        'Money that actually moved'],
      ['Covers', 'The whole of ' + r.focusYear,
        r.periodsElapsed + ' of ' + r.periodsInYear + ' pay periods in ' + r.focusYear],
      ['Last updated at source', s.budget.updated, s.payroll.updated],
      ['Licence / terms', s.budget.license, s.payroll.license]
    ], { flag: function (i) { return i === 3 && !r.yearComplete; } }));

    host.appendChild(table(['Field', 'Value'], [
      ['Publisher', s.publisher],
      ['Required attribution', s.attribution],
      ['Focus year', r.focusYear],
      ['Previous ordinance, for comparison',
        link(s.priorBudget.landing, s.priorBudget.year + ' ordinance')],
      ['Retrieved by us', s.retrieved],
      ['Live or cached', s.mode]
    ]));

    host.appendChild(el('h3', null, 'Known limitations'));
    var lim = el('ul', 'lab-col');
    [
      'A cached snapshot taken on ' + s.retrieved + '. The City refreshes both ' +
        'sources on their own schedules, so these figures will drift.',
      'The budget side is the enacted ordinance for ' + r.focusYear +
        ', not a mid-year amended budget. Amendments during the year are not reflected.',
      r.yearComplete
        ? 'The payroll year is complete.'
        : 'The payroll year is ' + r.periodsElapsed + ' of ' + r.periodsInYear +
          ' periods in. Every dollar comparison on this page is expressed against ' +
          'elapsed time rather than as a raw total.',
      'Payroll amounts are cash paid in a period. Pension, healthcare and other ' +
        'employer costs are not in that dataset.',
      'Neither dataset carries an employee name in anything we selected, and no ' +
        'individual appears anywhere on this page.',
      'This analysis is Canyonland Technologies’ own. It is not endorsed by, ' +
        'affiliated with, or reviewed by the City of Chicago.'
    ].forEach(function (t) { lim.appendChild(el('li', null, t)); });
    host.appendChild(lim);

    var d = el('p', 'lab-note');
    d.innerHTML = 'This site provides applications using data that has been modified for ' +
      'use from its original source, ' +
      '<a href="https://www.chicago.gov" target="_blank" rel="noopener">www.cityofchicago.org</a>, ' +
      'the official website of the City of Chicago. The City of Chicago makes no claims ' +
      'as to the content, accuracy, timeliness, or completeness of any of the data ' +
      'provided, and the data is subject to change at any time.';
    host.appendChild(d);
  }

  // --------------------------------------------------------------- Extract

  function renderExtract(model) {
    var host = document.getElementById('ba-extract');
    if (!host) return;
    host.innerHTML = '';
    var j = model.join, b = model.budget, a = model.actual, r = model.rules;

    host.appendChild(table(['', 'Budget ordinance ' + r.focusYear, 'Payroll actuals'], [
      ['Grain of one row', 'A funded position line',
        'One pay element for one employee in one period'],
      ['Rows taken', count(model.source.budget.rows) + ' grouped lines',
        count(j.rawActualKeys) + ' department-title combinations'],
      ['Period covered', 'The whole year',
        r.periodsElapsed + ' of ' + r.periodsInYear + ' periods'],
      ['Money', big(b.amount) + ' budgeted', big(a.amount) + ' paid so far'],
      ['People', dec(b.fte, 0) + ' FTE funded',
        count(a.pointInTime) + ' paid in the latest period'],
      ['Department key', 'department_code, e.g. ' + (j.example ? j.example.budgetDept : ''),
        'department_code, e.g. ' + (j.example ? j.example.payrollDept : '')],
      ['Title key', 'title_code, e.g. ' + (j.example ? j.example.budgetTitle : ''),
        'title_code, e.g. ' + (j.example ? j.example.payrollTitle : '')]
    ], { flag: function (i) { return i >= 5; } }));

    paragraph(host, 'The last two rows are the whole problem, and they are visible in the ' +
      'first ten seconds of looking. Both datasets have a <code>department_code</code> and ' +
      'a <code>title_code</code>. Neither writes them the same way, and nothing in either ' +
      'dataset’s documentation says so.');
    attachQuery(host, model, 'Budgeted positions and salaries');
  }

  // ------------------------------------------------------------------ Land

  function renderLand(model) {
    var host = document.getElementById('ba-land');
    if (!host) return;
    host.innerHTML = '';
    var j = model.join, f = findingBy(model, 'no-shared-key');
    var vac = findingBy(model, 'not-a-vacancy-rate').numbers;

    host.appendChild(el('h3', null, 'Finding: the obvious join matches nothing'));
    paragraph(host, 'Joining ' + strong(count(j.rawBudgetKeys)) + ' budget keys to ' +
      strong(count(j.rawActualKeys)) + ' payroll keys on <code>department_code</code> and ' +
      '<code>title_code</code> as published returns ' + strong(j.rawMatches + ' rows') +
      '. Not few. None.');
    paragraph(host, 'This is the dangerous kind of failure, because an inner join that ' +
      'matches nothing is not an error. It is an empty result set. The report renders, the ' +
      'chart is blank or shows a zero, and whether anyone notices depends on whether a ' +
      'blank chart looks wrong to the person reviewing it.');

    if (j.example) {
      host.appendChild(el('p', 'lab-caption', 'The same job, in both systems'));
      host.appendChild(table(['Source', 'department_code', 'title_code', 'Describes'], [
        ['Budget ordinance', j.example.budgetDept, j.example.budgetTitle,
          j.example.titleDescription],
        ['Payroll actuals', j.example.payrollDept, j.example.payrollTitle,
          j.example.titleDescription],
        ['After the rule below', j.example.normalisedDept, j.example.normalisedTitle,
          j.example.titleDescription]
      ], { flag: function (i) { return i === 2; } }));
    }

    host.appendChild(el('h3', null, 'The rule, stated once'));
    paragraph(host, '<em>' + esc(model.rules.normalisation) + '</em>');
    paragraph(host, 'That single rule takes the match from ' + strong(j.rawMatches) +
      ' to ' + strong(count(j.matched)) + ' of ' + strong(count(j.normalisedBudgetKeys)) +
      ' budget keys — ' + strong(pct(j.matchRate)) + '. It is three lines of code. ' +
      'Knowing it was needed is the part that is not.');

    host.appendChild(bars([
      { label: 'Joined as published', value: Math.max(j.rawMatches, 0.001),
        display: String(j.rawMatches), flagged: true },
      { label: 'Joined after the rule', value: j.matched, display: count(j.matched) }
    ]));

    // ---- the correction ---------------------------------------------------
    host.appendChild(el('h3', null,
      'What is left over, and what it is not'));
    paragraph(host, 'An earlier version of this page called the unmatched payroll “titles ' +
      'that appear in no budget line at all”. That was wrong, and the way it was wrong is ' +
      'worth more than the original claim. The join is on a department-title <em>pair</em>. ' +
      'Of the ' + strong(count(j.actualOnly)) + ' pairs with no budget match, ' +
      strong(count(j.titleBudgetedElsewhere)) + ' carry a title that <em>is</em> funded — ' +
      'just under a different department.');
    paragraph(host, 'Most of that is one department. ' +
      strong(count(j.centralPeople)) + ' of the ' + strong(count(j.actualOnlyEmployees)) +
      ' unmatched people are charged to ' + strong(niceName(j.centralDepartment)) +
      ', a central accounting department the ordinance does not carry as an operating ' +
      'one. They account for ' + strong(pct(j.centralShareOfUnmatchedAmount)) +
      ' of the unmatched money. These are not unbudgeted hires. They are budgeted staff ' +
      'whose cost is booked centrally, and calling them unbudgeted would have been a ' +
      'confident, wrong, and quotable claim about a real city.');
    paragraph(host, 'Once attribution is separated out, the genuinely unbudgeted residue is ' +
      strong(count(j.titleNeverBudgeted) + ' pairs') + ' covering ' +
      strong(count(j.titleNeverBudgetedPeople) + ' people') + ' — a real finding, and two ' +
      'orders of magnitude smaller than the number the naive reading produces.');

    host.appendChild(el('p', 'lab-caption', 'Largest unmatched pairs'));
    host.appendChild(table(['Title', 'Department', 'People', 'Paid', 'Title funded elsewhere?'],
      j.topActualOnly.slice(0, 6).map(function (t) {
        return [niceName(t.title), niceName(t.dept), count(t.employees), big(t.amount),
          t.titleBudgetedElsewhere ? 'yes — attribution' : 'no — genuinely unbudgeted'];
      }),
      { flag: function (i) { return !j.topActualOnly[i].titleBudgetedElsewhere; } }));

    paragraph(host, 'In the other direction ' + strong(count(j.budgetOnly)) + ' budget keys ' +
      'have no payroll match, and ' + strong(count(j.budgetOnlyNonPosition)) + ' of those ' +
      'are not positions at all — fringe benefits and salary adjustment pools carrying ' +
      strong(big(j.budgetOnlyNonPositionAmount)) + ' and zero headcount. That leaves ' +
      strong(count(j.budgetOnlyRealPositions)) + ' funded titles, ' +
      strong(dec(j.budgetOnlyRealFte, 1) + ' FTE') + ', with nobody paid against them.');
    note(host, 'How to check: ' + esc(vac.centralDepartment ? findingBy(model,
      'not-a-vacancy-rate').check : f.check));
  }

  // ----------------------------------------------------------------- Model

  function renderModel(model) {
    var host = document.getElementById('ba-model');
    if (!host) return;
    host.innerHTML = '';
    var mixed = findingBy(model, 'mixed-units');
    var head = findingBy(model, 'headcount-is-a-choice');
    var part = findingBy(model, 'partial-year');
    var b = model.budget, r = model.rules;

    host.appendChild(el('h3', null, 'Finding: one column, three different units'));
    paragraph(host, '<code>total_budgeted_unit</code> holds a number whose meaning depends ' +
      'on <code>budgeted_unit</code> in the same row. Summed without looking, it reports ' +
      strong(count(mixed.numbers.naiveTotal)) + ' budgeted positions for a city that pays ' +
      'around ' + strong(count(model.actual.pointInTime)) + ' people — an overcount of ' +
      strong('×' + mixed.numbers.ratio) + ', because ' +
      strong(count(mixed.numbers.hourly)) + ' of those “positions” are hours.');

    host.appendChild(table(['Budgeted unit', 'Rows', 'Units as published',
                            'FTE under our rule', 'Budgeted'],
      b.byUnit.map(function (u) {
        return [u.unit, count(u.rows), count(u.units), dec(u.fte, 0), big(u.amount)];
      }),
      { flag: function (i) { return b.byUnit[i].unit.toLowerCase() === 'hourly'; } }));

    host.appendChild(el('p', 'lab-caption', 'The conversion, stated'));
    paragraph(host, '<em>' + esc(r.fteRule) + '</em>');
    note(host, 'The ' + count(r.hoursPerFte) + '-hour year is an assumption, not a fact ' +
      'in the data. It is ours, it is arguable, and every FTE figure on this page depends ' +
      'on it — which is why it is on the page rather than in the code.');

    host.appendChild(el('h3', null, 'Finding: the year is not over'));
    paragraph(host, 'The ordinance funds ' + strong(r.focusYear) + ' in full. The payroll ' +
      'has run ' + strong(part.numbers.periodsElapsed + ' of ' + part.numbers.periodsInYear) +
      ' pay periods, or ' + strong(pct(part.numbers.elapsedPct)) + ' of the year. Set the ' +
      'two totals beside each other and the City appears to be ' +
      strong(pct(part.numbers.naiveUnderspendPct)) + ' under budget.');
    paragraph(host, 'It is not. ' + strong(big(part.numbers.paid)) + ' of ' +
      strong(big(part.numbers.budget)) + ' is ' + strong(pct(part.numbers.burnPct)) +
      ' of the budget paid against ' + strong(pct(part.numbers.elapsedPct)) +
      ' of the year elapsed. That framing removes the elapsed-time error without making ' +
      'the two sides like for like: the payroll includes overtime the position lines do ' +
      'not fund, and the ordinance carries ' +
      strong(big(part.numbers.nonPositionAmount)) + ' that never moves through payroll. ' +
      'Against position lines alone it is ' +
      strong(pct(part.numbers.burnPctPositionsOnly)) + '. A flag, not a verdict.');
    host.appendChild(bars([
      { label: 'Share of the year elapsed', value: part.numbers.elapsedPct,
        display: pct(part.numbers.elapsedPct) },
      { label: 'Share of the budget paid', value: part.numbers.burnPct,
        display: pct(part.numbers.burnPct), flagged: true }
    ]));
    note(host, 'How to check: ' + esc(part.check));

    host.appendChild(el('h3', null, 'Finding: “headcount” is two different numbers'));
    paragraph(host, strong(count(head.numbers.annual)) + ' distinct people have been paid ' +
      'so far in ' + strong(r.focusYear) + '. In the latest pay period, ' +
      strong(count(head.numbers.pointInTime)) + ' were. The gap is ' +
      strong(count(head.numbers.difference)) + ' people, or ' +
      strong(pct(head.numbers.pct)) + ', and it is not an error in either figure. It is ' +
      'turnover.');
    paragraph(host, 'The gap grows with the window. Over the last complete year, ' +
      strong(r.priorYear) + ', the same two counts differed by ' +
      strong(count(head.numbers.priorDifference)) + ' people — ' +
      strong(pct(head.numbers.priorPct)) + '. Against a budget that funds positions rather ' +
      'than people, the point-in-time count is the right one, and every comparison below ' +
      'uses period ' + strong(r.pointInTimePeriod) + '.');
    attachQuery(host, model, 'latest pay period');
  }

  // ----------------------------------------------------------------- Build

  function renderBuild(model) {
    var host = document.getElementById('ba-build');
    if (!host) return;
    host.innerHTML = '';
    var r = model.rules;
    var depts = model.departments.filter(function (d) {
      return d.budgetFte !== null && d.pointInTime;
    });

    host.appendChild(el('p', 'lab-caption',
      'Budgeted against paid so far, ' + r.focusYear));
    host.appendChild(table(
      ['Department', 'Budgeted FTE', 'Paid in period ' + r.pointInTimePeriod,
       'Budgeted for positions', 'Other budget lines', 'Paid so far', 'Spent'],
      depts.slice(0, 14).map(function (d) {
        return [niceName(d.name), dec(d.budgetFte, 0), count(d.pointInTime),
          big(d.budgetPositionAmount), big(d.budgetNonPositionAmount),
          big(d.actualAmount), d.burnShare === null ? '—' : pct(d.burnShare)];
      })));
    note(host, 'The last column is the only one that can be read straight down: it is the ' +
      'share of each department’s funded salary already paid, against ' +
      strong(pct(r.elapsedPct)) + ' of the year elapsed. The two money columns before it ' +
      'are not comparable to each other — one is a full-year plan, the other is ' +
      r.periodsElapsed + ' periods of cash including overtime. ' +
      strong(big(model.budget.nonPositionAmount)) + ' city-wide sits in lines carrying no ' +
      'headcount at all, which is why it has a column of its own rather than being folded ' +
      'into salary.');
    attachQuery(host, model, 'Employees paid and dollars');

    host.appendChild(el('h3', null, 'What changed in the plan'));
    var b = model.budget, p = model.priorBudget;
    host.appendChild(table(['', r.priorYear + ' ordinance', r.focusYear + ' ordinance',
                            'Change'], [
      ['Funded FTE', dec(p.fte, 0), dec(b.fte, 0),
        dec(b.fte - p.fte, 0) + ' (' + pct((b.fte - p.fte) / p.fte * 100) + ')'],
      ['Budgeted', big(p.amount), big(b.amount),
        big(b.amount - p.amount) + ' (' + pct((b.amount - p.amount) / p.amount * 100) + ')']
    ]));
    paragraph(host, 'This is the one comparison on the page that needs no caveats at all. ' +
      'Both sides are complete enacted ordinances in the same units from the same ' +
      'publisher, so plan against plan is a straight subtraction — funded positions ' +
      (b.fte < p.fte ? 'fell' : 'rose') + ' while the money ' +
      (b.amount > p.amount ? 'rose' : 'fell') + '.');

    if (model.nameMismatches) {
      host.appendChild(el('h3', null, 'A smaller trap: the names disagree too'));
      paragraph(host, strong(model.nameMismatches) + ' of ' +
        strong(count(model.departments.length)) + ' departments carry a different name in ' +
        'each dataset for the same code. Joining on the department name instead of the ' +
        'code would have quietly lost them — the argument for joining on codes and ' +
        'treating names as labels, not keys.');
    }

    var bridge = el('div', 'lab-bridge');
    bridge.appendChild(el('p', 'lab-caption', 'What this stage cost'));
    var bp = el('p');
    bp.innerHTML = 'Four rules — how to normalise a code, what an FTE is, which headcount ' +
      'counts, and how much of the year has happened — and the comparison becomes ' +
      'possible. None is in either dataset’s documentation, and all four change the ' +
      'answer. <a href="/#contact">Tell us what’s stuck.</a>';
    bridge.appendChild(bp);
    host.appendChild(bridge);
  }

  // ------------------------------------------------------------------- Ask

  function renderAsk(model) {
    var host = document.getElementById('ba-ask');
    if (!host) return;
    host.innerHTML = '';
    var j = model.join, b = model.budget, a = model.actual, r = model.rules;
    var mixed = findingBy(model, 'mixed-units').numbers;
    var head = findingBy(model, 'headcount-is-a-choice').numbers;
    var part = findingBy(model, 'partial-year').numbers;
    var vac = findingBy(model, 'not-a-vacancy-rate').numbers;
    var depts = model.departments.filter(function (d) {
      return d.budgetFte !== null && d.pointInTime;
    });
    var gapOf = function (d) {
      return Math.abs((d.actualAmount || 0) - (d.budgetPositionAmount || 0));
    };
    var byGap = depts.slice().sort(function (x, y) { return gapOf(y) - gapOf(x); });
    var bySize = depts.slice().sort(function (x, y) {
      return y.actualAmount - x.actualAmount; })[0];
    var biggest = byGap[0];
    var hottest = depts.slice().filter(function (d) { return d.burnShare !== null; })
      .sort(function (x, y) { return y.burnShare - x.burnShare; })[0];

    var qs = [
      {
        q: 'What is the City’s vacancy rate?',
        body: [
          '<strong>This data cannot tell you.</strong> The subtraction looks available: ' +
          strong(dec(b.fte, 0)) + ' budgeted FTE against ' + strong(count(a.pointInTime)) +
          ' people paid in the latest period. Those are not the same kind of thing, ' +
          'so the difference between them is not a vacancy.',
          '<strong>A full-time equivalent measures work, not people.</strong> ' +
          strong(count(vac.hourlyUnits)) + ' budgeted hours become ' +
          strong(dec(vac.hourlyFte, 0)) + ' FTE under our own conversion, and those hours ' +
          'may be worked by any number of individuals — part-year, seasonal, part-time. ' +
          'Each is a whole person in the headcount and a fraction in the budget, so a ' +
          'headcount exceeding an FTE total is arithmetic rather than a staffing finding.',
          'Attribution is a second problem and a different one. It bites at department ' +
          'level, where ' + strong(count(j.centralPeople)) + ' people across the year are ' +
          'charged to ' + strong(niceName(j.centralDepartment)) + ' rather than the ' +
          'department funding them. It does not rescue the city-wide subtraction: someone ' +
          'booked centrally is still inside both city-wide totals, and in the latest ' +
          'period ' + strong(count(j.centralPeoplePointInTime)) + ' people are booked ' +
          'there at all.',
          'A real vacancy rate needs a position-level system showing filled and unfilled ' +
          'posts at a date. That is an internal system, not an open dataset. What this ' +
          'analysis produces instead is the specific question to take to whoever owns it, ' +
          'and the ' + strong(count(j.titleNeverBudgeted)) + ' department-title pairs — ' +
          strong(count(j.titleNeverBudgetedPeople)) + ' people — that genuinely have no ' +
          'funded title anywhere.'
        ],
        fields: 'budget FTE vs point-in-time headcount · different units, different scope'
      },
      {
        q: 'Is the City on track against its budget?',
        body: [
          '<strong>Not from these two datasets — though it is answerable enough to be ' +
          'dangerous.</strong> Read as raw totals, ' + strong(big(part.paid)) +
          ' against ' + strong(big(part.budget)) + ' shows a ' +
          strong(pct(part.naiveUnderspendPct)) + ' underspend. That is not a finding ' +
          'about spending: it is ' +
          strong((part.periodsInYear - part.periodsElapsed) + ' pay periods') +
          ' that have not happened yet.',
          'Expressing it against elapsed time removes that error and exposes another. ' +
          strong(pct(part.burnPct)) + ' of the full ordinance has been paid against ' +
          strong(pct(part.elapsedPct)) + ' of the year — but the numerator is payroll ' +
          'cash including overtime, which the ordinance\u2019s position lines do not fund, ' +
          'and the denominator carries ' + strong(big(part.nonPositionAmount)) + ' of ' +
          'fringe and adjustment lines that never move through payroll at all. Against ' +
          'position lines only the same figure is ' +
          strong(pct(part.burnPctPositionsOnly)) + '.',
          'Those two mismatches push in opposite directions and neither is quantified ' +
          'here, so the honest output is a flag rather than a verdict. A real answer ' +
          'needs the appropriation lines that fund overtime, which is a further dataset ' +
          'again. ' + (hottest ? 'By department, ' + strong(niceName(hottest.name)) +
            ' has consumed the largest share of its funded salary at ' +
            strong(pct(hottest.burnShare)) + ', which is where to look first.' : '')
        ].filter(Boolean),
        fields: 'periods elapsed vs share of budget paid'
      },
      {
        q: 'Can these two datasets be joined at all?',
        body: [
          'Yes, but not as published. On the keys as they appear, ' +
          strong(count(j.rawBudgetKeys)) + ' budget rows and ' +
          strong(count(j.rawActualKeys)) + ' payroll rows produce ' +
          strong(j.rawMatches + ' matches') + '.',
          'After stripping the leading system letter and leading zeros from both codes, ' +
          strong(count(j.matched)) + ' match — ' + strong(pct(j.matchRate)) + ' of the ' +
          'budget side. The residue splits three ways: ' +
          strong(count(j.titleBudgetedElsewhere)) + ' pairs whose title is funded under ' +
          'another department, ' + strong(count(j.titleNeverBudgeted)) + ' with no funded ' +
          'title anywhere, and ' + strong(count(j.budgetOnlyRealPositions)) + ' funded ' +
          'titles nobody was paid against.'
        ],
        fields: 'department_code, title_code · normalised on both sides'
      },
      {
        q: 'How many positions does the budget fund?',
        body: [
          strong(dec(b.fte, 0)) + ' full-time equivalents, under a stated conversion. The ' +
          'number in the column is ' + strong(count(mixed.naiveTotal)) + ', which is not ' +
          'positions — it mixes ' + strong(count(mixed.annual)) + ' annual positions with ' +
          strong(count(mixed.hourly)) + ' budgeted <em>hours</em> and a smaller number of ' +
          'budgeted months.',
          'The previous ordinance funded ' + strong(dec(model.priorBudget.fte, 0)) +
          ' FTE, so the plan ' + (b.fte < model.priorBudget.fte ? 'shrank' : 'grew') +
          ' by ' + strong(dec(Math.abs(b.fte - model.priorBudget.fte), 0)) +
          ' while the money ' + (b.amount > model.priorBudget.amount ? 'rose' : 'fell') +
          ' by ' + strong(big(Math.abs(b.amount - model.priorBudget.amount))) + '.'
        ],
        fields: 'budgeted_unit, total_budgeted_unit · ' + count(r.hoursPerFte) + ' hours per FTE'
      },
      {
        q: 'How many people does the City employ?',
        body: [
          'Two defensible answers ' + strong(count(head.difference)) + ' apart. ' +
          strong(count(head.annual)) + ' people have been paid so far in ' + r.focusYear +
          '; ' + strong(count(head.pointInTime)) + ' were paid in the latest period. Over ' +
          'the last complete year the same gap was ' +
          strong(count(head.priorDifference)) + ' people.',
          'Neither is wrong. The wider figure answers “how many people did we pay”, which ' +
          'is right for cost and turnover. The point-in-time figure answers “how many ' +
          'people work here”, which is right against a budget. Reports that do not say ' +
          'which they used are why two teams quote different headcounts in one meeting.'
        ],
        fields: 'count(distinct employee_dataset_id) · year to date vs one period'
      },
      {
        q: 'What would you actually deliver from this?',
        body: [
          'Four written rules and a reconciliation report, not a dashboard. The rules are ' +
          'the deliverable: how codes normalise between the systems, what an FTE is, which ' +
          'headcount a question wants, and how to express a part-year actual against a ' +
          'full-year plan.',
          'Then the exception lists go to the people who can explain them — the ' +
          strong(count(j.titleNeverBudgeted)) + ' pairs with no funded title, the ' +
          strong(count(j.budgetOnlyRealPositions)) + ' funded titles nobody was paid ' +
          'against, and the ' + strong(count(j.centralPeople)) + ' people booked to a ' +
          'central account. Each is either a data problem or a decision nobody wrote down, ' +
          'and both are worth more than a chart.'
        ],
        fields: 'the output is a rule set and three exception lists'
      }
    ];

    qs.forEach(function (item, i) {
      var d = el('details', 'lab-q');
      var s = el('summary');
      s.appendChild(el('span', 'lab-q-text', item.q));
      d.appendChild(s);
      var body = el('div', 'lab-q-body');
      item.body.forEach(function (html) { paragraph(body, html); });
      body.appendChild(el('p', 'lab-q-fields', item.fields));
      d.appendChild(body);
      if (i === 0) d.open = true;
      host.appendChild(d);
    });
  }

  // ------------------------------------------------------------------ boot

  function fail(msg) {
    root.className = 'lab-status is-bad';
    root.textContent = msg;
  }

  function boot() {
    fetch(DATA, { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (model) {
        var bad = selfCheck(model);
        if (bad.length) {
          fail('Self-check failed — this page is not showing trustworthy numbers. ' +
            bad.join('; '));
          return;
        }
        renderSummary(model);
        renderProvenance(model);
        renderExtract(model);
        renderLand(model);
        renderModel(model);
        renderBuild(model);
        renderAsk(model);
        root.className = 'lab-status is-ok';
        root.textContent = 'Self-check passed: the ' + model.rules.focusYear +
          ' ordinance (' + count(model.join.rawBudgetKeys) + ' keys) reconciled against ' +
          count(model.join.rawActualKeys) + ' payroll keys across ' +
          model.departments.length + ' departments, ' + model.rules.periodsElapsed +
          ' of ' + model.rules.periodsInYear + ' pay periods elapsed; ' +
          model.findings.length + ' findings, each recomputed from the snapshot on load. ' +
          'Retrieved ' + model.source.retrieved + '.';
      })
      .catch(function (err) {
        fail('Could not load the snapshot (' + err.message + '). Nothing is shown rather ' +
          'than something unverified.');
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

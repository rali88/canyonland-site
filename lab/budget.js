/* Project 3 of the BI Lifecycle Lab: reconciling two sources that disagree.
 *
 * Rendered from lab/data/chicago-budget.json, built by the pipeline in
 * lab/tools/. As in Project 2 the prose is written and the numbers inside it
 * are computed, so a snapshot rebuilt against refreshed City data either keeps
 * the wording true or fails the self-check.
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

  // Values here come from a City-published snapshot. None contains markup
  // today; a rebuild is not a promise that none ever will.
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
  function dec(v, p) { return Number(v).toLocaleString('en-US',
    { minimumFractionDigits: p === undefined ? 0 : p,
      maximumFractionDigits: p === undefined ? 0 : p }); }
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
      findings: model.findings.length
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
      bad.push('the raw join is no longer empty, so the page’s central ' +
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
    var head = findingBy(model, 'headcount-is-a-choice').numbers;
    var strip = el('div', 'lab-summary-strip');

    [
      { v: j.rawMatches + ' of ' + count(j.rawBudgetKeys),
        l: 'rows the obvious join matches', finding: true },
      { v: pct(j.matchRate), l: 'matched after one stated rule', finding: false },
      { v: '×' + mixed.ratio, l: 'overcount from one mixed-unit column', finding: true },
      { v: count(head.difference), l: 'people between two headcounts', finding: true }
    ].forEach(function (i) {
      var item = el('div', 'lab-summary-item' + (i.finding ? ' is-finding' : ''));
      item.appendChild(el('span', 'lab-summary-value', i.v));
      item.appendChild(el('span', 'lab-summary-label', i.l));
      strip.appendChild(item);
    });

    host.innerHTML = '';
    host.appendChild(strip);
    var note = el('p', 'lab-summary-note');
    note.innerHTML = 'Three of these are failures of the obvious method. Joining the two ' +
      'datasets on their published keys matches ' + strong('nothing') + '; summing the ' +
      'budget’s unit column reports ' + strong(count(mixed.naiveTotal)) +
      ' positions for a city that pays about ' + strong(count(head.pointInTime)) +
      ' people; and “headcount” means two numbers ' +
      strong(count(head.difference)) + ' apart depending on which one you meant.';
    host.appendChild(note);
  }

  // ------------------------------------------------------------ provenance

  function renderProvenance(model) {
    var host = document.getElementById('ba-provenance');
    if (!host) return;
    host.innerHTML = '';
    var s = model.source;
    var link = function (href, text) {
      var a = el('a', null, text);
      a.href = href; a.target = '_blank'; a.rel = 'noopener';
      return a;
    };

    host.appendChild(table(['', 'Budget side', 'Payroll side'], [
      ['Dataset', link(s.budget.landing, s.budget.dataset),
        link(s.payroll.landing, s.payroll.dataset)],
      ['Identifier', s.budget.id, s.payroll.id],
      ['Describes', 'Positions the ordinance funds', 'Money that actually moved'],
      ['Last updated at source', s.budget.updated, s.payroll.updated],
      ['Licence / terms', s.budget.license, s.payroll.license]
    ]));

    host.appendChild(table(['Field', 'Value'], [
      ['Publisher', s.publisher],
      ['Required attribution', s.attribution],
      ['Focus year', s.focusYear],
      ['Retrieved by us', s.retrieved],
      ['Live or cached', s.mode]
    ]));

    host.appendChild(el('h3', null, 'Known limitations'));
    var lim = el('ul', 'lab-col');
    [
      'A cached snapshot taken on ' + s.retrieved + '. The City refreshes both ' +
        'sources on their own schedules, so these figures will drift.',
      'The budget side is the enacted ordinance for ' + s.focusYear +
        ', not a mid-year amended budget. Amendments during the year are not reflected.',
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
    var j = model.join, b = model.budget, a = model.actual;

    host.appendChild(table(['', 'Budget ordinance', 'Payroll actuals'], [
      ['Grain of one row', 'A funded position line', 'One pay element for one employee in one period'],
      ['Rows taken', count(model.source.budget.rows) + ' grouped lines',
        count(j.rawActualKeys) + ' department-title combinations'],
      ['Money', big(b.amount) + ' budgeted', big(a.amount) + ' paid'],
      ['People', dec(b.fte, 0) + ' FTE funded',
        count(a.annualHeadcount) + ' paid at some point in the year'],
      ['Department key', 'department_code, e.g. ' + (j.example ? j.example.budgetDept : ''),
        'department_code, e.g. ' + (j.example ? j.example.payrollDept : '')],
      ['Title key', 'title_code, e.g. ' + (j.example ? j.example.budgetTitle : ''),
        'title_code, e.g. ' + (j.example ? j.example.payrollTitle : '')]
    ], { flag: function (i) { return i >= 4; } }));

    paragraph(host, 'The last two rows are the whole problem, and they are visible in the ' +
      'first ten seconds of looking. Both datasets have a <code>department_code</code> and a ' +
      '<code>title_code</code>. Neither writes them the same way. Nothing in either ' +
      'dataset’s documentation says so.');
    attachQuery(host, model, 'Budgeted positions and salaries');
  }

  // ------------------------------------------------------------------ Land

  function renderLand(model) {
    var host = document.getElementById('ba-land');
    if (!host) return;
    host.innerHTML = '';
    var j = model.join;
    var f = findingBy(model, 'no-shared-key');

    host.appendChild(el('h3', null, 'Finding: the obvious join matches nothing'));
    paragraph(host, 'Joining ' + strong(count(j.rawBudgetKeys)) + ' budget keys to ' +
      strong(count(j.rawActualKeys)) + ' payroll keys on <code>department_code</code> and ' +
      '<code>title_code</code> as published returns ' + strong(j.rawMatches + ' rows') +
      '. Not few. None.');
    paragraph(host, 'This is the dangerous kind of failure, because an inner join that ' +
      'matches nothing is not an error. It is an empty result set. The report renders, the ' +
      'chart is blank or shows a zero, and whether anyone notices depends on whether a blank ' +
      'chart looks wrong to the person reviewing it.');

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
      ' budget keys — ' + strong(pct(j.matchRate)) + '. It is three lines of code. Knowing ' +
      'it was needed is the part that is not.');

    host.appendChild(bars([
      { label: 'Joined as published', value: Math.max(j.rawMatches, 0.001),
        display: String(j.rawMatches), flagged: true },
      { label: 'Joined after the rule', value: j.matched, display: count(j.matched) }
    ]));

    host.appendChild(el('h3', null, 'What still does not match, and why that matters'));
    paragraph(host, strong(count(j.actualOnly)) + ' department-title combinations appear in ' +
      'the payroll and in no budget line — ' + strong(count(j.actualOnlyEmployees)) +
      ' people paid ' + strong(big(j.actualOnlyAmount)) + '. Anyone reporting budget against ' +
      'actual by title, having got the join working, would silently drop all of them.');
    host.appendChild(el('p', 'lab-caption', 'Paid, but matching no budgeted title'));
    host.appendChild(table(['Title', 'Department', 'People', 'Paid'],
      j.topActualOnly.slice(0, 6).map(function (t) {
        return [niceName(t.title), niceName(t.dept), count(t.employees), big(t.amount)];
      })));

    paragraph(host, 'In the other direction ' + strong(count(j.budgetOnly)) + ' budget keys ' +
      'have no payroll match — but ' + strong(count(j.budgetOnlyNonPosition)) + ' of them are ' +
      'not positions at all. They are lines like fringe benefits and salary adjustment pools, ' +
      'carrying ' + strong(big(j.budgetOnlyNonPositionAmount)) + ' and zero headcount. ' +
      'Counting those as unfilled jobs would be the same mistake as counting hours as people. ' +
      'That leaves ' + strong(count(j.budgetOnlyRealPositions)) + ' funded titles, ' +
      strong(dec(j.budgetOnlyRealFte, 1) + ' FTE') + ', with nobody paid against them.');
    host.appendChild(el('p', 'lab-note', 'How to check: ' + f.check));
  }

  // ----------------------------------------------------------------- Model

  function renderModel(model) {
    var host = document.getElementById('ba-model');
    if (!host) return;
    host.innerHTML = '';
    var mixed = findingBy(model, 'mixed-units');
    var head = findingBy(model, 'headcount-is-a-choice');
    var b = model.budget;

    host.appendChild(el('h3', null, 'Finding: one column, three different units'));
    paragraph(host, '<code>total_budgeted_unit</code> holds a number whose meaning depends on ' +
      '<code>budgeted_unit</code> in the same row. Summed without looking, it reports ' +
      strong(count(mixed.numbers.naiveTotal)) + ' budgeted positions for a city that pays ' +
      'around ' + strong(count(head.numbers.pointInTime)) + ' people — an overcount of ' +
      strong('×' + mixed.numbers.ratio) + ', because ' +
      strong(count(mixed.numbers.hourly)) + ' of those "positions" are hours.');

    host.appendChild(table(['Budgeted unit', 'Rows', 'Units as published', 'FTE under our rule', 'Budgeted'],
      b.byUnit.map(function (u) {
        return [u.unit, count(u.rows), count(u.units), dec(u.fte, 0), big(u.amount)];
      }),
      { flag: function (i) { return b.byUnit[i].unit.toLowerCase() === 'hourly'; } }));

    host.appendChild(el('p', 'lab-caption', 'The conversion, stated'));
    paragraph(host, '<em>' + esc(model.rules.fteRule) + '</em>');
    host.appendChild(el('p', 'lab-note', 'The ' + count(model.rules.hoursPerFte) +
      '-hour year is an assumption, not a fact in the data. It is ours, it is arguable, and ' +
      'every FTE figure on this page depends on it — which is why it is on the page rather ' +
      'than in the code.'));

    host.appendChild(el('h3', null, 'Finding: "headcount" is two different numbers'));
    paragraph(host, strong(count(head.numbers.annual)) + ' distinct people were paid by the ' +
      'City during ' + strong(model.rules.focusYear) + '. In the final pay period of that ' +
      'year, ' + strong(count(head.numbers.pointInTime)) + ' were. The gap is ' +
      strong(count(head.numbers.difference)) + ' people, or ' +
      strong(pct(head.numbers.pct)) + ' — and it is not an error in either figure. It is ' +
      'turnover: leavers, joiners, and seasonal staff who were each paid at some point ' +
      'without all being there at once.');
    paragraph(host, 'Compared against a budget that funds positions rather than people, the ' +
      'annual figure is the wrong one. Every comparison below uses the point-in-time count ' +
      'from period ' + strong(model.rules.pointInTimePeriod) + '.');
    host.appendChild(el('p', 'lab-note', 'How to check: ' + head.check));
    attachQuery(host, model, 'final pay period');
  }

  // ----------------------------------------------------------------- Build

  function renderBuild(model) {
    var host = document.getElementById('ba-build');
    if (!host) return;
    host.innerHTML = '';
    var depts = model.departments.filter(function (d) {
      return d.budgetFte !== null && d.pointInTime;
    });

    host.appendChild(el('p', 'lab-caption',
      'Budgeted against actual, ' + model.rules.focusYear));
    host.appendChild(table(
      ['Department', 'Budgeted FTE', 'Paid in period ' + model.rules.pointInTimePeriod,
       'Budgeted', 'Paid'],
      depts.slice(0, 14).map(function (d) {
        return [niceName(d.name), dec(d.budgetFte, 0), count(d.pointInTime),
          big(d.budgetAmount), big(d.actualAmount)];
      })));
    host.appendChild(el('p', 'lab-note', 'Paid exceeds budgeted in most departments, and ' +
      'that is expected rather than alarming: the payroll includes overtime and staff funded ' +
      'outside the ordinance, while the budget column counts base salary for funded ' +
      'positions only. The two columns are adjacent, not comparable, and the next section ' +
      'is about why.'));
    attachQuery(host, model, 'Employees paid and dollars');

    if (model.nameMismatches) {
      host.appendChild(el('h3', null, 'A smaller trap: the names disagree too'));
      paragraph(host, strong(model.nameMismatches) + ' of ' +
        strong(count(model.departments.length)) + ' departments carry a different name in ' +
        'each dataset for the same code. Joining on the department name instead of the code ' +
        'would have quietly lost them — which is the argument for joining on codes and ' +
        'treating names as labels, not keys.');
    }

    var bridge = el('div', 'lab-bridge');
    bridge.appendChild(el('p', 'lab-caption', 'What this stage cost'));
    var bp = el('p');
    bp.innerHTML = 'Three rules — how to normalise a code, what an FTE is, which headcount ' +
      'counts — and the comparison becomes possible. None of the three is in either ' +
      'dataset’s documentation, and all three change the answer. ' +
      '<a href="/#contact">Tell us what’s stuck.</a>';
    bridge.appendChild(bp);
    host.appendChild(bridge);
  }

  // ------------------------------------------------------------------- Ask

  function renderAsk(model) {
    var host = document.getElementById('ba-ask');
    if (!host) return;
    host.innerHTML = '';
    var j = model.join, b = model.budget, a = model.actual;
    var mixed = findingBy(model, 'mixed-units').numbers;
    var head = findingBy(model, 'headcount-is-a-choice').numbers;
    var vac = findingBy(model, 'not-a-vacancy-rate').numbers;
    var depts = model.departments.filter(function (d) {
      return d.budgetFte !== null && d.pointInTime;
    });
    var biggest = depts.slice().sort(function (x, y) {
      return y.actualAmount - x.actualAmount; })[0];

    var qs = [
      {
        q: 'What is the City’s vacancy rate?',
        body: [
          '<strong>This data cannot tell you, and the number it appears to give is wrong.</strong> ' +
          'The subtraction is right there: ' + strong(dec(b.fte, 0)) + ' budgeted FTE against ' +
          strong(count(a.pointInTime)) + ' people paid in the final period, which looks like ' +
          strong(dec(Math.abs(vac.naiveGap), 0)) + ' more staff than positions.',
          'It is not a vacancy rate because the two sides do not cover the same population. ' +
          strong(count(j.actualOnlyEmployees)) + ' people were paid under titles that appear ' +
          'in no budget line at all — ' + strong(big(j.actualOnlyAmount)) + ' of payroll ' +
          'outside the ordinance’s title system. Until that is reconciled or explained by ' +
          'someone inside the City, any vacancy figure derived here is a subtraction between ' +
          'two different things.',
          'A real vacancy rate needs a position-level system showing filled and unfilled ' +
          'posts at a date. That is an internal system, not an open dataset. The useful ' +
          'output here is the question to take to whoever owns it.'
        ],
        fields: 'budget FTE vs point-in-time headcount · populations do not match'
      },
      {
        q: 'Can these two datasets be joined at all?',
        body: [
          'Yes, but not as published. On the keys as they appear, ' +
          strong(count(j.rawBudgetKeys)) + ' budget rows and ' + strong(count(j.rawActualKeys)) +
          ' payroll rows produce ' + strong(j.rawMatches + ' matches') + '.',
          'After stripping the leading system letter and leading zeros from both codes, ' +
          strong(count(j.matched)) + ' match — ' + strong(pct(j.matchRate)) + ' of the budget ' +
          'side. The residual is not noise: it is ' + strong(count(j.budgetOnlyRealPositions)) +
          ' funded titles nobody was paid against, and ' + strong(count(j.actualOnly)) +
          ' paid titles nobody budgeted.'
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
          'The conversion is ours: ' + esc(model.rules.fteRule).toLowerCase() + ' Change the ' +
          'hours-per-year assumption and the FTE total moves, which is exactly why the ' +
          'assumption belongs next to the figure.'
        ],
        fields: 'budgeted_unit, total_budgeted_unit · ' + count(model.rules.hoursPerFte) + ' hours per FTE'
      },
      {
        q: 'How many people does the City employ?',
        body: [
          'Two defensible answers ' + strong(count(head.difference)) + ' apart. ' +
          strong(count(head.annual)) + ' people were paid at some point during ' +
          model.rules.focusYear + '; ' + strong(count(head.pointInTime)) + ' were paid in its ' +
          'final period.',
          'Neither is wrong. The annual figure answers "how many people did we pay this ' +
          'year", which is the right question for cost and for turnover. The point-in-time ' +
          'figure answers "how many people work here", which is the right one against a ' +
          'budget. Reports that do not say which one they used are the reason two teams ' +
          'quote different headcounts in the same meeting.'
        ],
        fields: 'count(distinct employee_dataset_id) · whole year vs one period'
      },
      {
        q: 'Which department has the largest gap between budgeted and paid?',
        body: [
          strong(niceName(biggest.name)) + ' is the largest in absolute terms — ' +
          strong(big(biggest.budgetAmount)) + ' budgeted against ' +
          strong(big(biggest.actualAmount)) + ' paid — but it is also the largest department, ' +
          'so that ranking mostly measures size.',
          'The gap is also not overspend. Budgeted salary excludes overtime, and Project 2 ' +
          'found overtime running to ' + strong('hundreds of millions') + ' across the City. ' +
          'A responsible version of this comparison adds the appropriation lines that fund ' +
          'overtime before drawing any conclusion, and that is a further dataset again.'
        ],
        fields: 'department_code · budgeted base salary vs all cash paid'
      },
      {
        q: 'What would you actually deliver from this?',
        body: [
          'Three written rules and a reconciliation report, not a dashboard. The rules are ' +
          'the deliverable: how codes normalise between the two systems, what an FTE is, and ' +
          'which headcount a given question wants.',
          'Then the exception lists — the ' + strong(count(j.actualOnly)) + ' paid-but-not-' +
          'budgeted titles and the ' + strong(count(j.budgetOnlyRealPositions)) +
          ' budgeted-but-unpaid ones — go to the people who can explain them. Those two ' +
          'lists are worth more than any chart, because every one of them is either a data ' +
          'problem or a decision nobody wrote down.'
        ],
        fields: 'the output is a rule set and two exception lists'
      }
    ];

    qs.forEach(function (item, i) {
      var d = el('details', 'lab-q');
      var s = el('summary');
      s.appendChild(el('span', 'lab-q-text', item.q));
      d.appendChild(s);
      var b2 = el('div', 'lab-q-body');
      item.body.forEach(function (html) { paragraph(b2, html); });
      b2.appendChild(el('p', 'lab-q-fields', item.fields));
      d.appendChild(b2);
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
        root.textContent = 'Self-check passed: ' + count(model.join.rawBudgetKeys) +
          ' budget keys reconciled against ' + count(model.join.rawActualKeys) +
          ' payroll keys across ' + model.departments.length + ' departments; ' +
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

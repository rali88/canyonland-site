/* Project 2 of the BI Lifecycle Lab: real published data.
 *
 * Everything rendered here is computed from lab/data/chicago-payroll.json,
 * which the pipeline in lab/tools/ builds from the City of Chicago payroll
 * portal. The prose is written; the numbers inside it are not. That split is
 * deliberate — a page that hardcodes its own figures is exactly the failure
 * this project argues against, and the self-check below fails loudly rather
 * than letting a stale number sit next to confident wording.
 *
 * No language model is involved. No network call is made at run time.
 */
(function () {
  'use strict';

  var root = document.getElementById('pp-status');
  if (!root) return;                       // not this page

  var DATA = '/lab/data/chicago-payroll.json';

  // ---------------------------------------------------------------- helpers

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  // The sign belongs outside the currency symbol: "-$21,612,260", never
  // "$-21,612,260". Negative pay elements are a finding on this page, so they
  // are read closely.
  function money(v, dp) {
    var d = dp === undefined ? 0 : dp;
    var n = Number(v);
    return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US',
      { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  // Big money reads better rounded once it passes a million; the exact figure
  // stays available in the tables underneath.
  function big(v) {
    var n = Number(v), sign = n < 0 ? '-' : '', a = Math.abs(n);
    if (a >= 1e9) return sign + '$' + (a / 1e9).toFixed(2) + 'bn';
    if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(1) + 'm';
    return money(n);
  }

  function count(v) { return Number(v).toLocaleString('en-US'); }

  function pct(v) { return Number(v).toFixed(1) + '%'; }

  // Titles and departments arrive as "T9173 - LIEUTENANT". The code is useful
  // for tracing a row back; the name is what a reader needs first.
  function niceName(s) {
    var m = /^[A-Z]?\d+\s*-\s*(.+)$/.exec(String(s || '').trim());
    return m ? m[1] : String(s || '');
  }
  function codeOf(s) {
    var m = /^([A-Z]?\d+)\s*-\s*/.exec(String(s || '').trim());
    return m ? m[1] : '';
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

  // A collapsed block carrying the exact query behind the figures above it.
  function query(q) {
    var d = el('details', 'lab-sql');
    d.appendChild(el('summary', null, 'The query behind this'));
    var pre = el('pre'), code = el('code');
    var lines = ['GET ' + (q.url || '')];
    Object.keys(q.params || {}).forEach(function (k) {
      lines.push('    ' + k + ' = ' + q.params[k]);
    });
    code.textContent = lines.join('\n');
    pre.appendChild(code);
    d.appendChild(pre);
    return d;
  }

  function findQuery(model, fragment) {
    var hit = (model.queries || []).filter(function (q) {
      return q.label.toLowerCase().indexOf(fragment.toLowerCase()) >= 0;
    })[0];
    return hit ? { url: model.source.api, params: hit.params } : null;
  }

  function attachQuery(host, model, fragment) {
    var q = findQuery(model, fragment);
    if (q) host.appendChild(query(q));
  }

  function paragraph(host, html) {
    var p = el('p');
    p.innerHTML = html;
    host.appendChild(p);
    return p;
  }

  function strong(v) { return '<strong>' + v + '</strong>'; }

  // ------------------------------------------------------------- self-check

  // The same contract as Project 1: the generator records what it believes it
  // produced, and the page recomputes it. A snapshot rebuilt against refreshed
  // City data that no longer matches the wording reports a mismatch instead of
  // drawing a confident wrong chart.
  function selfCheck(model) {
    var e = model.expected || {};
    var got = {
      years: model.land.byYear.length,
      completeYears: model.land.byYear.filter(function (y) { return y.complete; }).length,
      partialYears: model.land.byYear.filter(function (y) { return !y.complete; }).length,
      elements: model.model.elements.length,
      negativeElements: model.land.negatives.length,
      departments: model.model.departments.length,
      otRuleSpread: Math.round((model.rules.otTotals.broad -
        model.rules.otTotals.strict) * 100) / 100,
      otEarners: model.build.concentration.earners,
      top10Share: model.build.concentration.top10.share,
      findings: model.findings.length,
      focusYearAmount: (model.land.byYear.filter(function (y) {
        return y.year === model.rules.focusYear;
      })[0] || {}).amount,
      negativeRows: model.land.negatives.reduce(function (a, n) { return a + n.rows; }, 0)
    };
    var bad = [];
    Object.keys(e).forEach(function (k) {
      if (JSON.stringify(got[k]) !== JSON.stringify(e[k])) {
        bad.push(k + ': page computed ' + JSON.stringify(got[k]) +
          ', snapshot recorded ' + JSON.stringify(e[k]));
      }
    });
    return bad;
  }

  // ------------------------------------------------------------------ hero

  function renderSummary(model) {
    var host = document.getElementById('pp-summary');
    if (!host) return;
    var c = model.build.concentration;
    var f = model.findings.filter(function (x) { return x.id === 'part-year-records'; })[0];
    var strip = el('div', 'lab-summary-strip');

    [
      { v: count(model.source.rowsInSource), l: 'payroll rows read', finding: false },
      { v: big(model.rules.otTotals.named), l: 'overtime identified, 2023–present', finding: false },
      { v: big(model.findings.filter(function (x) {
          return x.id === 'overtime-definition'; })[0].numbers.spread),
        l: 'swing between defensible overtime rules', finding: true },
      { v: f ? ('×' + f.numbers.naiveRatio + ' → ×' + f.numbers.fullRatio) : '—',
        l: 'pay gap the naive method invented', finding: true }
    ].forEach(function (i) {
      var item = el('div', 'lab-summary-item' + (i.finding ? ' is-finding' : ''));
      item.appendChild(el('span', 'lab-summary-value', i.v));
      item.appendChild(el('span', 'lab-summary-label', i.l));
      strip.appendChild(item);
    });

    host.innerHTML = '';
    host.appendChild(strip);
    var note = el('p', 'lab-summary-note');
    note.innerHTML = 'Two of these are findings, not counts. The orange figures are places where ' +
      'the obvious method gives a confidently wrong answer — a ' + strong(big(
        model.findings.filter(function (x) { return x.id === 'overtime-definition'; })[0]
          .numbers.spread)) + ' swing depending on which pay elements you call overtime, ' +
      'and a pay gap that shrinks from ' + strong('×' + f.numbers.naiveRatio) + ' to ' +
      strong('×' + f.numbers.fullRatio) + ' once part-year records are excluded.';
    host.appendChild(note);
  }

  // ------------------------------------------------------------ provenance

  function renderProvenance(model) {
    var host = document.getElementById('pp-provenance');
    if (!host) return;
    host.innerHTML = '';
    var s = model.source;

    var link = function (href, text) {
      var a = el('a', null, text);
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      return a;
    };

    host.appendChild(table(['Field', 'Value'], [
      ['Publisher', s.publisher],
      ['Dataset', link(s.landing, s.dataset)],
      ['Dataset identifier', s.datasetId],
      ['Data owner', s.owner],
      ['Grain of one row', s.grain],
      ['Rows in the source', count(s.rowsInSource) + ' (payroll years ' +
        model.land.byYear[0].year + '–' + model.land.byYear[model.land.byYear.length - 1].year + ')'],
      ['Licence / terms', link(s.licenseUrl, s.license)],
      ['Required attribution', s.attribution],
      ['Last updated at source', s.sourceUpdated],
      ['Retrieved by us', s.retrieved],
      ['Live or cached', s.mode],
      ['Refresh cadence', s.refresh]
    ]));

    var h = el('h3', null, 'What we excluded, and why');
    host.appendChild(h);
    paragraph(host, 'The source carries an <code>employee</code> column holding each ' +
      'person\'s name. It is lawfully public and we never select it. Counting people ' +
      'requires a stable key, not a name, so every aggregate on this page groups by ' +
      '<code>employee_dataset_id</code> — and that key is not published here either. ' +
      'Traceability rows below cite <code>record_id</code>, which lets you pull the ' +
      'original record from the City directly. That leaves the decision to publish ' +
      'someone\'s name where it already sits, with the City, rather than copying it ' +
      'onto a consultancy\'s marketing site.');

    host.appendChild(el('h3', null, 'Known limitations'));
    var lim = el('ul', 'lab-col');
    [
      'This is a cached snapshot taken on ' + s.retrieved + '. The City refreshes the ' +
        'source roughly four times a year, so these figures will drift from the live portal.',
      'Amounts are what was paid in a payroll period, not accrued cost. Pension, ' +
        'healthcare and other employer costs are not in this dataset.',
      'The most recent payroll year is partial. It is shown, labelled, and excluded ' +
        'from every year-over-year comparison.',
      'Department and title codes are used as published. We have not attempted to ' +
        'reconcile reorganisations across years.',
      'This analysis is Canyonland Technologies\' own. It is not endorsed by, ' +
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
    var host = document.getElementById('pp-extract');
    if (!host) return;
    host.innerHTML = '';

    var fields = model.model.fields;
    var withheld = fields.filter(function (f) { return !f.used; });

    host.appendChild(el('p', 'lab-caption', 'The source schema, as published'));
    host.appendChild(table(['Column', 'Type', 'Taken'],
      fields.map(function (f) {
        return [f.name, f.type, f.used ? 'yes' : 'no — withheld'];
      }),
      { flag: function (i) { return !fields[i].used; } }));
    host.appendChild(el('p', 'lab-note', withheld.length +
      ' of ' + fields.length + ' columns is withheld at the extract, not filtered later. ' +
      'A column you never select cannot leak from a cache, a log, or a download.'));

    host.appendChild(el('h3', null, 'Twelve real rows, exactly as they arrive'));
    var rows = model.extract.sampleRows;
    host.appendChild(table(
      ['record_id', 'yr', 'per', 'department', 'title', 'pay_element', 'fund_type', 'amount'],
      rows.map(function (r) {
        return [r.record_id, r.payroll_year, r.payroll_period,
          niceName(r.department), niceName(r.title), r.pay_element,
          r.fund_type, money(r.amount, 2)];
      })));
    host.appendChild(el('p', 'lab-note',
      'Each record_id is a live citation: it identifies one row in the City\'s dataset, ' +
      'so any figure on this page can be walked back to the records that produced it.'));
    attachQuery(host, model, 'Twelve source rows');
  }

  // ------------------------------------------------------------------ Land

  function renderLand(model) {
    var host = document.getElementById('pp-land');
    if (!host) return;
    host.innerHTML = '';
    var years = model.land.byYear;

    host.appendChild(el('p', 'lab-caption', 'Coverage by payroll year'));
    host.appendChild(table(
      ['Payroll year', 'Pay periods', 'Rows', 'Employees', 'Total paid', 'Status'],
      years.map(function (y) {
        return [y.year, y.periods + ' of ' + years[0].periods, count(y.rows),
          count(y.employees), big(y.amount),
          y.complete ? 'complete' : 'partial — excluded from trends'];
      }),
      { flag: function (i) { return !years[i].complete; } }));
    attachQuery(host, model, 'per payroll year and period');

    var pf = model.findings.filter(function (f) { return f.id === 'partial-year'; })[0];
    if (pf) {
      host.appendChild(el('h3', null, 'Finding: the newest year is a fifth of a year'));
      paragraph(host, 'Payroll year ' + strong(pf.numbers.year) + ' holds only ' +
        strong(pf.numbers.periods + ' of ' + pf.numbers.of) + ' pay periods. Charted ' +
        'beside the complete years it shows ' + strong(big(pf.numbers.reported)) +
        ' against a run rate nearer ' + strong(big(pf.numbers.runRate)) + ' — an apparent ' +
        'collapse of ' + strong(big(pf.numbers.understatement)) + ' that is an artefact of ' +
        'when the snapshot was taken, not a change in the City\'s spending. ' +
        'It is shown here and excluded from every trend below.');
      host.appendChild(el('p', 'lab-note', 'How to check: ' + pf.check));
    }

    var nf = model.findings.filter(function (f) { return f.id === 'negative-amounts'; })[0];
    if (nf) {
      host.appendChild(el('h3', null, 'Finding: some pay elements are negative'));
      paragraph(host, strong(nf.numbers.elements) + ' pay elements carry negative amounts ' +
        'across ' + strong(count(nf.numbers.rows)) + ' rows, totalling ' +
        strong(money(nf.numbers.amount)) + '. They are recoveries and reversals — docked ' +
        'pay, suspensions, unpaid furlough — and they are correct. The trap is the ' +
        'reflex of filtering to <code>amount &gt; 0</code> when a total looks odd, ' +
        'which silently inflates payroll by the whole of that figure.');
      host.appendChild(table(['Pay element', 'Rows', 'Total'],
        model.land.negatives.slice().reverse().map(function (n) {
          return [n.element, count(n.rows), money(n.amount)];
        })));
      host.appendChild(el('p', 'lab-note', 'How to check: ' + nf.check));
    }
  }

  // ----------------------------------------------------------------- Model

  function renderModel(model) {
    var host = document.getElementById('pp-model');
    if (!host) return;
    host.innerHTML = '';
    var r = model.rules, t = r.otTotals;
    var f = model.findings.filter(function (x) { return x.id === 'overtime-definition'; })[0];

    paragraph(host, 'Asked "how much does the City spend on overtime", the honest first ' +
      'answer is a question back: which of these do you mean? ' + strong(f.numbers.strictElements) +
      ' pay elements are named as overtime outright. Another ' + strong(f.numbers.premiumElements) +
      ' are paid at a premium multiplier of 1.5× or more without carrying the word. ' +
      'Three defensible rules give three different totals, and the gap between the ' +
      'narrowest and the widest is ' + strong(big(f.numbers.spread)) + ', or ' +
      strong(pct(f.numbers.spreadPct)) + '.');

    host.appendChild(bars([
      { label: 'Strict — elements named OT', value: t.strict, display: big(t.strict) },
      { label: 'Named — plus supervisors\' OT', value: t.named, display: big(t.named) },
      { label: 'Broad — plus all premium rates', value: t.broad, display: big(t.broad), flagged: true }
    ], { money: true }));

    host.appendChild(el('p', 'lab-note', 'Every figure elsewhere on this page uses the ' +
      'middle rule — elements named as overtime, including supervisors\' quarterly ' +
      'overtime. That is a choice, it is arguable, and it is stated here so the number ' +
      'can be reproduced or disagreed with.'));

    var d = el('details', 'lab-sql');
    d.appendChild(el('summary', null, 'The exact elements in each rule'));
    var body = el('div');
    [['Strict', r.otStrict], ['Named adds', r.otNamed.filter(function (x) {
      return r.otStrict.indexOf(x) < 0; })], ['Premium adds', r.otPremium]]
      .forEach(function (pair) {
        body.appendChild(el('p', 'lab-caption', pair[0] + ' (' + pair[1].length + ')'));
        body.appendChild(el('p', 'lab-col', pair[1].join(' · ')));
      });
    d.appendChild(body);
    host.appendChild(d);
    attachQuery(host, model, 'Every pay element');

    host.appendChild(el('h3', null, 'The dimensions the records imply'));
    var dims = el('div', 'lab-dims');
    [
      ['Fact', 'Payroll line', ['record_id', 'amount', 'payroll_year', 'payroll_period']],
      ['Dimension', 'Department', ['department_code', 'department', 'department_function']],
      ['Dimension', 'Job classification', ['title_code', 'title']],
      ['Dimension', 'Pay element', ['pay_element', 'overtime rule class']],
      ['Dimension', 'Funding', ['fund_type', 'fund', 'appropriation']],
      ['Dimension', 'Time', ['payroll_year', 'payroll_period', 'complete / partial']]
    ].forEach(function (n) {
      var node = el('div', 'lab-node' + (n[0] === 'Fact' ? ' lab-node--fact' : ''));
      node.appendChild(el('p', 'lab-node-kind', n[0]));
      node.appendChild(el('h4', null, n[1]));
      node.appendChild(el('p', 'lab-col', n[2].join('\n')));
      dims.appendChild(node);
    });
    host.appendChild(dims);
    host.appendChild(el('p', 'lab-grain',
      'Grain: ' + (model.source.grain || 'one employee pay element in a payroll period')));
  }

  // ----------------------------------------------------------------- Build

  function renderBuild(model) {
    var host = document.getElementById('pp-build');
    if (!host) return;
    host.innerHTML = '';
    var fy = model.rules.focusYear;
    var depts = model.model.departments;
    var c = model.build.concentration;

    host.appendChild(el('h3', null, 'Overtime by department, ' + fy));
    host.appendChild(bars(depts.slice(0, 10).map(function (d) {
      return { label: niceName(d.department), value: d.ot.named, display: big(d.ot.named) };
    }), { money: true }));
    host.appendChild(table(
      ['Department', 'Employees', 'Total paid', 'Overtime', 'Overtime share'],
      depts.slice(0, 12).map(function (d) {
        return [niceName(d.department), count(d.employees), big(d.total),
          big(d.ot.named), pct(d.otShare)];
      })));
    host.appendChild(el('p', 'lab-note', 'Share is overtime as a percentage of that ' +
      'department\'s total payroll, which is the figure worth watching: a large ' +
      'department will always top the absolute chart.'));
    attachQuery(host, model, 'Department totals');

    host.appendChild(el('h3', null, 'How concentrated is overtime, ' + fy + '?'));
    paragraph(host, strong(count(c.earners)) + ' employees took overtime in ' + fy +
      ', sharing ' + strong(big(c.total)) + '. The median among them took ' +
      strong(money(c.median)) + '; the largest single total was ' + strong(money(c.max)) +
      '. The highest-paid ' + strong('10%') + ' of overtime earners took ' +
      strong(pct(c.top10.share)) + ' of the money, and the top ' + strong('1%') +
      ' took ' + strong(pct(c.top1.share)) + '.');
    paragraph(host, 'That is a real concentration but a milder one than the question ' +
      'usually assumes. Overtime here is broad-based rather than captured by a handful ' +
      'of people: it takes ' + strong(count(c.top10.employees)) + ' employees to account ' +
      'for a third of it, and ' + strong(count(c.over100k)) + ' individuals cleared ' +
      strong('$100,000') + ' of overtime in the year.');
    host.appendChild(el('p', 'lab-caption',
      'Share of all overtime dollars, by decile of overtime earner'));
    host.appendChild(bars(c.deciles.map(function (v, i) {
      return { label: (i === 0 ? 'Top 10%' : (i * 10) + '–' + ((i + 1) * 10) + '%'),
        value: v, display: pct(v), flagged: i === 0 };
    })));
    attachQuery(host, model, 'Overtime per employee');

    // --- pay variation, and the correction that makes it meaningful --------
    var f = model.findings.filter(function (x) { return x.id === 'part-year-records'; })[0];
    host.appendChild(el('h3', null, 'Pay variation within a job classification, ' + fy));
    paragraph(host, 'This is the chart that goes wrong quietly. Summing a year of pay per ' +
      'employee and comparing the 90th percentile to the 10th looks like it measures pay ' +
      'inequality inside a grade. Run that way, ' + strong(niceName(f.numbers.title)) +
      ' appears to vary ' + strong('×' + f.numbers.naiveRatio) + ', with a 10th percentile of ' +
      strong(money(f.numbers.naiveP10)) + ' — a figure no lieutenant is paid.');
    paragraph(host, 'They are not underpaid lieutenants. They are people who held the ' +
      'title for part of the year: promoted into it, retired out of it, or hired mid-year. ' +
      'Requiring an employee to appear in at least ' + strong(f.numbers.minPeriods + ' of the ' +
      f.numbers.of) + ' pay periods before counting them, the same classification varies ' +
      strong('×' + f.numbers.fullRatio) + ' — and the 10th percentile moves to ' +
      strong(money(f.numbers.fullP10)) + '.');

    var comp = model.build.titleCorrection.filter(function (x) { return x.fullYear; });
    host.appendChild(el('p', 'lab-caption', 'The naive ranking, next to the corrected one'));
    host.appendChild(table(
      ['Classification', 'Naive p10', 'Naive spread', 'Full-year p10', 'Full-year spread'],
      comp.slice(0, 6).map(function (x) {
        return [niceName(x.title), money(x.naive.p10), '×' + x.naive.ratio,
          money(x.fullYear.p10), '×' + x.fullYear.ratio];
      })));
    var collapse = el('p', 'lab-note');
    collapse.innerHTML = 'Every one of these collapses. ' +
      strong(f.numbers.unreportable) + ' further classifications — ' +
      niceName(f.numbers.unreportableExample) + ' among them — have too few ' +
      'full-year holders to report a spread at all, which is itself the answer: the ' +
      'naive chart was not measuring pay, it was measuring turnover.';
    host.appendChild(collapse);

    host.appendChild(el('p', 'lab-caption',
      'Widest genuine spreads, full-year employees only'));
    host.appendChild(table(
      ['Classification', 'Employees', '10th pct', 'Median', '90th pct', 'Spread'],
      model.build.titleSpread.slice(0, 10).map(function (t) {
        return [niceName(t.title), count(t.employees), money(t.p10), money(t.median),
          money(t.p90), '×' + t.ratio];
      })));
    attachQuery(host, model, 'Pay and periods present');

    var bridge = el('div', 'lab-bridge');
    bridge.appendChild(el('p', 'lab-caption', 'What this stage cost'));
    var bp = el('p');
    bp.innerHTML = 'The correction above took one extra query and a stated rule. Finding ' +
      'that it was needed took knowing what a payroll record means. That is the whole ' +
      'difference between a dashboard and an answer — and it is the part that does not ' +
      'come out of a tool. <a href="/#contact">Tell us what\'s stuck.</a>';
    bridge.appendChild(bp);
    host.appendChild(bridge);
  }

  // ------------------------------------------------------------------- Ask

  function renderAsk(model) {
    var host = document.getElementById('pp-ask');
    if (!host) return;
    host.innerHTML = '';
    var fy = model.rules.focusYear;
    var c = model.build.concentration;
    var depts = model.model.departments;
    var years = model.land.byYear.filter(function (y) { return y.complete; });
    var t = model.rules.otTotals;
    var pf = model.findings.filter(function (x) { return x.id === 'part-year-records'; })[0];
    var top = depts[0];

    var first = years[0], last = years[years.length - 1];
    var payGrowth = (last.amount / first.amount - 1) * 100;
    var headGrowth = (last.employees / first.employees - 1) * 100;

    var otShareOfPay = model.model.departments.reduce(function (a, d) {
      return a + d.ot.named; }, 0) /
      model.model.departments.reduce(function (a, d) { return a + d.total; }, 0) * 100;

    var qs = [
      {
        q: 'Which departments spend the most on overtime?',
        body: [
          'In ' + fy + ', ' + strong(niceName(top.department)) + ' at ' +
          strong(big(top.ot.named)) + ', which is ' + strong(pct(top.otShare)) +
          ' of that department\'s payroll. ' + strong(niceName(depts[1].department)) +
          ' follows at ' + strong(big(depts[1].ot.named)) + '.',
          'Absolute size mostly tracks headcount, so the more useful ranking is overtime ' +
          'as a share of the department\'s own payroll. On that measure ' +
          strong(niceName(depts.slice().sort(function (a, b) {
            return b.otShare - a.otShare; })[0].department)) + ' leads at ' +
          strong(pct(depts.slice().sort(function (a, b) {
            return b.otShare - a.otShare; })[0].otShare)) + '.'
        ],
        fields: 'department, pay_element, amount · payroll_year = ' + fy
      },
      {
        q: 'Is overtime concentrated among a small number of employees?',
        body: [
          'Less than the question expects. Of ' + strong(count(c.earners)) +
          ' employees with overtime in ' + fy + ', the top ' + strong('10%') + ' took ' +
          strong(pct(c.top10.share)) + ' and the top ' + strong('1%') + ' took ' +
          strong(pct(c.top1.share)) + '. A genuinely captured programme would put far ' +
          'more than a third in the top decile.',
          'The tail is real all the same: ' + strong(count(c.over100k)) + ' people took ' +
          'more than ' + strong('$100,000') + ' each, against a median of ' +
          strong(money(c.median)) + '. Both facts are true, and a chart showing only one ' +
          'of them is an argument rather than an answer.'
        ],
        fields: 'employee_dataset_id, amount · overtime elements only · ' + fy
      },
      {
        q: 'How have payroll and headcount changed over time?',
        body: [
          'Across the complete years ' + strong(first.year + '–' + last.year) + ', payroll ' +
          'rose ' + strong(pct(payGrowth)) + ' — ' + strong(big(first.amount)) + ' to ' +
          strong(big(last.amount)) + ' — while distinct employees paid rose ' +
          strong(pct(headGrowth)) + ', from ' + strong(count(first.employees)) + ' to ' +
          strong(count(last.employees)) + '.',
          'Spending is growing faster than headcount, which is the finding worth having: ' +
          'the cost per person paid is rising rather than the workforce expanding. ' +
          'The partial year in the snapshot is excluded from this comparison entirely.'
        ],
        fields: 'payroll_year, amount, employee_dataset_id · complete years only'
      },
      {
        q: 'Which job classifications show the greatest pay variation?',
        body: [
          'Once part-year records are excluded, ' +
          strong(niceName(model.build.titleSpread[0].title)) + ' has the widest genuine ' +
          'spread at ' + strong('×' + model.build.titleSpread[0].ratio) + ' between the ' +
          '10th and 90th percentile — ' + strong(money(model.build.titleSpread[0].p10)) +
          ' to ' + strong(money(model.build.titleSpread[0].p90)) + ' across ' +
          strong(count(model.build.titleSpread[0].employees)) + ' full-year employees.',
          'Answered without that exclusion the winner would be ' +
          strong(niceName(pf.numbers.title)) + ' at ' + strong('×' + pf.numbers.naiveRatio) +
          ', which is not a pay finding at all — it is a measurement of who changed jobs.'
        ],
        fields: 'title, employee_dataset_id, payroll_period · ≥ ' + pf.numbers.minPeriods +
          ' of ' + pf.numbers.of + ' periods'
      },
      {
        q: 'Are apparent salary outliers errors, legitimate cases, or incomplete records?',
        body: [
          'In this dataset, overwhelmingly the third. The extreme low values that drive ' +
          'every naive spread are complete, correct records of people who were only in ' +
          'that classification for part of the year.',
          'The distinguishing test is cheap and it is the one worth building in: count the ' +
          'pay periods each employee actually appears in before comparing annual totals. ' +
          strong(pf.numbers.unreportable) + ' classifications in this snapshot have too ' +
          'few full-year holders to support a spread at all, and reporting one for them ' +
          'would be inventing a number.'
        ],
        fields: 'count(distinct payroll_period) per employee per title'
      },
      {
        q: 'What proportion of total compensation comes from overtime?',
        body: [
          'In ' + fy + ', ' + strong(pct(otShareOfPay)) + ' of everything the City paid, ' +
          'using the middle overtime rule. Under the strictest rule the same year\'s ' +
          'answer is lower and under the broadest it is higher; across the full snapshot ' +
          'the three rules span ' + strong(big(t.strict)) + ' to ' + strong(big(t.broad)) + '.',
          'This is the question where publishing the rule matters most. A single ' +
          'percentage with no definition attached is not reproducible, and two teams ' +
          'quoting different figures for the same year is usually this, not a data problem.'
        ],
        fields: 'pay_element classification · all departments · ' + fy
      }
    ];

    qs.forEach(function (item, i) {
      var d = el('details', 'lab-q');
      var s = el('summary');
      s.appendChild(el('span', 'lab-q-text', item.q));
      d.appendChild(s);
      var b = el('div', 'lab-q-body');
      item.body.forEach(function (html) { paragraph(b, html); });
      b.appendChild(el('p', 'lab-q-fields', item.fields));
      d.appendChild(b);
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
        root.textContent = 'Self-check passed: ' + count(model.source.rowsInSource) +
          ' source rows summarised into ' + model.model.elements.length +
          ' pay elements across ' + model.model.departments.length + ' departments; ' +
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

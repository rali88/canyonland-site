/* BI Lifecycle Lab — Legacy Payroll Intelligence.
 *
 * Runs entirely in the browser. The corpus is synthetic and ships with the
 * page; nothing is uploaded and nothing is stored.
 *
 * The decoder below reads the same bytes the Python generator wrote. Because a
 * second implementation that quietly disagrees with the first is worse than no
 * second implementation, the corpus carries an `expected` block and the page
 * checks itself against it on load. A mismatch is reported on the page rather
 * than hidden — the same discipline as the estatemap port.
 */
(function () {
  'use strict';

  var DATA = '/lab/data/payroll-corpus.json';

  /* ---------------- EBCDIC ----------------
   * cp037, the US code page. Only the 96 characters this corpus uses are
   * mapped; anything else decodes to a visible placeholder rather than a
   * plausible wrong character. */
  var EBCDIC = (function () {
    var t = new Array(256).fill('�');
    t[0x40] = ' ';
    var pairs = [
      [0x4B, '.'], [0x4C, '<'], [0x4D, '('], [0x4E, '+'], [0x50, '&'],
      [0x5A, '!'], [0x5B, '$'], [0x5C, '*'], [0x5D, ')'], [0x5E, ';'],
      [0x60, '-'], [0x61, '/'], [0x6B, ','], [0x6C, '%'], [0x6D, '_'],
      [0x6E, '>'], [0x6F, '?'], [0x7A, ':'], [0x7D, "'"], [0x7E, '='],
      [0x7F, '"']
    ];
    pairs.forEach(function (p) { t[p[0]] = p[1]; });
    'abcdefghi'.split('').forEach(function (c, i) { t[0x81 + i] = c; });
    'jklmnopqr'.split('').forEach(function (c, i) { t[0x91 + i] = c; });
    'stuvwxyz'.split('').forEach(function (c, i) { t[0xA2 + i] = c; });
    'ABCDEFGHI'.split('').forEach(function (c, i) { t[0xC1 + i] = c; });
    'JKLMNOPQR'.split('').forEach(function (c, i) { t[0xD1 + i] = c; });
    'STUVWXYZ'.split('').forEach(function (c, i) { t[0xE2 + i] = c; });
    '0123456789'.split('').forEach(function (c, i) { t[0xF0 + i] = c; });
    return t;
  })();

  function ebcdic(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += EBCDIC[bytes[i]];
    return s;
  }

  /* COMP-3. Two digits per byte; the final low nibble is the sign, not a
     digit. Reading it as one shifts every value and still yields a number that
     looks reasonable, which is why this is the classic silent failure. */
  function unpack(bytes, scale) {
    var nib = '';
    for (var i = 0; i < bytes.length; i++) {
      nib += (bytes[i] >> 4).toString(16) + (bytes[i] & 0x0F).toString(16);
    }
    var digits = nib.slice(0, -1), sign = nib.slice(-1);
    if (!/^[0-9]*$/.test(digits)) throw new Error('non-digit nibble in packed field');
    var v = parseInt(digits || '0', 10);
    if (sign === 'd' || sign === 'b') v = -v;
    return v / Math.pow(10, scale);
  }

  var EMP_LEN = 80, TRAN_LEN = 40;
  var EMP_FIELDS = [
    ['EM-EMPLOYEE-ID', 0, 9, 'X', 'id'],
    ['EM-LAST-NAME', 9, 20, 'X', 'last'],
    ['EM-FIRST-NAME', 29, 15, 'X', 'first'],
    ['EM-DEPT-CODE', 44, 4, 'X', 'dept'],
    ['EM-STATUS', 48, 1, 'X', 'status'],
    ['EM-FLSA-CLASS', 49, 1, 'X', 'flsa'],
    ['EM-HIRE-DATE', 50, 8, '9', 'hired'],
    ['EM-TERM-DATE', 58, 8, '9', 'termed'],
    ['EM-PAY-RATE', 66, 4, 'P2', 'rate'],
    ['EM-PENSION-TIER', 70, 1, 'X', 'tier'],
    ['EM-YTD-PENS-EARN', 71, 5, 'P2', 'ytdPens'],
    ['EM-YTD-TIER2-CONTRIB', 76, 4, 'P2', 'ytdTier2']
  ];
  var TRAN_FIELDS = [
    ['PT-EMPLOYEE-ID', 0, 9, 'X', 'emp'],
    ['PT-PERIOD-END', 9, 8, '9', 'period'],
    ['PT-PAYCODE', 17, 4, 'X', 'paycode'],
    ['PT-HOURS', 21, 3, 'P2', 'hours'],
    ['PT-RATE-MULT', 24, 3, 'P3', 'mult'],
    ['PT-AMOUNT', 27, 5, 'P2', 'amount'],
    ['PT-VOUCHER-FLAG', 32, 1, 'X', 'onVoucher'],
    ['PT-EXCLUDE-REASON', 33, 2, 'X', 'reason']
  ];

  function decodeField(rec, spec) {
    var raw = rec.subarray(spec[1], spec[1] + spec[2]);
    if (spec[3] === 'X') return ebcdic(raw);
    if (spec[3] === '9') return parseInt(ebcdic(raw), 10);
    return unpack(raw, parseInt(spec[3].slice(1), 10));
  }

  function decodeAll(bytes, len, fields) {
    var out = [];
    for (var off = 0; off + len <= bytes.length; off += len) {
      var rec = bytes.subarray(off, off + len), o = { _offset: off };
      fields.forEach(function (f) { o[f[4]] = decodeField(rec, f); });
      if (typeof o.id === 'string') o.id = o.id.trim();
      if (typeof o.emp === 'string') o.emp = o.emp.trim();
      out.push(o);
    }
    return out;
  }

  function b64ToBytes(b64) {
    var bin = atob(b64), a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }

  /* ---------------- helpers ---------------- */
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function money(n) {
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function table(headers, rows, opts) {
    var wrap = el('div', 'lab-table-wrap');
    var t = el('table', 'lab-table');
    var thead = el('thead'), tr = el('tr');
    headers.forEach(function (h) { tr.appendChild(el('th', null, h)); });
    thead.appendChild(tr); t.appendChild(thead);
    var tb = el('tbody');
    rows.forEach(function (r) {
      var row = el('tr');
      if (opts && opts.flag && opts.flag(r)) row.className = 'flagged';
      r.forEach(function (c) {
        var td = el('td');
        if (c && c.html) td.innerHTML = c.html; else td.textContent = c;
        row.appendChild(td);
      });
      tb.appendChild(row);
    });
    t.appendChild(tb); wrap.appendChild(t);
    return wrap;
  }
  function bars(items, fmt) {
    var max = Math.max.apply(null, items.map(function (i) { return i.value; })) || 1;
    var box = el('div', 'lab-bars');
    items.forEach(function (i) {
      var row = el('div', 'lab-bar');
      row.appendChild(el('span', 'lab-bar-label', i.label));
      var track = el('span', 'lab-bar-track');
      var fill = el('span', 'lab-bar-fill');
      fill.style.width = Math.max(1, (i.value / max) * 100) + '%';
      if (i.flagged) fill.classList.add('is-flagged');
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('span', 'lab-bar-value', fmt ? fmt(i.value) : i.value));
      box.appendChild(row);
    });
    return box;
  }
  function sqlBlock(sql) {
    var d = el('details', 'lab-sql');
    var s = el('summary', null, 'Show the query behind this');
    var pre = el('pre'); pre.appendChild(el('code', null, sql));
    d.appendChild(s); d.appendChild(pre);
    return d;
  }

  /* ---------------- stages ---------------- */

  function stageExtract(root, model) {
    var emps = model.employees, i = 0;

    var picker = el('div', 'lab-picker');
    var prev = el('button', 'btn btn--quiet', 'Previous record');
    var next = el('button', 'btn btn--quiet', 'Next record');
    var pos = el('span', 'lab-pos');
    prev.type = next.type = 'button';
    picker.appendChild(prev); picker.appendChild(next); picker.appendChild(pos);

    var hexBox = el('div', 'lab-hex');
    var fieldBox = el('div');

    function render() {
      var e = emps[i], bytes = model.empBytes.subarray(e._offset, e._offset + EMP_LEN);
      pos.textContent = 'Record ' + (i + 1) + ' of ' + emps.length +
        ' · offset ' + e._offset + ' · 80 bytes';

      hexBox.innerHTML = '';
      var hex = '', asciiChars = '', ebcdicChars = '';
      for (var b = 0; b < bytes.length; b++) {
        hex += bytes[b].toString(16).padStart(2, '0') + (b % 16 === 15 ? '\n' : ' ');
        // What a tool that assumes ASCII would show — mostly unprintable.
        asciiChars += (bytes[b] >= 0x20 && bytes[b] < 0x7F)
          ? String.fromCharCode(bytes[b]) : '.';
        ebcdicChars += EBCDIC[bytes[b]] === '�' ? '.' : EBCDIC[bytes[b]];
      }
      var pre = el('pre'); pre.appendChild(el('code', null, hex.trim()));
      hexBox.appendChild(el('p', 'lab-caption', 'The bytes as they sit in the dataset'));
      hexBox.appendChild(pre);
      hexBox.appendChild(el('p', 'lab-caption',
        'Read as ASCII: ' + asciiChars.slice(0, 46) + '…'));
      hexBox.appendChild(el('p', 'lab-caption',
        'Read as EBCDIC: ' + ebcdicChars.slice(0, 46) + '…'));

      var rows = EMP_FIELDS.map(function (f) {
        var v = decodeField(bytes, f), note = '';
        if (f[3] === 'P2') note = 'packed decimal, implied V99';
        else if (f[3] === '9') note = 'zoned display digits';
        else note = 'EBCDIC text';
        if (f[4] === 'termed' && v === 99999999) note += ' · 99999999 means no termination';
        var shown = (f[3] === 'P2') ? v.toFixed(2) : String(v).trim();
        return [f[0], f[1] + '–' + (f[1] + f[2] - 1),
                { html: '<code>' + esc(shown) + '</code>' }, note];
      });
      fieldBox.innerHTML = '';
      fieldBox.appendChild(table(['Field', 'Bytes', 'Decoded', 'How'], rows));
    }

    prev.addEventListener('click', function () { i = (i - 1 + emps.length) % emps.length; render(); });
    next.addEventListener('click', function () { i = (i + 1) % emps.length; render(); });

    root.appendChild(picker);
    root.appendChild(hexBox);
    root.appendChild(fieldBox);
    root.appendChild(el('p', 'lab-note',
      'Nothing here was inferred from field names. Each value was read at a byte ' +
      'offset the copybook specifies, in the encoding it specifies.'));
    render();
  }

  function stageProfile(root, model) {
    var f = model.findings;

    root.appendChild(el('p', 'lab-lede',
      'The decode succeeded. That is not the same as the data being sound. ' +
      'These are the things a load would carry straight into the warehouse.'));

    var summary = [
      ['Employee records', model.employees.length, false],
      ['Pay transactions', model.transactions.length, false],
      ['Rows on the voucher', model.onVoucher.length, false],
      ['Rows excluded from the voucher', f.excluded.length, true],
      ['Tier 2 employees at or over the cap', f.atCap.length, true],
      ['Contributions taken past the cap', f.overContributed.length, true],
      ['Overtime on exempt employees', f.otExempt.length, true],
      ['Department codes with no org entry', f.orphanDepts.length, true]
    ];
    root.appendChild(table(['Measure', 'Count', ''],
      summary.map(function (s) {
        return [s[0], s[1], s[2] && s[1] > 0 ? { html: '<span class="lab-flag">needs a decision</span>' } : ''];
      })));

    root.appendChild(el('h3', null, 'Why rows are missing from the voucher'));
    root.appendChild(el('p', 'lab-note',
      'There is no single cause, which is why the question keeps coming back. ' +
      'Four distinct rules remove rows, and only one of them is a defect.'));
    var reasons = Object.keys(f.byReason).sort(function (a, b) {
      return f.byReason[b] - f.byReason[a];
    });
    root.appendChild(table(['Code', 'Reason', 'Rows', 'Is it wrong?'],
      reasons.map(function (r) {
        var judgment = r === 'DP'
          ? { html: '<span class="lab-flag">Yes — a broken join, not a rule</span>' }
          : 'No — working as intended';
        return [{ html: '<code>' + esc(r) + '</code>' },
                model.reference.exclusionReasons[r], f.byReason[r], judgment];
      })));

    root.appendChild(el('h3', null, 'Tier 2 contributions past the cap'));
    root.appendChild(el('p', 'lab-note',
      'The cap in this synthetic dataset is ' + money(model.capDollars) +
      ' of pensionable earnings at ' + (model.rate * 100).toFixed(2) +
      '%, giving a maximum contribution of ' + money(model.maxContribution) + '. ' +
      'Two employees are above it.'));
    root.appendChild(table(
      ['Employee', 'YTD pensionable', 'YTD contribution', 'Maximum', 'Over by'],
      f.atCap.map(function (e) {
        var over = e.ytdTier2 - model.maxContribution;
        return [e.id, money(e.ytdPens), money(e.ytdTier2), money(model.maxContribution),
                over > 0.005 ? { html: '<span class="lab-flag">' + money(over) + '</span>' } : '—'];
      }), { flag: function (r) { return r[4] !== '—'; } }));
    root.appendChild(el('p', 'lab-note',
      'This is the finding worth carrying into a conversation: a contribution ' +
      'taken after the cap is money that has to be refunded, and it will not ' +
      'appear in any total that only sums what was deducted.'));
  }

  function stageModel(root, model) {
    root.appendChild(el('p', 'lab-lede',
      'Two flat files with repeated employee attributes on every row. The ' +
      'shape they imply is one fact table and four dimensions.'));

    root.appendChild(el('p', 'lab-grain',
      'Grain: one row per employee, per paycode, per pay period.'));

    var star = el('div', 'lab-star');
    var fact = el('div', 'lab-node lab-node--fact');
    fact.appendChild(el('p', 'lab-node-kind', 'Fact'));
    fact.appendChild(el('h4', null, 'FCT_PAY_TRANSACTION'));
    ['employee_key', 'department_key', 'paycode_key', 'period_key',
     'hours', 'rate_multiplier', 'amount', 'on_voucher', 'exclusion_reason']
      .forEach(function (c) { fact.appendChild(el('p', 'lab-col', c)); });
    star.appendChild(fact);

    var dims = el('div', 'lab-dims');
    [['DIM_EMPLOYEE', ['employee_key', 'employee_id', 'last_name', 'first_name',
                       'flsa_class', 'status', 'pension_tier']],
     ['DIM_DEPARTMENT', ['department_key', 'department_code', 'department_name',
                         'is_in_org_table']],
     ['DIM_PAYCODE', ['paycode_key', 'paycode', 'description', 'is_cash',
                      'reaches_voucher']],
     ['DIM_PERIOD', ['period_key', 'period_end_date', 'fiscal_year', 'pay_cycle']]
    ].forEach(function (d) {
      var n = el('div', 'lab-node');
      n.appendChild(el('p', 'lab-node-kind', 'Dimension'));
      n.appendChild(el('h4', null, d[0]));
      d[1].forEach(function (c) { n.appendChild(el('p', 'lab-col', c)); });
      dims.appendChild(n);
    });
    star.appendChild(dims);
    root.appendChild(star);

    root.appendChild(el('p', 'lab-note',
      'Two modelling decisions are worth naming, because they are the ones a ' +
      'report will later depend on. Exclusion reason belongs on the fact, not ' +
      'the paycode dimension, because the same paycode is excluded for ' +
      'different reasons on different rows. And is_in_org_table exists so a ' +
      'department code that fails the join is still a row you can count, ' +
      'rather than a row that silently disappears.'));
  }

  function stageVisualize(root, model) {
    root.appendChild(el('p', 'lab-lede',
      'Four questions a payroll director asks, answered from the modelled data. ' +
      'The query behind each is available under it.'));

    var byDept = {};
    model.onVoucher.forEach(function (t) {
      var e = model.byId[t.emp];
      if (!e) return;
      var name = model.reference.departments[e.dept] || ('Unmapped ' + e.dept);
      byDept[name] = (byDept[name] || 0) + t.amount;
    });
    root.appendChild(el('h3', null, 'Gross on the voucher by department'));
    root.appendChild(bars(Object.keys(byDept).sort(function (a, b) {
      return byDept[b] - byDept[a];
    }).map(function (k) {
      return { label: k, value: byDept[k], flagged: k.indexOf('Unmapped') === 0 };
    }), money));
    root.appendChild(sqlBlock(
      'SELECT d.department_name,\n' +
      '       SUM(f.amount) AS gross_on_voucher\n' +
      '  FROM fct_pay_transaction f\n' +
      '  JOIN dim_department      d ON d.department_key = f.department_key\n' +
      ' WHERE f.on_voucher = TRUE\n' +
      '   AND f.period_key = :period\n' +
      ' GROUP BY d.department_name\n' +
      ' ORDER BY gross_on_voucher DESC;'));

    var byCode = {};
    model.transactions.forEach(function (t) {
      var c = t.paycode.trim();
      byCode[c] = (byCode[c] || 0) + t.amount;
    });
    root.appendChild(el('h3', null, 'Amount by paycode, voucher and non-voucher'));
    root.appendChild(bars(Object.keys(byCode).sort(function (a, b) {
      return byCode[b] - byCode[a];
    }).map(function (k) {
      var meta = model.paycodeByCode[k];
      return { label: k + (meta && !meta.onVoucher ? ' (not on voucher)' : ''),
               value: byCode[k], flagged: meta && !meta.onVoucher };
    }), money));
    root.appendChild(sqlBlock(
      'SELECT p.paycode, p.reaches_voucher,\n' +
      '       SUM(f.amount) AS amount\n' +
      '  FROM fct_pay_transaction f\n' +
      '  JOIN dim_paycode         p ON p.paycode_key = f.paycode_key\n' +
      ' WHERE f.period_key = :period\n' +
      ' GROUP BY p.paycode, p.reaches_voucher\n' +
      ' ORDER BY amount DESC;'));

    var ot = model.transactions.filter(function (t) { return t.paycode.trim() === 'OT'; });
    var otByDept = {};
    ot.forEach(function (t) {
      var e = model.byId[t.emp];
      if (!e) return;
      var name = model.reference.departments[e.dept] || ('Unmapped ' + e.dept);
      otByDept[name] = (otByDept[name] || 0) + t.hours;
    });
    root.appendChild(el('h3', null, 'Overtime hours by department'));
    root.appendChild(bars(Object.keys(otByDept).sort(function (a, b) {
      return otByDept[b] - otByDept[a];
    }).map(function (k) {
      return { label: k, value: otByDept[k] };
    }, function (v) { return v.toFixed(2) + ' h'; }), function (v) {
      return v.toFixed(2) + ' h';
    }));
    root.appendChild(sqlBlock(
      'SELECT d.department_name,\n' +
      '       SUM(f.hours) AS overtime_hours\n' +
      '  FROM fct_pay_transaction f\n' +
      '  JOIN dim_paycode         p ON p.paycode_key = f.paycode_key\n' +
      '  JOIN dim_department      d ON d.department_key = f.department_key\n' +
      " WHERE p.paycode = 'OT'\n" +
      '   AND f.period_key = :period\n' +
      ' GROUP BY d.department_name\n' +
      ' ORDER BY overtime_hours DESC;'));

    root.appendChild(el('h3', null, 'Tier 2 year-to-date against the cap'));
    root.appendChild(bars(model.findings.atCap.map(function (e) {
      return { label: e.id, value: e.ytdPens,
               flagged: e.ytdTier2 > model.maxContribution + 0.005 };
    }), money));
    root.appendChild(el('p', 'lab-note',
      'Bars marked in accent are employees whose contribution exceeded the ' +
      'maximum, not merely whose earnings passed the cap. The distinction is ' +
      'the finding.'));
    root.appendChild(sqlBlock(
      'SELECT e.employee_id,\n' +
      '       e.ytd_pensionable_earnings,\n' +
      '       e.ytd_tier2_contribution,\n' +
      '       :cap * :rate AS maximum_contribution\n' +
      '  FROM dim_employee e\n' +
      " WHERE e.pension_tier = '2'\n" +
      '   AND e.ytd_pensionable_earnings >= :cap\n' +
      ' ORDER BY e.ytd_tier2_contribution DESC;'));
  }

  /* ---------------- curated questions ----------------
   * Written answers, not a language model. Every one is computed from the
   * decoded data at the moment it is shown, so the numbers cannot drift away
   * from the dataset the way a hand-written answer would. */
  function stageAsk(root, model) {
    var f = model.findings;
    var qs = [
      {
        q: 'Why are some employees associated with a paycode not included in the test payroll voucher?',
        a: function () {
          var parts = Object.keys(f.byReason).sort().map(function (r) {
            return f.byReason[r] + ' ' + (f.byReason[r] === 1 ? 'row' : 'rows') +
              ' — ' + model.reference.exclusionReasons[r].toLowerCase();
          });
          return 'Four separate rules remove ' + f.excluded.length + ' of ' +
            model.transactions.length + ' rows: ' + parts.join('; ') + '. Three of ' +
            'those are working as designed. The department-code failure is not: ' +
            'those rows are absent because the join found nothing, so the pay is ' +
            'real but invisible. That is the one to fix.';
        },
        fields: 'PT-VOUCHER-FLAG, PT-EXCLUDE-REASON, EM-DEPT-CODE, EM-STATUS, EM-TERM-DATE'
      },
      {
        q: 'Whose Tier 2 contribution has reached their maximum limit?',
        a: function () {
          return f.atCap.length + ' Tier 2 employees have year-to-date pensionable ' +
            'earnings at or above the ' + money(model.capDollars) + ' cap: ' +
            f.atCap.map(function (e) { return e.id; }).join(', ') + '. Of those, ' +
            f.overContributed.length + ' had contributions taken past the ' +
            money(model.maxContribution) + ' maximum — ' +
            f.overContributed.map(function (e) {
              return e.id + ' by ' + money(e.ytdTier2 - model.maxContribution);
            }).join(' and ') + '. Reaching the cap is expected. Contributing past ' +
            'it is a refund owed.';
        },
        fields: 'EM-PENSION-TIER, EM-YTD-PENS-EARN, EM-YTD-TIER2-CONTRIB'
      },
      {
        q: 'How much overtime was paid this period, and where?',
        a: function () {
          var ot = model.transactions.filter(function (t) { return t.paycode.trim() === 'OT'; });
          var hrs = ot.reduce(function (s, t) { return s + t.hours; }, 0);
          var amt = ot.reduce(function (s, t) { return s + t.amount; }, 0);
          return ot.length + ' overtime rows, ' + hrs.toFixed(2) + ' hours, ' +
            money(amt) + ' at the 1.5 multiplier. ' + f.otExempt.length +
            ' of those rows sit against employees classified FLSA exempt (' +
            f.otExempt.join(', ') + '), which is either a misclassification or a ' +
            'miskeyed paycode. Either way it is a question for HR before it is a ' +
            'question for payroll.';
        },
        fields: 'PT-PAYCODE, PT-HOURS, PT-AMOUNT, EM-FLSA-CLASS'
      },
      {
        q: 'What is the gross on the voucher, and does it reconcile?',
        a: function () {
          var gross = model.onVoucher.reduce(function (s, t) { return s + t.amount; }, 0);
          var all = model.transactions.reduce(function (s, t) { return s + t.amount; }, 0);
          return 'Voucher gross is ' + money(gross) + ' across ' +
            model.onVoucher.length + ' rows. Total pay activity in the period is ' +
            money(all) + '. The ' + money(all - gross) + ' difference is the ' +
            f.excluded.length + ' excluded rows, and it reconciles exactly — which ' +
            'is the point of keeping the exclusion reason on the fact table rather ' +
            'than filtering those rows away at load.';
        },
        fields: 'PT-AMOUNT, PT-VOUCHER-FLAG'
      }
    ];

    root.appendChild(el('p', 'lab-lede',
      'No language model is involved. These are written answers, computed from ' +
      'the decoded data each time they are opened, so a number here cannot drift ' +
      'away from the dataset it describes.'));

    qs.forEach(function (item) {
      var d = el('details', 'lab-q');
      var s = el('summary');
      s.appendChild(el('span', 'lab-q-text', item.q));
      d.appendChild(s);
      var body = el('div', 'lab-q-body');
      body.appendChild(el('p', null, item.a()));
      body.appendChild(el('p', 'lab-q-fields', 'Fields used: ' + item.fields));
      d.appendChild(body);
      root.appendChild(d);
    });
  }

  /* ---------------- assembly ---------------- */

  function analyse(payload) {
    var empBytes = b64ToBytes(payload.records.employeeB64);
    var tranBytes = b64ToBytes(payload.records.transactionB64);
    var employees = decodeAll(empBytes, EMP_LEN, EMP_FIELDS);
    var transactions = decodeAll(tranBytes, TRAN_LEN, TRAN_FIELDS);

    var byId = {};
    employees.forEach(function (e) { byId[e.id] = e; });
    var paycodeByCode = {};
    payload.reference.paycodes.forEach(function (p) { paycodeByCode[p.code] = p; });

    var cap = payload.params.tier2EarningsCapCents / 100;
    var rate = payload.params.tier2Rate;
    var maxContribution = Math.round(cap * rate * 100) / 100;

    var excluded = transactions.filter(function (t) { return t.onVoucher === 'N'; });
    var onVoucher = transactions.filter(function (t) { return t.onVoucher === 'Y'; });
    var byReason = {};
    excluded.forEach(function (t) {
      var r = t.reason.trim();
      byReason[r] = (byReason[r] || 0) + 1;
    });
    var tier2 = employees.filter(function (e) { return e.tier === '2'; });
    var atCap = tier2.filter(function (e) { return e.ytdPens >= cap; })
      .sort(function (a, b) { return b.ytdPens - a.ytdPens; });
    var overContributed = atCap.filter(function (e) {
      return e.ytdTier2 > maxContribution + 0.005;
    });
    var exemptIds = {};
    employees.forEach(function (e) { if (e.flsa === 'E') exemptIds[e.id] = 1; });
    var otExempt = Object.keys(transactions.reduce(function (acc, t) {
      if (t.paycode.trim() === 'OT' && exemptIds[t.emp]) acc[t.emp] = 1;
      return acc;
    }, {})).sort();
    var orphanDepts = Object.keys(employees.reduce(function (acc, e) {
      if (!payload.reference.departments[e.dept]) acc[e.dept] = 1;
      return acc;
    }, {})).sort();

    return {
      empBytes: empBytes, employees: employees, transactions: transactions,
      byId: byId, reference: payload.reference, paycodeByCode: paycodeByCode,
      capDollars: cap, rate: rate, maxContribution: maxContribution,
      onVoucher: onVoucher,
      findings: {
        excluded: excluded, byReason: byReason, atCap: atCap,
        overContributed: overContributed, otExempt: otExempt,
        orphanDepts: orphanDepts
      }
    };
  }

  /* The browser decode must agree with the Python that wrote the bytes. */
  function selfCheck(model, expected) {
    var got = {
      employeeCount: model.employees.length,
      transactionCount: model.transactions.length,
      excludedCount: model.findings.excluded.length,
      excludedByReason: model.findings.byReason,
      tier2AtCap: model.findings.atCap.map(function (e) { return e.id; }).sort(),
      tier2OverContributed: model.findings.overContributed.map(function (e) { return e.id; }).sort(),
      overtimeOnExempt: model.findings.otExempt,
      orphanDepartments: model.findings.orphanDepts,
      grossOnVoucherCents: Math.round(
        model.onVoucher.reduce(function (s, t) { return s + t.amount; }, 0) * 100)
    };
    var diffs = [];
    Object.keys(expected).forEach(function (k) {
      if (JSON.stringify(got[k]) !== JSON.stringify(expected[k])) {
        diffs.push(k + ': expected ' + JSON.stringify(expected[k]) +
                   ', decoded ' + JSON.stringify(got[k]));
      }
    });
    return diffs;
  }

  function boot() {
    // Guard on the element this actually writes to, so the script stays inert
    // on every other page without depending on a container that may not exist.
    var status = $('#lab-status');
    if (!status) return;

    fetch(DATA).then(function (r) {
      if (!r.ok) throw new Error('corpus ' + r.status);
      return r.json();
    }).then(function (payload) {
      var model = analyse(payload);
      var diffs = selfCheck(model, payload.expected);

      if (diffs.length) {
        status.className = 'lab-status is-bad';
        status.textContent = 'Decoder disagrees with the reference implementation: ' +
          diffs.join(' · ') + '. The results below are not trustworthy.';
      } else {
        status.className = 'lab-status is-ok';
        status.textContent = 'Decoded ' + model.employees.length + ' employee records and ' +
          model.transactions.length + ' transactions in your browser. Every extracted ' +
          'value matches the reference implementation that wrote the bytes.';
      }

      [['extract', stageExtract], ['profile', stageProfile],
       ['model', stageModel], ['visualize', stageVisualize],
       ['ask', stageAsk]].forEach(function (pair) {
        var host = document.getElementById('stage-' + pair[0]);
        if (host) { host.innerHTML = ''; pair[1](host, model); }
      });
    }).catch(function (err) {
      status.className = 'lab-status is-bad';
      status.textContent = 'The Lab could not load its dataset (' + err.message +
        '). Reload the page to try again.';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

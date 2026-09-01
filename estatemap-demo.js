/* estatemap browser demo.
 *
 * A faithful JavaScript port of the extraction rules in the Python tool. It is
 * loaded on demand, not with the page, so the portfolio page keeps its payload
 * budget for visitors who never open the demo.
 *
 * The port exists to be tried, not to replace the tool. It is checked against
 * the same fixtures as the Python implementation and must agree with it on
 * every extracted fact -- a demo that quietly disagreed would undermine the
 * determinism the tool is built around.
 *
 * Everything runs in the visitor's browser. Nothing is uploaded anywhere.
 */
(function () {
  'use strict';

  var COMMENT_INDICATORS = { '*': 1, '/': 1 };

  var DIVISION_RE = /^(IDENTIFICATION|ID|ENVIRONMENT|DATA|PROCEDURE)\s+DIVISION/i;
  var SECTION_RE = /^([A-Z0-9][A-Z0-9-]*)\s+SECTION\s*\.?$/i;
  var PROGRAM_ID_RE = /^PROGRAM-ID\s*\.\s*([A-Z0-9][A-Z0-9-]*)/i;
  var AUTHOR_RE = /^AUTHOR\s*\.\s*(.*)$/i;
  var DATE_WRITTEN_RE = /^DATE-WRITTEN\s*\.\s*(.*)$/i;
  var ID_KEYWORDS = { 'PROGRAM-ID': 1, 'AUTHOR': 1, 'DATE-WRITTEN': 1 };

  var SELECT_RE = /^SELECT\s+(?:OPTIONAL\s+)?([A-Z0-9][A-Z0-9-]*)\s+ASSIGN\s+TO\s+(?:[A-Z]+-)?([A-Z0-9][A-Z0-9-]*)/i;
  var ORGANIZATION_RE = /ORGANIZATION\s+(?:IS\s+)?([A-Z-]+)/i;
  var ACCESS_MODE_RE = /ACCESS\s+(?:MODE\s+)?(?:IS\s+)?([A-Z-]+)/i;
  var RECORD_KEY_RE = /RECORD\s+KEY\s+(?:IS\s+)?([A-Z0-9-]+)/i;
  var FILE_STATUS_RE = /FILE\s+STATUS\s+(?:IS\s+)?([A-Z0-9-]+)/i;

  var FD_RE = /^FD\s+([A-Z0-9][A-Z0-9-]*)/i;
  var LEVEL_RE = /^(\d{1,2})\s+([A-Z0-9][A-Z0-9-]*|FILLER)\b([\s\S]*)$/i;
  var PIC_RE = /\bPIC(?:TURE)?\s+(?:IS\s+)?(\S+?)(?:\s|$)/i;
  var USAGE_RE = /\b(?:USAGE\s+(?:IS\s+)?)?(COMP-3|COMP-4|COMP-5|COMP-1|COMP-2|COMP|BINARY|PACKED-DECIMAL|DISPLAY|INDEX)\b/i;
  var OCCURS_RE = /\bOCCURS\s+(\d+)/i;
  var REDEFINES_RE = /\bREDEFINES\s+([A-Z0-9-]+)/i;
  var COPY_RE = /\bCOPY\s+([A-Z0-9][A-Z0-9-]*)(?:\s+(?:OF|IN)\s+([A-Z0-9-]+))?/i;

  var OPEN_MODES = { 'INPUT': 'input', 'OUTPUT': 'output', 'I-O': 'update', 'EXTEND': 'extend' };

  var SQL_TABLE_RES = [
    [/\bINSERT\s+INTO\s+([A-Z0-9_.]+)/gi, 'insert'],
    [/\bUPDATE\s+([A-Z0-9_.]+)/gi, 'update'],
    [/\bDELETE\s+FROM\s+([A-Z0-9_.]+)/gi, 'delete'],
    [/\bFROM\s+([A-Z0-9_.]+)/gi, 'select']
  ];

  var JCL_STATEMENT_RE = /^\/\/([A-Z0-9@#$]{1,8})?\s+([A-Z]+)\s*([\s\S]*)$/i;
  var JCL_CONCAT_RE = /^\/\/\s+(\S[\s\S]*)$/;
  var JCL_COMMENT_RE = /^\/\/\*([\s\S]*)$/;
  var DSN_RE = /\bDSN(?:AME)?=([^,\s]+)/i;
  var DISP_RE = /\bDISP=(\([^)]*\)|[A-Z]+)/i;
  var SYSOUT_RE = /\bSYSOUT=([^,\s]+)/i;
  var PGM_RE = /\bPGM=([A-Z0-9@#$]+)/i;
  var PROC_RE = /\bPROC=([A-Z0-9@#$]+)/i;
  var COND_RE = /\bCOND=(\([^)]*\)|[A-Z0-9]+)/i;

  /* ---------- source handling ---------- */

  function isFixedFormat(raw) {
    var votes = 0;
    for (var i = 0; i < Math.min(raw.length, 400); i++) {
      var line = raw[i];
      if (line.length < 8) continue;
      var seq = line.slice(0, 6);
      if (COMMENT_INDICATORS[line[6]] && /^[0-9 ]*$/.test(seq)) votes += 2;
      else if (/^\d{6}$/.test(seq)) votes += 1;
    }
    return votes >= 2;
  }

  function stripLines(raw) {
    var lines = [], comments = [], fixed = isFixedFormat(raw), pending = null;

    for (var i = 0; i < raw.length; i++) {
      var line = raw[i].replace(/\t/g, '    ');
      var body, continuation, areaA, text;

      if (fixed) {
        if (line.length < 7) continue;
        var indicator = line[6];
        body = line.length > 7 ? line.slice(7, 72) : '';
        if (COMMENT_INDICATORS[indicator]) {
          text = body.trim();
          if (text) comments.push(text);
          continue;
        }
        if (indicator === 'D') continue;
        continuation = indicator === '-';
        areaA = body.slice(0, 4).trim().length > 0;
      } else {
        var stripped = line.trim();
        if (stripped.charAt(0) === '*') {
          text = stripped.replace(/^[*>]+/, '').trim();
          if (text) comments.push(text);
          continue;
        }
        body = line;
        continuation = false;
        areaA = line.charAt(0) !== ' ' ? line.slice(0, 4).trim().length > 0 : false;
      }

      if (!body.trim()) continue;

      if (continuation && pending) {
        pending.text = pending.text.replace(/\s+$/, '') + body.trim();
        continue;
      }
      if (pending) lines.push(pending);
      pending = { text: body.trim(), lineno: i + 1, areaA: areaA };
    }
    if (pending) lines.push(pending);
    return { lines: lines, comments: comments };
  }

  /* A period ends a sentence unless it is a decimal point inside a number. */
  function findTerminator(text) {
    var inQuote = null;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQuote) { if (ch === inQuote) inQuote = null; continue; }
      if (ch === "'" || ch === '"') { inQuote = ch; continue; }
      if (ch === '.') {
        var nxt = i + 1 < text.length ? text[i + 1] : ' ';
        var prv = i > 0 ? text[i - 1] : ' ';
        if (/\d/.test(nxt) && /\d/.test(prv)) continue;
        return i;
      }
    }
    return -1;
  }

  function splitSentences(lines) {
    var sentences = [], buf = [], start = null;

    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (!start) start = ln;
      buf.push(ln.text);
      var joined = buf.join(' ');
      var cut = findTerminator(joined);

      while (cut !== -1) {
        sentences.push({ text: joined.slice(0, cut).trim(), lineno: start.lineno, areaA: start.areaA });
        joined = joined.slice(cut + 1).trim();
        start = { text: joined, lineno: ln.lineno, areaA: false };
        buf = joined ? [joined] : [];
        if (!joined) { start = null; break; }
        cut = findTerminator(joined);
      }
    }
    if (buf.length && start && buf.join(' ').trim()) {
      sentences.push({ text: buf.join(' ').trim(), lineno: start.lineno, areaA: start.areaA });
    }
    return sentences;
  }

  /* ---------- data items ---------- */

  function parseDataItem(sentence, path) {
    var m = LEVEL_RE.exec(sentence.text);
    if (!m) return null;
    var rest = m[3] || '';
    var pic = PIC_RE.exec(rest), usage = USAGE_RE.exec(rest);
    var occurs = OCCURS_RE.exec(rest), redef = REDEFINES_RE.exec(rest);
    return {
      level: parseInt(m[1], 10),
      name: m[2].toUpperCase(),
      picture: pic ? pic[1].replace(/\.$/, '') : null,
      usage: usage ? usage[1].toUpperCase() : null,
      occurs: occurs ? parseInt(occurs[1], 10) : null,
      redefines: redef ? redef[1].toUpperCase() : null,
      children: [],
      source: { path: path, line: sentence.lineno }
    };
  }

  function nest(items) {
    var roots = [], stack = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      while (stack.length && stack[stack.length - 1].level >= item.level) stack.pop();
      if (stack.length) stack[stack.length - 1].children.push(item);
      else roots.push(item);
      stack.push(item);
    }
    return roots;
  }

  /* ---------- file access classification ---------- */

  function classifyFiles(program, sentences) {
    var byName = {};
    program.files.forEach(function (f) { byName[f.logicalName.toUpperCase()] = f; });
    /* WRITE and REWRITE name the 01 record, not the file. */
    program.files.forEach(function (f) {
      f.recordLayouts.forEach(function (layout) {
        if (!byName[layout.name.toUpperCase()]) byName[layout.name.toUpperCase()] = f;
      });
    });

    sentences.forEach(function (s) {
      var openRe = /\bOPEN\s+(.+)$/gi, m;
      while ((m = openRe.exec(s.text)) !== null) {
        var current = null;
        m[1].split(/[\s,]+/).forEach(function (token) {
          var key = token.toUpperCase().replace(/\.$/, '');
          if (OPEN_MODES[key]) { current = OPEN_MODES[key]; return; }
          if (!key || !current) return;
          var target = byName[key];
          if (!target) return;
          if (target.access !== 'unknown' && target.access !== current) target.access = 'update';
          else target.access = current;
        });
      }
      var verbRe = /\b(READ|WRITE|REWRITE|DELETE|START)\s+([A-Z0-9][A-Z0-9-]*)/gi, v;
      while ((v = verbRe.exec(s.text)) !== null) {
        var t = byName[v[2].toUpperCase()];
        if (t && t.verbs.indexOf(v[1].toUpperCase()) === -1) t.verbs.push(v[1].toUpperCase());
      }
    });
  }

  /* ---------- program ---------- */

  function parseProgram(path, text) {
    var raw = text.split(/\r?\n/);
    var s = stripLines(raw);
    var sentences = splitSentences(s.lines);

    var program = {
      programId: '', path: path, author: null, dateWritten: null,
      files: [], workingStorage: [], paragraphs: [], calls: [], sql: [],
      copybooks: [], comments: s.comments, lineCount: raw.length
    };

    var division = '', dataSection = '', pendingId = null;
    var fileItems = {}, wsItems = [], currentFd = null, procSentences = [];

    for (var i = 0; i < sentences.length; i++) {
      var sen = sentences[i], up = sen.text.toUpperCase(), m;

      m = DIVISION_RE.exec(up);
      if (m) {
        division = m[1].toUpperCase();
        if (division === 'ID') division = 'IDENTIFICATION';
        dataSection = '';
        continue;
      }

      if (division === 'IDENTIFICATION') {
        if ((m = PROGRAM_ID_RE.exec(sen.text))) { program.programId = m[1].toUpperCase(); pendingId = null; continue; }
        if ((m = AUTHOR_RE.exec(sen.text)) && m[1].trim()) { program.author = m[1].trim(); pendingId = null; continue; }
        if ((m = DATE_WRITTEN_RE.exec(sen.text)) && m[1].trim()) { program.dateWritten = m[1].trim(); pendingId = null; continue; }
        /* "PROGRAM-ID. NAME." carries two periods, so keyword and value can
           land in separate sentences. */
        var bare = up.replace(/\.$/, '').trim();
        if (ID_KEYWORDS[bare]) pendingId = bare;
        else if (pendingId) {
          var value = sen.text.trim().replace(/\.$/, '');
          if (pendingId === 'PROGRAM-ID') program.programId = value.toUpperCase();
          else if (pendingId === 'AUTHOR') program.author = value;
          else if (pendingId === 'DATE-WRITTEN') program.dateWritten = value;
          pendingId = null;
        }
        continue;
      }

      if (division === 'ENVIRONMENT') {
        if ((m = SELECT_RE.exec(sen.text))) {
          var org = ORGANIZATION_RE.exec(sen.text), acc = ACCESS_MODE_RE.exec(sen.text);
          var key = RECORD_KEY_RE.exec(sen.text), sts = FILE_STATUS_RE.exec(sen.text);
          program.files.push({
            logicalName: m[1].toUpperCase(), ddName: m[2].toUpperCase(),
            organization: org ? org[1].toUpperCase() : null,
            accessMode: acc ? acc[1].toUpperCase() : null,
            recordKey: key ? key[1].toUpperCase() : null,
            statusField: sts ? sts[1].toUpperCase() : null,
            recordLayouts: [], access: 'unknown', verbs: [],
            source: { path: path, line: sen.lineno }
          });
        }
        continue;
      }

      if (division === 'DATA') {
        if ((m = SECTION_RE.exec(up))) { dataSection = m[1].toUpperCase(); currentFd = null; continue; }
        if ((m = FD_RE.exec(sen.text))) {
          var fdName = m[1].toUpperCase();
          currentFd = null;
          for (var f = 0; f < program.files.length; f++) {
            if (program.files[f].logicalName === fdName) { currentFd = program.files[f]; break; }
          }
          continue;
        }
        var item = parseDataItem(sen, path);
        if (item) {
          if (dataSection === 'FILE' && currentFd) {
            if (!fileItems[currentFd.logicalName]) fileItems[currentFd.logicalName] = [];
            fileItems[currentFd.logicalName].push(item);
          } else if (dataSection === 'WORKING-STORAGE') {
            wsItems.push(item);
          }
        }
        if ((m = COPY_RE.exec(sen.text))) {
          program.copybooks.push({
            name: m[1].toUpperCase(), library: m[2] ? m[2].toUpperCase() : null,
            source: { path: path, line: sen.lineno }
          });
        }
        continue;
      }

      if (division === 'PROCEDURE') procSentences.push(sen);
    }

    program.workingStorage = nest(wsItems);
    program.files.forEach(function (file) {
      file.recordLayouts = nest(fileItems[file.logicalName] || []);
    });

    parseProcedure(program, procSentences, path);
    classifyFiles(program, procSentences);
    return program;
  }

  function parseProcedure(program, sentences, path) {
    var current = null;

    sentences.forEach(function (s) {
      var text = s.text, bare = text.trim();
      var sec = SECTION_RE.exec(bare);
      var isLabel = s.areaA && (sec !== null || /^[A-Z0-9][A-Z0-9-]*$/i.test(bare));

      if (isLabel) {
        current = {
          name: (sec ? sec[1] : bare).toUpperCase(),
          isSection: sec !== null, performs: [],
          source: { path: path, line: s.lineno }
        };
        program.paragraphs.push(current);
        return;
      }

      var perfRe = /\bPERFORM\s+([A-Z0-9][A-Z0-9-]*)(?:\s+(?:THRU|THROUGH)\s+([A-Z0-9][A-Z0-9-]*))?/gi, p;
      while ((p = perfRe.exec(text)) !== null) {
        if (!current) continue;
        current.performs.push(p[1].toUpperCase());
        if (p[2]) current.performs.push(p[2].toUpperCase());
      }

      var callRe = /\bCALL\s+(?:'([^']+)'|"([^"]+)"|([A-Z0-9-]+))/gi, c;
      while ((c = callRe.exec(text)) !== null) {
        var literal = c[1] || c[2], variable = c[3];
        var usingM = /\bUSING\s+([A-Z0-9 ,-]+)/i.exec(text.slice(c.index + c[0].length));
        program.calls.push({
          target: (literal || variable || '').toUpperCase(),
          dynamic: !literal,
          using: usingM ? usingM[1].split(/[\s,]+/).filter(Boolean).map(function (u) { return u.toUpperCase(); }) : [],
          source: { path: path, line: s.lineno }
        });
      }

      var sqlRe = /\bEXEC\s+SQL\b([\s\S]*?)\bEND-EXEC\b/gi, q;
      while ((q = sqlRe.exec(text)) !== null) {
        var body = q[1], seen = {};
        SQL_TABLE_RES.forEach(function (pair) {
          var re = new RegExp(pair[0].source, 'gi'), op = pair[1], t;
          while ((t = re.exec(body)) !== null) {
            var table = t[1].toUpperCase().replace(/,$/, '');
            var k = table + '|' + op;
            if (table === 'DUAL' || seen[k]) continue;
            seen[k] = 1;
            program.sql.push({ table: table, operation: op, source: { path: path, line: s.lineno } });
          }
        });
      }
    });
  }

  /* ---------- JCL ---------- */

  function logicalStatements(raw) {
    var out = [], buf = '', start = 0;
    for (var i = 0; i < raw.length; i++) {
      var line = raw[i].replace(/\s+$/, '');
      if (!line) continue;
      if (line.indexOf('//*') === 0 || line.indexOf('/*') === 0) {
        if (buf) { out.push([buf, start]); buf = ''; }
        out.push([line, i + 1]);
        continue;
      }
      if (line.indexOf('//') !== 0) continue;
      if (buf) buf += line.slice(2).trim();
      else { buf = line; start = i + 1; }
      if (/,$/.test(buf.replace(/\s+$/, ''))) continue;
      out.push([buf, start]);
      buf = '';
    }
    if (buf) out.push([buf, start]);
    return out;
  }

  function makeDD(name, params, path, lineno) {
    var dsn = DSN_RE.exec(params), disp = DISP_RE.exec(params), sysout = SYSOUT_RE.exec(params);
    return {
      ddName: (name || '').toUpperCase(),
      dsn: dsn ? dsn[1].toUpperCase() : null,
      disp: disp ? disp[1].toUpperCase() : null,
      sysout: sysout ? sysout[1].toUpperCase() : null,
      isDummy: /\bDUMMY\b/i.test(params),
      source: { path: path, line: lineno }
    };
  }

  function parseJob(path, text) {
    var raw = text.split(/\r?\n/);
    var job = { jobName: '', path: path, steps: [], comments: [] };
    var currentStep = null, lastDD = null;

    logicalStatements(raw).forEach(function (entry) {
      var stmt = entry[0], lineno = entry[1], m;

      if ((m = JCL_COMMENT_RE.exec(stmt))) {
        var body = m[1].trim();
        if (body) job.comments.push(body);
        return;
      }

      var concat = JCL_CONCAT_RE.exec(stmt);
      m = JCL_STATEMENT_RE.exec(stmt);

      if (m) {
        var name = m[1], op = m[2].toUpperCase(), params = m[3] || '';
        if (op === 'JOB') { job.jobName = (name || '').toUpperCase(); return; }
        if (op === 'EXEC') {
          var pgm = PGM_RE.exec(params), proc = PROC_RE.exec(params), cond = COND_RE.exec(params);
          var procName = null;
          if (!pgm && !proc) {
            var bare = params.split(',')[0].trim();
            if (/^[A-Z0-9@#$]{1,8}$/i.test(bare)) procName = bare;
          } else if (proc) procName = proc[1];
          currentStep = {
            stepName: (name || '').toUpperCase(),
            program: pgm ? pgm[1].toUpperCase() : null,
            proc: procName ? procName.toUpperCase() : null,
            cond: cond ? cond[1].toUpperCase() : null,
            dds: [], source: { path: path, line: lineno }
          };
          job.steps.push(currentStep);
          lastDD = null;
          return;
        }
        if (op === 'DD' && currentStep) {
          lastDD = makeDD(name, params, path, lineno);
          currentStep.dds.push(lastDD);
          return;
        }
      } else if (concat && currentStep && lastDD) {
        currentStep.dds.push(makeDD(lastDD.ddName, concat[1], path, lineno));
      }
    });

    if (!job.jobName) job.jobName = path.split(/[\\/]/).pop().split('.')[0].toUpperCase();
    return job;
  }

  /* ---------- cross-reference ---------- */

  function buildCrossref(estate) {
    var xref = {
      runsIn: {}, datasets: {}, callers: {}, callees: {},
      missingPrograms: [], unresolvedDDs: [], orphanParagraphs: {}
    };
    var known = {};
    estate.programs.forEach(function (p) { known[p.programId.toUpperCase()] = 1; });

    estate.jobs.forEach(function (job) {
      job.steps.forEach(function (step) {
        if (!step.program) return;
        var pgm = step.program.toUpperCase();
        (xref.runsIn[pgm] = xref.runsIn[pgm] || []).push({ job: job, step: step, label: job.jobName + '.' + step.stepName });
        step.dds.forEach(function (dd) {
          if (!dd.dsn) return;
          var key = pgm + '|' + dd.ddName;
          xref.datasets[key] = xref.datasets[key] || [];
          if (xref.datasets[key].indexOf(dd.dsn) === -1) xref.datasets[key].push(dd.dsn);
        });
      });
    });

    estate.programs.forEach(function (program) {
      var pid = program.programId.toUpperCase();
      program.calls.forEach(function (call) {
        if (call.dynamic) return;
        var target = call.target.toUpperCase();
        xref.callees[pid] = xref.callees[pid] || [];
        if (xref.callees[pid].indexOf(target) === -1) xref.callees[pid].push(target);
        xref.callers[target] = xref.callers[target] || [];
        if (xref.callers[target].indexOf(pid) === -1) xref.callers[target].push(pid);
        if (!known[target] && xref.missingPrograms.indexOf(target) === -1) xref.missingPrograms.push(target);
      });
    });

    estate.programs.forEach(function (program) {
      var pid = program.programId.toUpperCase();
      var steps = xref.runsIn[pid] || [];
      if (!steps.length) return;
      var supplied = {};
      steps.forEach(function (r) { r.step.dds.forEach(function (dd) { supplied[dd.ddName] = 1; }); });
      program.files.forEach(function (f) {
        if (f.ddName && !supplied[f.ddName]) xref.unresolvedDDs.push(pid + ': ' + f.ddName + ' (' + f.logicalName + ')');
      });
    });

    estate.programs.forEach(function (program) {
      var performed = {};
      program.paragraphs.forEach(function (p) { p.performs.forEach(function (t) { performed[t] = 1; }); });
      var pid = program.programId.toUpperCase();
      program.paragraphs.forEach(function (para, i) {
        if (i === 0 || para.isSection) return;
        if (!performed[para.name]) (xref.orphanParagraphs[pid] = xref.orphanParagraphs[pid] || []).push(para.name);
      });
    });

    return xref;
  }

  /* ---------- rendering ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  var ACCESS_LABEL = {
    input: 'reads', output: 'writes', update: 'reads + writes',
    extend: 'appends', unknown: 'not determined'
  };

  function layoutRows(items, depth, out) {
    items.forEach(function (item) {
      var indent = new Array(depth * 3 + 1).join(' ');
      var notes = [];
      if (item.usage) notes.push(item.usage);
      if (item.occurs) notes.push('OCCURS ' + item.occurs);
      if (item.redefines) notes.push('REDEFINES ' + item.redefines);
      out.push('<tr><td>' + (item.level < 10 ? '0' + item.level : item.level) + '</td><td>' +
        indent + '<code>' + esc(item.name) + '</code></td><td>' +
        (item.picture ? '<code>' + esc(item.picture) + '</code>' : '') + '</td><td>' +
        esc(notes.join(', ')) + '</td></tr>');
      layoutRows(item.children, depth + 1, out);
    });
    return out;
  }

  function renderProgram(program, estate, xref) {
    var pid = program.programId || '(unnamed)';
    var h = [];
    h.push('<h4>' + esc(pid) + '</h4>');

    var meta = [esc(program.lineCount) + ' lines'];
    if (program.author) meta.push('Author: ' + esc(program.author));
    if (program.dateWritten) meta.push('Written: ' + esc(program.dateWritten));
    h.push('<p class="demo-meta">' + meta.join(' &middot; ') + '</p>');

    var steps = xref.runsIn[pid.toUpperCase()] || [];
    h.push('<h5>Where it runs</h5>');
    if (steps.length) {
      h.push('<table class="demo-table"><thead><tr><th>Job</th><th>Step</th><th>Condition</th></tr></thead><tbody>');
      steps.forEach(function (r) {
        h.push('<tr><td><code>' + esc(r.job.jobName) + '</code></td><td><code>' + esc(r.step.stepName) +
          '</code></td><td>' + (r.step.cond ? esc(r.step.cond) : '&mdash;') + '</td></tr>');
      });
      h.push('</tbody></table>');
    } else {
      h.push('<p class="demo-note">No JCL in the supplied source executes this program.</p>');
    }

    h.push('<h5>Data it touches</h5>');
    if (program.files.length) {
      h.push('<table class="demo-table"><thead><tr><th>File</th><th>DD</th><th>Access</th><th>Verbs</th><th>Organization</th><th>Dataset</th></tr></thead><tbody>');
      program.files.forEach(function (f) {
        var ds = xref.datasets[pid.toUpperCase() + '|' + (f.ddName || '')] || [];
        h.push('<tr><td><code>' + esc(f.logicalName) + '</code></td><td><code>' + esc(f.ddName || '—') +
          '</code></td><td>' + esc(ACCESS_LABEL[f.access]) + '</td><td>' +
          (f.verbs.length ? esc(f.verbs.slice().sort().join(', ')) : '&mdash;') + '</td><td>' +
          esc(f.organization || '—') + '</td><td>' +
          (ds.length ? ds.map(function (d) { return '<code>' + esc(d) + '</code>'; }).join('<br>') : '&mdash;') +
          '</td></tr>');
      });
      h.push('</tbody></table>');
    } else {
      h.push('<p class="demo-note">No files declared.</p>');
    }

    if (program.sql.length) {
      h.push('<h5>SQL tables</h5><table class="demo-table"><thead><tr><th>Table</th><th>Operation</th><th>Source</th></tr></thead><tbody>');
      program.sql.forEach(function (r) {
        h.push('<tr><td><code>' + esc(r.table) + '</code></td><td>' + esc(r.operation) +
          '</td><td><code>' + esc(r.source.path + ':' + r.source.line) + '</code></td></tr>');
      });
      h.push('</tbody></table>');
    }

    h.push('<h5>Programs it calls</h5>');
    if (program.calls.length) {
      h.push('<table class="demo-table"><thead><tr><th>Target</th><th>Kind</th><th>Passing</th><th>Source</th></tr></thead><tbody>');
      program.calls.forEach(function (c) {
        var isKnown = estate.programs.some(function (p) { return p.programId.toUpperCase() === c.target; });
        h.push('<tr><td><code>' + esc(c.target) + '</code>' + (!c.dynamic && !isKnown ? ' <span class="demo-warn">not supplied</span>' : '') +
          '</td><td>' + (c.dynamic ? 'dynamic' : 'static') + '</td><td>' +
          (c.using.length ? c.using.map(function (u) { return '<code>' + esc(u) + '</code>'; }).join(', ') : '&mdash;') +
          '</td><td><code>' + esc(c.source.path + ':' + c.source.line) + '</code></td></tr>');
      });
      h.push('</tbody></table>');
    } else {
      h.push('<p class="demo-note">No CALL statements.</p>');
    }

    h.push('<h5>Structure</h5>');
    if (program.paragraphs.length) {
      h.push('<p class="demo-note">' + program.paragraphs.length + ' paragraphs. Entry point: <code>' +
        esc(program.paragraphs[0].name) + '</code>.</p>');
      var orphans = xref.orphanParagraphs[pid.toUpperCase()] || [];
      if (orphans.length) {
        h.push('<p class="demo-note">Nothing performs these &mdash; dead code, or entered by fall-through: ' +
          orphans.map(function (o) { return '<code>' + esc(o) + '</code>'; }).join(', ') + '</p>');
      }
      h.push('<ul class="demo-flow">');
      program.paragraphs.forEach(function (p) {
        var uniq = p.performs.filter(function (v, i, a) { return a.indexOf(v) === i; });
        h.push('<li><code>' + esc(p.name) + '</code>' + (uniq.length ? ' &rarr; ' +
          uniq.map(function (t) { return '<code>' + esc(t) + '</code>'; }).join(', ') : '') + '</li>');
      });
      h.push('</ul>');
    } else {
      h.push('<p class="demo-note">No paragraphs found.</p>');
    }

    var layouts = program.files.filter(function (f) { return f.recordLayouts.length; });
    if (layouts.length) {
      h.push('<h5>Record layouts</h5>');
      layouts.forEach(function (f) {
        h.push('<p class="demo-note"><strong>' + esc(f.logicalName) + '</strong></p>');
        h.push('<table class="demo-table"><thead><tr><th>Lvl</th><th>Field</th><th>Picture</th><th>Notes</th></tr></thead><tbody>');
        h.push(layoutRows(f.recordLayouts, 0, []).join(''));
        h.push('</tbody></table>');
      });
    }

    return h.join('');
  }

  function renderEstate(estate, xref) {
    var h = [];
    h.push('<p class="demo-summary">' + estate.programs.length + ' program' +
      (estate.programs.length === 1 ? '' : 's') + ' &middot; ' + estate.jobs.length + ' job' +
      (estate.jobs.length === 1 ? '' : 's') + ' parsed. Every fact below was read from the source you supplied.</p>');

    if (!estate.programs.length) {
      h.push('<p class="demo-warn-block">No PROGRAM-ID found. Paste COBOL source with an IDENTIFICATION DIVISION, ' +
        'or load the sample.</p>');
      return h.join('');
    }

    estate.programs.forEach(function (p) { h.push('<div class="demo-program">' + renderProgram(p, estate, xref) + '</div>'); });

    if (xref.missingPrograms.length || xref.unresolvedDDs.length) {
      h.push('<div class="demo-program"><h4>Gaps</h4>');
      h.push('<p class="demo-note">What the supplied source does not account for. On an inherited estate this is usually the most useful part.</p>');
      if (xref.missingPrograms.length) {
        h.push('<p class="demo-note">Called but not supplied: ' +
          xref.missingPrograms.slice().sort().map(function (m) { return '<code>' + esc(m) + '</code>'; }).join(', ') + '</p>');
      }
      if (xref.unresolvedDDs.length) {
        h.push('<p class="demo-note">DD names no job supplies: ' +
          xref.unresolvedDDs.slice().sort().map(function (m) { return '<code>' + esc(m) + '</code>'; }).join(', ') + '</p>');
      }
      h.push('</div>');
    }
    return h.join('');
  }

  /* ---------- sample source ---------- */

  var SAMPLE_COBOL = [
    '000100 IDENTIFICATION DIVISION.',
    '000200 PROGRAM-ID. PAYCALC.',
    '000300 AUTHOR. PAYROLL SYSTEMS GROUP.',
    '000400 DATE-WRITTEN. 1987-03-11.',
    '000500*',
    '000600* CALCULATES GROSS AND NET PAY FOR ONE PAYROLL CYCLE.',
    '000700* DO NOT RUN OUT OF SEQUENCE - PAYWORK IS RECREATED EACH RUN.',
    '000800*',
    '000900 ENVIRONMENT DIVISION.',
    '001000 INPUT-OUTPUT SECTION.',
    '001100 FILE-CONTROL.',
    '001200     SELECT EMPLOYEE-MASTER ASSIGN TO EMPMAST',
    '001300         ORGANIZATION IS INDEXED',
    '001400         ACCESS MODE IS RANDOM',
    '001500         RECORD KEY IS EM-EMPLOYEE-ID',
    '001600         FILE STATUS IS WS-EM-STATUS.',
    '001700     SELECT TIMECARD-FILE ASSIGN TO TIMECRD',
    '001800         ORGANIZATION IS SEQUENTIAL.',
    '001900     SELECT PAY-WORK-FILE ASSIGN TO PAYWORK',
    '002000         ORGANIZATION IS SEQUENTIAL.',
    '002100 DATA DIVISION.',
    '002200 FILE SECTION.',
    '002300 FD  EMPLOYEE-MASTER.',
    '002400 01  EMPLOYEE-RECORD.',
    '002500     05  EM-EMPLOYEE-ID          PIC X(09).',
    '002600     05  EM-NAME.',
    '002700         10  EM-LAST-NAME        PIC X(20).',
    '002800         10  EM-FIRST-NAME       PIC X(15).',
    '002900     05  EM-PAY-RATE             PIC S9(05)V99 COMP-3.',
    '003000     05  EM-DEPT-CODE            PIC X(04).',
    '003100 FD  TIMECARD-FILE.',
    '003200 01  TIMECARD-RECORD.',
    '003300     05  TC-EMPLOYEE-ID          PIC X(09).',
    '003400     05  TC-REGULAR-HOURS        PIC S9(03)V99 COMP-3.',
    '003500     05  TC-OVERTIME-HOURS       PIC S9(03)V99 COMP-3.',
    '003600 FD  PAY-WORK-FILE.',
    '003700 01  PAY-WORK-RECORD.',
    '003800     05  PW-EMPLOYEE-ID          PIC X(09).',
    '003900     05  PW-GROSS-PAY            PIC S9(07)V99 COMP-3.',
    '004000     05  PW-NET-PAY              PIC S9(07)V99 COMP-3.',
    '004100 WORKING-STORAGE SECTION.',
    '004200 01  WS-EM-STATUS                PIC X(02).',
    '004300 01  WS-RECORDS-READ             PIC 9(07) COMP.',
    '004400 01  WS-GROSS                    PIC S9(07)V99 COMP-3.',
    '004500 01  WS-TAX                      PIC S9(07)V99 COMP-3.',
    '004600 01  WS-EOF-FLAG                 PIC X(01) VALUE \'N\'.',
    '004700 PROCEDURE DIVISION.',
    '004800 0000-MAIN.',
    '004900     PERFORM 1000-INITIALIZE',
    '005000     PERFORM 2000-PROCESS-TIMECARDS UNTIL WS-EOF-FLAG = \'Y\'',
    '005100     PERFORM 9000-TERMINATE',
    '005200     STOP RUN.',
    '005300 1000-INITIALIZE.',
    '005400     OPEN INPUT EMPLOYEE-MASTER TIMECARD-FILE',
    '005500     OPEN OUTPUT PAY-WORK-FILE.',
    '005600 2000-PROCESS-TIMECARDS.',
    '005700     READ TIMECARD-FILE',
    '005800         AT END MOVE \'Y\' TO WS-EOF-FLAG',
    '005900     END-READ',
    '006000     PERFORM 2100-LOOKUP-EMPLOYEE',
    '006100     PERFORM 2200-CALCULATE-GROSS',
    '006200     PERFORM 2400-WRITE-WORK-RECORD.',
    '006300 2100-LOOKUP-EMPLOYEE.',
    '006400     MOVE TC-EMPLOYEE-ID TO EM-EMPLOYEE-ID',
    '006500     READ EMPLOYEE-MASTER.',
    '006600 2200-CALCULATE-GROSS.',
    '006700     COMPUTE WS-GROSS = TC-REGULAR-HOURS * EM-PAY-RATE',
    '006800     COMPUTE WS-GROSS = WS-GROSS +',
    '006900         (TC-OVERTIME-HOURS * EM-PAY-RATE * 1.5)',
    '007000     CALL \'TAXCALC\' USING WS-GROSS WS-TAX EM-DEPT-CODE.',
    '007100 2400-WRITE-WORK-RECORD.',
    '007200     MOVE WS-GROSS TO PW-GROSS-PAY',
    '007300     WRITE PAY-WORK-RECORD.',
    '007400 8000-AUDIT-POST.',
    '007500     EXEC SQL',
    '007600         INSERT INTO PAYROLL_AUDIT (RUN_DATE, RECORDS_READ)',
    '007700         VALUES (CURRENT DATE, :WS-RECORDS-READ)',
    '007800     END-EXEC.',
    '007900 9000-TERMINATE.',
    '008000     CLOSE EMPLOYEE-MASTER TIMECARD-FILE PAY-WORK-FILE',
    '008100     CALL \'AUDITLOG\' USING WS-RECORDS-READ.'
  ].join('\n');

  var SAMPLE_JCL = [
    '//PAYRUN   JOB (ACCT),\'BIWEEKLY PAYROLL\',CLASS=A',
    '//*',
    '//* BIWEEKLY PAYROLL CYCLE - RUNS THURSDAY 02:00',
    '//*',
    '//PAYCALC  EXEC PGM=PAYCALC,REGION=4M',
    '//STEPLIB  DD DSN=PROD.PAYROLL.LOADLIB,DISP=SHR',
    '//EMPMAST  DD DSN=PROD.PAYROLL.EMPMAST,DISP=SHR',
    '//TIMECRD  DD DSN=PROD.PAYROLL.TIMECARD.EXTRACT,DISP=SHR',
    '//PAYWORK  DD DSN=PROD.PAYROLL.PAYWORK,DISP=(NEW,CATLG,DELETE),',
    '//            SPACE=(CYL,(50,10),RLSE),UNIT=SYSDA',
    '//SYSOUT   DD SYSOUT=*'
  ].join('\n');

  /* ---------- public API ---------- */

  function analyse(cobolText, jclText) {
    var estate = { programs: [], jobs: [] };
    if (cobolText && cobolText.trim()) {
      var program = parseProgram('pasted.cbl', cobolText);
      if (program.programId) estate.programs.push(program);
    }
    if (jclText && jclText.trim()) estate.jobs.push(parseJob('pasted.jcl', jclText));
    return { estate: estate, xref: buildCrossref(estate) };
  }

  window.EstatemapDemo = {
    parseProgram: parseProgram,
    parseJob: parseJob,
    buildCrossref: buildCrossref,
    analyse: analyse,
    render: renderEstate,
    SAMPLE_COBOL: SAMPLE_COBOL,
    SAMPLE_JCL: SAMPLE_JCL,

    mount: function (root) {
      root.innerHTML =
        '<div class="demo-grid">' +
        '  <div class="demo-pane"><label for="demo-cobol">COBOL source</label>' +
        '    <textarea id="demo-cobol" spellcheck="false" rows="14"></textarea></div>' +
        '  <div class="demo-pane"><label for="demo-jcl">JCL <span class="opt">(optional)</span></label>' +
        '    <textarea id="demo-jcl" spellcheck="false" rows="14"></textarea></div>' +
        '</div>' +
        '<div class="demo-actions">' +
        '  <button type="button" class="btn" id="demo-run">Generate documentation</button>' +
        '  <button type="button" class="btn btn--quiet" id="demo-sample">Load sample</button>' +
        '  <button type="button" class="btn btn--quiet" id="demo-clear">Clear</button>' +
        '</div>' +
        '<div id="demo-output" class="demo-output" role="region" aria-live="polite" aria-label="Generated documentation"></div>';

      var cobol = root.querySelector('#demo-cobol');
      var jcl = root.querySelector('#demo-jcl');
      var out = root.querySelector('#demo-output');

      function run() {
        var result = analyse(cobol.value, jcl.value);
        out.innerHTML = renderEstate(result.estate, result.xref);
      }
      function loadSample() {
        cobol.value = SAMPLE_COBOL;
        jcl.value = SAMPLE_JCL;
        run();
      }

      root.querySelector('#demo-run').addEventListener('click', run);
      root.querySelector('#demo-sample').addEventListener('click', loadSample);
      root.querySelector('#demo-clear').addEventListener('click', function () {
        cobol.value = ''; jcl.value = ''; out.innerHTML = '';
        cobol.focus();
      });

      loadSample();
    }
  };
})();

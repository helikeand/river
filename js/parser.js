var Parser = (function() {

  // ====== 工具函数 ======
  function makeQA(questionText, answerRaw, sourceName, optionsArray) {
    return {
      question: questionText.trim(),
      answer: normalizeAnswer(answerRaw),
      type: optionsArray && optionsArray.some(function(o) { return o.trim(); }) ? 'choice' : guessType(answerRaw),
      options: optionsArray || null,
      source: sourceName
    };
  }

  function normalizeAnswer(raw) {
    var t = raw.trim();
    if (/对|正确|√|✓|true|yes/i.test(t)) return '√';
    if (/错|错误|×|✗|false|no/i.test(t)) return '×';
    if (/^[A-D]$/i.test(t)) return t.toUpperCase();
    return t;
  }

  function guessType(answer) {
    var t = answer.trim();
    if (/[√×对错正确错误]/.test(t)) return 'truefalse';
    if (/^[A-D]$/i.test(t)) return 'choice';
    return 'unknown';
  }

  // ====== 平台题库（数字编号选项）格式检测 ======
  var PLATFORM_OPTION_HEADER_RE = /^选项\s*([1-6])$/;

  function detectPlatformFormat(rows) {
    var limit = Math.min(5, rows.length);
    for (var r = 0; r < limit; r++) {
      var row = rows[r];
      var qCol = -1, aCol = -1, optionCols = {};
      for (var c = 0; c < row.length; c++) {
        var h = String(row[c] || '').trim();
        if (/问题内容/.test(h) && qCol === -1) qCol = c;
        if (/答案|answer|正确/.test(h) && aCol === -1) aCol = c;
        var m = PLATFORM_OPTION_HEADER_RE.exec(h);
        if (m) optionCols[m[1]] = c;
      }
      if (qCol !== -1 && aCol !== -1 && Object.keys(optionCols).length >= 1) {
        return { headerRowIndex: r, qCol: qCol, aCol: aCol, optionCols: optionCols };
      }
    }
    return null;
  }

  var ANSWER_REFS_RE = /^选项\s*([1-6])(?:\s*[/、，,]\s*([1-6]))*$/;

  function cleanText(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  // 取一行的非空选项文字（按 1→6 顺序）
  function buildOptions(row, header) {
    var opts = [];
    for (var n = 1; n <= 6; n++) {
      var colIdx = header.optionCols[String(n)];
      if (colIdx === undefined) continue;
      var text = cleanText(row[colIdx]);
      if (text) opts.push(text);
    }
    return opts;
  }

  function parsePlatformRows(rows, header, sourceName) {
    var results = [];
    var startRow = header.headerRowIndex + 1;
    for (var r = startRow; r < rows.length; r++) {
      var row = rows[r];
      var question = cleanText(row[header.qCol]);
      if (!question) continue;

      var answerRaw = cleanText(row[header.aCol]);
      if (!answerRaw) continue;

      // 是非题：对/错 → √/×（走 makeQA 的 normalizeAnswer/guessType）
      if (/^(对|正确|√|✓|true|yes|错|错误|×|✗|false|no)$/i.test(answerRaw)) {
        results.push(makeQA(question, answerRaw, sourceName));
        continue;
      }

      // 选择题：选项N 或 选项1/2/3
      var refs = ANSWER_REFS_RE.exec(answerRaw);
      if (refs) {
        // exec 的 match 数组对重复捕获组只保留最后一次捕获且长度固定，
        // 必须用 split 提取全部序号；ANSWER_REFS_RE 仅做形状校验
        var nums = answerRaw.replace(/^选项\s*/, '').split(/\s*[/、，,]\s*/)
          .filter(function(n) { return /^[1-6]$/.test(n); });
        var texts = [];
        var allResolved = true;
        for (var i = 0; i < nums.length; i++) {
          var colIdx = header.optionCols[nums[i]];
          var text = (colIdx !== undefined) ? cleanText(row[colIdx]) : '';
          if (text) {
            texts.push(text);
          } else {
            allResolved = false;
          }
        }
        if (allResolved && texts.length > 0) {
          // 文字答案不经过 normalizeAnswer，避免选项文字被误转 √×
          results.push({
            question: question,
            answer: texts.join('\n'),
            type: 'choice',
            options: buildOptions(row, header),
            source: sourceName
          });
          continue;
        }
        // 兜底：引用的选项文字缺失，保留原始答案字符串
        results.push(makeQA(question, answerRaw, sourceName));
        continue;
      }

      // 其他答案格式原样保留
      results.push(makeQA(question, answerRaw, sourceName, buildOptions(row, header)));
    }
    return results;
  }

  // ====== 通用文本解析（Word/PDF 等） ======
  function parseTextToQA(text, sourceName) {
    var lines = text.split(/\n/).map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 5; });
    var results = [];

    function isMarkedAnswerLine(line) {
      return /^[A-D][、\.\)]\s*.+[（(]\s*(?:正确|答案|√|对|正确选项|正确答案|true|yes|✅)\s*[）)]/i.test(line);
    }

    function extractOptionLetter(line) {
      var m = /^([A-D])[、\.\)]/.exec(line);
      return m ? m[1] : null;
    }

    function isOptionOnlyLine(line) {
      return /^[A-D][、\.\)]/.test(line) && !isMarkedAnswerLine(line);
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      // 模式1：题目：xxx 答案：A
      var m1 = /题目[：:]\s*(.+?)\s*答案[：:]\s*([A-D√×对错正确错误]+)/i.exec(line);
      if (m1) {
        results.push(makeQA(m1[1], m1[2], sourceName));
        continue;
      }

      // 模式2：题干（A） 行末括号
      var m2 = /(.+?)[（(]\s*([A-Da-d])\s*[）)]\s*$/.exec(line);
      if (m2 && !isOptionOnlyLine(line)) {
        var q = m2[1].replace(/^\s*\d+[\.、\)]\s*/, '').trim();
        results.push(makeQA(q, m2[2], sourceName));
        continue;
      }

      // 模式2b（旧格式恢复）：N. 题干 A（行末裸答案标记，无括号）
      var m2b = /^\s*(\d+)[\.、\)]\s*(.+?)\s+([A-D√×对错正确错误])\s*$/.exec(line);
      if (m2b) {
        results.push(makeQA(m2b[1] + '. ' + m2b[2].trim(), m2b[3], sourceName));
        continue;
      }

      // 模式4+5：标注正确选项的行
      if (isMarkedAnswerLine(line)) {
        var letter = extractOptionLetter(line);
        if (letter) {
          var prevLine = (i > 0 && !isOptionOnlyLine(lines[i-1])) ? lines[i-1] : '';
          var question = prevLine.replace(/^\s*\d+[\.、\)]\s*/, '').trim() || ('第' + (results.length + 1) + '题');
          results.push(makeQA(question, letter, sourceName));
          continue;
        }
      }

      // 模式5：数字开头题目，下一行是标记行
      var m5 = /^\s*(\d+)[\.、\)]\s*(.+)$/.exec(line);
      if (m5 && i + 1 < lines.length) {
        var nextLine = lines[i + 1];
        if (isMarkedAnswerLine(nextLine)) {
          var letter2 = extractOptionLetter(nextLine);
          if (letter2) {
            results.push(makeQA(m5[1] + '. ' + m5[2].trim(), letter2, sourceName));
            i++;
            continue;
          }
        }
      }
    }

    // 兜底：纯答案序列
    if (results.length === 0) {
      for (var j = 0; j < lines.length; j++) {
        var m6 = /^\s*(\d+)\s*[\.、\)]\s*([A-Da-d√×对错正确错误])\s*$/.exec(lines[j]);
        if (m6) {
          results.push(makeQA('第' + m6[1] + '题', m6[2], sourceName));
        }
      }
    }

    return results;
  }

  // ====== Word (.docx) ======
  async function parseDocx(file) {
    var arrayBuffer = await file.arrayBuffer();
    var result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
    return parseTextToQA(result.value, file.name);
  }

  // ====== PDF ======
  async function parsePdf(file) {
    var arrayBuffer = await file.arrayBuffer();
    var pdfData = new Uint8Array(arrayBuffer);
    var loadingTask = pdfjsLib.getDocument({ data: pdfData });
    var pdf = await loadingTask.promise;
    var fullText = '';
    for (var i = 1; i <= pdf.numPages; i++) {
      var page = await pdf.getPage(i);
      var content = await page.getTextContent();
      var pageText = content.items.map(function(item) { return item.str; }).join(' ');
      fullText += pageText + '\n';
    }
    return parseTextToQA(fullText, file.name);
  }

  // ====== Excel (.xlsx/.xls) 增强版 ======
  async function parseExcel(file) {
    var arrayBuffer = await file.arrayBuffer();
    var workbook = XLSX.read(arrayBuffer, { type: 'array' });
    var firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    var rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

    if (rows.length === 0) return [];

    // 平台新格式（数字编号选项）优先分派，未命中走原逻辑
    var platformHeader = detectPlatformFormat(rows);
    if (platformHeader) {
      return parsePlatformRows(rows, platformHeader, file.name);
    }

    var headerRowIndex = -1;
    var qCol = -1, aCol = -1;
    var optionCols = {};

    for (var r = 0; r < Math.min(5, rows.length); r++) {
      var row = rows[r];
      for (var c = 0; c < row.length; c++) {
        var h = String(row[c] || '').trim();
        if (/题目|问题|question|题干|试题/.test(h) && qCol === -1) qCol = c;
        if (/答案|answer|正确/.test(h) && aCol === -1) aCol = c;
        var optMatch = h.match(/选项\s*([A-H])/i);
        if (optMatch) {
          var letter = optMatch[1].toUpperCase();
          if (!(letter in optionCols)) optionCols[letter] = c;
        }
      }
      if (qCol !== -1 || aCol !== -1 || Object.keys(optionCols).length > 0) {
        headerRowIndex = r;
        break;
      }
    }

    if (qCol === -1) qCol = 0;
    if (aCol === -1) aCol = 1;

    var startRow = headerRowIndex >= 0 ? headerRowIndex + 1 : 0;
    var dataRows = rows.slice(startRow);

    return dataRows
      .filter(function(row) { return row[qCol] && String(row[qCol]).trim().length > 1; })
      .map(function(row) {
        var options = Array(8).fill('');
        for (var letter in optionCols) {
          var idx = letter.charCodeAt(0) - 65;
          var colIdx = optionCols[letter];
          var val = row[colIdx] ? String(row[colIdx]).trim() : '';
          options[idx] = val;
        }
        return makeQA(
          String(row[qCol]).trim(),
          String(row[aCol] || '').trim(),
          file.name,
          options
        );
      });
  }

  // ====== JSON (.json) ======
  async function parseJson(file) {
    var text = await file.text();
    var data = JSON.parse(text);
    var questions = [];

    // 支持两种格式：{ questions: [...] } 或纯数组 [...]
    var list = Array.isArray(data) ? data : (data.questions || []);
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (item.question && item.answer !== undefined) {
        questions.push(makeQA(
          item.question,
          item.answer,
          item.source || file.name,
          item.options || null
        ));
      }
    }
    return questions;
  }

  // ====== 主入口 ======
  async function parseFile(file) {
    var ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'docx') return parseDocx(file);
    if (ext === 'pdf') return parsePdf(file);
    if (ext === 'xlsx' || ext === 'xls') return parseExcel(file);
    if (ext === 'json') return parseJson(file);
    throw new Error('不支持的文件格式: .' + ext);
  }

  return {
    parseFile: parseFile,
    parseTextToQA: parseTextToQA,
    _detectPlatformFormat: detectPlatformFormat,
    _parsePlatformRows: parsePlatformRows
  };

})();
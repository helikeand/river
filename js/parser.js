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

  // ====== 通用文本解析（Word/PDF 等） ======
  function parseTextToQA(text, sourceName) {
    var lines = text.split(/\n/).map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
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
        var m6 = /^\s*(\d+)\s*[\.、\)]\s*([A-Da-d√×对错正确错误])/.exec(lines[j]);
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

    if (headerRowIndex === -1) {
      qCol = 0;
      aCol = 1;
    }

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
    parseTextToQA: parseTextToQA
  };

})();
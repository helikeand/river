var Parser = (function() {

  // ====== 通用：从文本中解析题目-答案对 ======
  function parseTextToQA(text, sourceName) {
    var lines = text.split(/\n/).map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
    var results = [];

    // 通用模式：在任意位置找到括号中的答案字母 (A-D) 或 √×
    // 匹配 "...（A）..." 或 "...(A)..." 或 "...答案 A..." 等

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var matched = false;

      // ---- 模式1: 题目：xxx 答案：A ----
      var m1 = /题目[：:]\s*(.+?)\s*答案[：:]\s*([A-D√×对错正确错误]+)/i.exec(line);
      if (m1) {
        results.push(makeQA(m1[1], m1[2], sourceName));
        matched = true;
        continue;
      }

      // ---- 模式2: xxx（A）或 xxx(A) — 行末括号含答案 ----
      var m2 = /(.+?)[（(]\s*([A-Da-d])\s*[）)]\s*$/.exec(line);
      if (m2) {
        var q = m2[1].replace(/^\s*\d+[\.、\)]\s*/, '').trim();
        results.push(makeQA(q, m2[2], sourceName));
        matched = true;
        continue;
      }

      // ---- 模式3: "1. xxx  A. xxx  B. xxx  C. xxx" 选项混排行，跳过 ----
      // 这种行通常包含多个选项，不是题目行

      // ---- 模式4: "A、今天（正确答案）" 或 "A、今天（正确）" — 标注了正确答案的选项 ----
      var m4 = /^([A-D])[、\.\)]\s*.+?[（(]\s*(?:正确|答案|√|对)\s*[）)]/.exec(line);
      if (m4) {
        var prevLine = i > 0 ? lines[i - 1] : '';
        results.push(makeQA(prevLine || ('第' + (results.length + 1) + '题'), m4[1], sourceName));
        matched = true;
        continue;
      }

      // ---- 模式5: "1. 题干文字" 后面跟着选项行 ----
      // 如果当前行以数字开头且没有括号答案，检查下一行是否有选项
      var m5 = /^\s*(\d+)[\.、\)]\s*(.+)$/.exec(line);
      if (m5) {
        var nextLine = i < lines.length - 1 ? lines[i + 1] : '';
        // 下一行是否包含 "(正确答案)"
        var nextM = /^([A-D])[、\.\)]\s*.+?[（(]\s*(?:正确|答案|√|对)\s*[）)]/.exec(nextLine);
        if (nextM) {
          results.push(makeQA(m5[1] + '. ' + m5[2].trim(), nextM[1], sourceName));
          i++; // 跳过下一行
          matched = true;
          continue;
        }
      }
    }

    // ---- 兜底：纯答案序列 "1.A  2.B  3.C" ----
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

  function makeQA(questionText, answerRaw, sourceName) {
    return {
      question: questionText.trim(),
      answer: normalizeAnswer(answerRaw),
      type: guessType(answerRaw),
      options: null,
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

  // ====== Word (.docx) ======
  async function parseDocx(file) {
    var arrayBuffer = await file.arrayBuffer();
    var result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
    // 调试：在控制台输出提取的原始文本
    console.log('=== Word 提取文本（前500字）===');
    console.log(result.value.substring(0, 500));
    console.log('=== 提取结束 ===');
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

  // ====== Excel (.xlsx/.xls) ======
  async function parseExcel(file) {
    var arrayBuffer = await file.arrayBuffer();
    var workbook = XLSX.read(arrayBuffer, { type: 'array' });
    var firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    var rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

    var headerRow = rows[0] || [];
    var qCol = -1, aCol = -1;
    for (var i = 0; i < headerRow.length; i++) {
      var h = String(headerRow[i] || '').toLowerCase();
      if (/题目|问题|question|题干|试题/.test(h) && qCol === -1) qCol = i;
      if (/答案|answer|正确/.test(h) && aCol === -1) aCol = i;
    }
    if (qCol === -1) qCol = 0;
    if (aCol === -1) aCol = 1;

    var startRow = (headerRow.length > 0 && /题目|答案/.test(String(headerRow[0]))) ? 1 : 0;
    var dataRows = rows.slice(startRow);

    return dataRows
      .filter(function(row) { return row[qCol] && String(row[qCol]).trim().length > 1; })
      .map(function(row) {
        return makeQA(String(row[qCol]).trim(), String(row[aCol] || '').trim(), file.name);
      });
  }

  // ====== 主入口：根据文件类型分发 ======
  async function parseFile(file) {
    var ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'docx') return parseDocx(file);
    if (ext === 'pdf') return parsePdf(file);
    if (ext === 'xlsx' || ext === 'xls') return parseExcel(file);
    throw new Error('不支持的文件格式: .' + ext);
  }

  return {
    parseFile: parseFile,
    parseTextToQA: parseTextToQA
  };
})();

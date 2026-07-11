function parseTextToQA(text, sourceName) {
  var lines = text.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
  var results = [];

  // 判断一行是否为“标注了正确答案的选项”
  function isMarkedAnswerLine(line) {
    // 匹配: A、xxx（正确答案） 或 A. xxx（正确）等
    return /^[A-D][、\.\)]\s*.+[（(]\s*(?:正确|答案|√|对|正确选项|正确答案|true|yes|✅)\s*[）)]/i.test(line);
  }

  // 从标记行提取选项字母
  function extractOptionLetter(line) {
    var m = /^([A-D])[、\.\)]/.exec(line);
    return m ? m[1] : null;
  }

  // 是否看起来像纯选项行（A、xxx 但没有答案标注）
  function isOptionOnlyLine(line) {
    return /^[A-D][、\.\)]/.test(line) && !isMarkedAnswerLine(line);
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var matched = false;

    // 模式1：题目：xxx 答案：A （同一行）
    var m1 = /题目[：:]\s*(.+?)\s*答案[：:]\s*([A-D√×对错正确错误]+)/i.exec(line);
    if (m1) {
      results.push(makeQA(m1[1], m1[2], sourceName));
      continue;
    }

    // 模式2：题干……（A） 行末括号含单个字母
    var m2 = /(.+?)[（(]\s*([A-Da-d])\s*[）)]\s*$/.exec(line);
    if (m2 && !isOptionOnlyLine(line)) {
      var q = m2[1].replace(/^\s*\d+[\.、\)]\s*/, '').trim();
      results.push(makeQA(q, m2[2], sourceName));
      continue;
    }

    // 模式4+5 合并：标记行直接作为答案，或者下一行是标记行
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
          i++; // 跳过下一行
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

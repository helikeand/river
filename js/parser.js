var Parser = (function() {

  // ====== 通用：从文本中解析题目-答案对 ======
  function parseTextToQA(text, sourceName) {
    var lines = text.split(/\n/).map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 5; });
    var results = [];

    // 策略1: "题目：xxx 答案：A" 格式
    var pattern1 = /题目[：:]\s*(.+?)\s*答案[：:]\s*([A-D√×对错正确错误]+)/i;
    // 策略2: "1. xxx  A. xxx  B. xxx" 题号+选项格式 (末尾的字母视为答案)
    var pattern2 = /^\s*(\d+)[\.、\)]\s*(.+?)\s+([A-D√×对错正确错误])\s*$/;
    // 策略3: "1.A  2.B  3.C" 纯答案序列
    var pattern3 = /^\s*(\d+)\s*[\.、\)]\s*([A-D√×对错正确错误])\s*$/;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      // 尝试策略1
      var m = line.match(pattern1);
      if (m) {
        results.push({
          question: m[1].trim(),
          answer: normalizeAnswer(m[2].trim()),
          type: guessType(m[2].trim()),
          options: null
        });
        continue;
      }

      // 尝试策略2
      m = line.match(pattern2);
      if (m) {
        results.push({
          question: m[1] + '. ' + m[2].trim(),
          answer: normalizeAnswer(m[3].trim()),
          type: guessType(m[3].trim()),
          options: null
        });
        continue;
      }
    }

    // 如果以上都没匹配到，尝试策略3：检测纯答案序列
    if (results.length === 0) {
      for (var j = 0; j < lines.length; j++) {
        var m3 = lines[j].match(pattern3);
        if (m3) {
          results.push({
            question: '第' + m3[1] + '题',
            answer: normalizeAnswer(m3[2].trim()),
            type: guessType(m3[2].trim()),
            options: null
          });
        }
      }
    }

    // 附加来源
    for (var k = 0; k < results.length; k++) {
      results[k].source = sourceName;
    }
    return results;
  }

  function normalizeAnswer(raw) {
    var t = raw.trim();
    if (/对|正确|√|✓|true|yes/i.test(t)) return '√';
    if (/错|错误|×|✗|false|no/i.test(t)) return '×';
    if (/^[A-Da-d]$/.test(t)) return t.toUpperCase();
    return t;
  }

  function guessType(answer) {
    var t = answer.trim();
    if (/[√×对错正确错误]/.test(t)) return 'truefalse';
    if (/^[A-Da-d]$/.test(t)) return 'choice';
    return 'unknown';
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

  // ====== Excel (.xlsx/.xls) ======
  async function parseExcel(file) {
    var arrayBuffer = await file.arrayBuffer();
    var workbook = XLSX.read(arrayBuffer, { type: 'array' });
    var firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    var rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

    // 尝试自动识别题目列和答案列
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
        return {
          question: String(row[qCol]).trim(),
          answer: normalizeAnswer(String(row[aCol] || '').trim()),
          type: guessType(String(row[aCol] || '')),
          options: null,
          source: file.name
        };
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

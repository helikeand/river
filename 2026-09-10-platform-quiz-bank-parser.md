# 平台题库（调试八十四期）识别方法 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让答题助手能识别"调试八十四期"平台题库 xlsx（答案列为"选项N"，选项列为数字编号），并把答案解析成选项原文文字。

**Architecture:** 在 parser.js 中新增表头指纹检测（`选项1`~`选项6` 数字编号列）和独立行解析函数，parseExcel 命中指纹时分派到新路径；旧解析逻辑一字不动。纯 ES5 风格（var/function，与 parser.js 现有代码一致）。Node vm 沙箱加载浏览器版 XLSX + parser.js 做端到端测试。

**Tech Stack:** 浏览器 PWA（原生 JS ES5）、SheetJS xlsx.full.min.js（浏览器 bundle）、Node 24（仅测试脚本）。

**Spec:** [2026-09-10-platform-quiz-bank-parser-design.md](../specs/2026-09-10-platform-quiz-bank-parser-design.md)

## Global Constraints

- 答案存**纯选项原文文字**，不存序号；多选答案用 `\n`（换行）分隔；是非题答案为 `√`/`×`
- `题目解读标题`/`题目解读内容` 两列忽略不存
- 引用的选项文字为空时，兜底保留原始答案字符串（如"选项2"），不丢数据
- 旧格式解析行为零改动：parseExcel 原有代码路径不动，仅在其入口处加分派
- parser.js 全部新代码用 ES5 语法（无 const/let/箭头函数/模板字符串），与现有代码风格一致
- 新格式检测阈值：表头行 ≥1 个精确匹配 `^选项\s*[1-6]$` 的列
- ⚠️ pwa/js/parser.js 在工作区有用户未提交的改动（相对 HEAD +145/-73 行）。所有编辑基于**当前工作区版本**，禁止 git reset/checkout/stash
- 工作目录：d:\AI\vscode\program（本仓库还有其他未提交文件，提交时只 add 本计划涉及的文件）

---

### Task 1: 测试脚手架 + 表头指纹检测 detectPlatformFormat

**Files:**
- Create: `tools/test_parser_platform.js`（vm 沙箱测试脚手架）
- Modify: `pwa/js/parser.js`（新增 `PLATFORM_OPTION_HEADER_RE`、`detectPlatformFormat`，并在返回对象中暴露 `_detectPlatformFormat`、`_parsePlatformRows`）

**Interfaces:**
- Produces:
  - `Parser._detectPlatformFormat(rows)` → `null` 或 `{headerRowIndex:number, qCol:number, aCol:number, optionCols:object}`（optionCols 的 key 是选项序号字符串 "1"~"6"，value 是列索引）
  - `Parser._parsePlatformRows(rows, header, sourceName)` → QA 对象数组（Task 2 实现）
  - `tools/test_parser_platform.js`：`node tools/test_parser_platform.js` 运行，失败时 exit code 1

- [ ] **Step 1: 写测试脚手架 tools/test_parser_platform.js**

```js
// Node 测试：vm 沙箱加载浏览器版 XLSX + parser.js，验证平台题库解析
// 用法：node tools/test_parser_platform.js [新题库xlsx] [旧题库xlsx]
var fs = require('fs');
var vm = require('vm');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var NEW_BANK = process.argv[2] || path.join(ROOT, '调试八十四期题库.xlsx');
var OLD_BANK = process.argv[3] || path.join(ROOT, '2026-07-11 16_56_52拍照录题.xlsx');
var failures = [];
function assert(cond, msg) {
  if (cond) { console.log('  PASS: ' + msg); }
  else { failures.push(msg); console.error('  FAIL: ' + msg); }
}

var sandbox = { console: console };
sandbox.window = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'pwa/libs/xlsx.full.min.js'), 'utf8'), sandbox, { filename: 'xlsx.full.min.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'pwa/js/parser.js'), 'utf8'), sandbox, { filename: 'parser.js' });
var XLSX = sandbox.XLSX;
var Parser = sandbox.Parser;

// 测试用 File stub：名字 + arrayBuffer
// 注意：ArrayBuffer 必须建在 vm 沙箱 realm 内；跨 realm 的 ArrayBuffer
// 会导致沙箱内 XLSX.read 抛 RangeError: Invalid array length
function fileStub(filePath) {
  var bytes = Uint8Array.from(fs.readFileSync(filePath)); // Node realm
  var mkStub = vm.runInContext('(function(name, bytes) { var u8 = new Uint8Array(bytes); return { name: name, arrayBuffer: function() { return Promise.resolve(u8.buffer); } }; })', sandbox);
  return mkStub(path.basename(filePath), bytes);
}

// 从真实 xlsx 读 rows（供单元测试与端到端测试共用）
function readRows(filePath) {
  var wb = XLSX.read(fs.readFileSync(filePath), { type: 'buffer' });
  var ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1 });
}

// 全部测试包在 async main 中：CJS 不允许顶层 await
(async function main() {

// ================= 测试从这里开始 =================

// ---- Task 1 测试：detectPlatformFormat ----
var newHeader = ['题目类型', '题目标签', '答题时间（秒）', '问题内容', '答案', '选项随机排序', '选项1', '选项2', '选项3', '选项4', '选项5', '选项6', '题目解读标题', '题目解读内容'];
var det = Parser._detectPlatformFormat([newHeader]);
assert(det !== null, '新格式表头被检测到');
assert(det.headerRowIndex === 0, '表头行号 = 0');
assert(det.qCol === 3 && det.aCol === 4, '问题列=3，答案列=4');
assert(det.optionCols['1'] === 6 && det.optionCols['2'] === 7 && det.optionCols['6'] === 11, '选项1~6 列映射正确');

var oldHeader = ['题干（必填）', '题型 （必填）', '选项 A', '选项 B', '选项 C', '选项 D', '选项E\n(勿删)', '选项F\n(勿删)', '选项G\n(勿删)', '选项H\n(勿删)', '正确答案\n（必填）', '解析\n（勿删）', '章节\n（勿删）', '难度'];
assert(Parser._detectPlatformFormat([oldHeader]) === null, '旧格式表头（字母编号选项）不被误判');

// ================= 汇总 =================
console.log(failures.length === 0 ? 'ALL PASS' : failures.length + ' FAILURES');
process.exit(failures.length === 0 ? 0 : 1);

})().catch(function(e) { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tools/test_parser_platform.js`
Expected: FAIL，报 `Parser._detectPlatformFormat is not a function`

- [ ] **Step 3: 在 parser.js 实现 detectPlatformFormat**

在 [pwa/js/parser.js](../../pwa/js/parser.js) 的"工具函数"区（`guessType` 之后、"通用文本解析"之前）插入：

```js
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
```

并把文件末尾的返回对象改为：

```js
  return {
    parseFile: parseFile,
    parseTextToQA: parseTextToQA,
    _detectPlatformFormat: detectPlatformFormat,
    _parsePlatformRows: parsePlatformRows
  };
```

（`parsePlatformRows` 在 Task 2 实现，本步骤先声明占位：在 `detectPlatformFormat` 之后加 `function parsePlatformRows() { return []; }`）

- [ ] **Step 4: 运行测试确认通过**

Run: `node tools/test_parser_platform.js`
Expected: 检测相关断言全部 PASS，`ALL PASS`

- [ ] **Step 5: Commit**

```bash
git add tools/test_parser_platform.js pwa/js/parser.js
git commit -m "feat: detect platform quiz bank header (numeric option columns)"
```

---

### Task 2: parsePlatformRows 行解析（选项N → 原文文字）

**Files:**
- Modify: `pwa/js/parser.js`（实现 `cleanText`、`ANSWER_REFS_RE`、`parsePlatformRows`、`buildOptions`，替换 Task 1 的占位函数）
- Modify: `tools/test_parser_platform.js`（新增 Task 2 测试）

**Interfaces:**
- Consumes: `Parser._detectPlatformFormat`（Task 1）、测试脚手架的 `readRows`
- Produces: `Parser._parsePlatformRows(rows, header, sourceName)` → QA 数组，QA 形状与 makeQA 一致：`{question, answer, type, options, source}`；选择题 `answer` 为选项原文（多选 `\n` 分隔）、`type:'choice'`、`options` 为非空选项文字数组（按 1→6 顺序）；是非题 `answer:'√'/'×'`、`type:'truefalse'`、`options:null`

- [ ] **Step 1: 写 Task 2 测试（追加到 tools/test_parser_platform.js 的"测试从这里开始"之后、"汇总"块之前）**

```js
// ---- Task 2 测试：parsePlatformRows ----
// 用真实题库的前几行（含换行、尾随空格等脏数据）
var bankRows = readRows(NEW_BANK);
var header = Parser._detectPlatformFormat(bankRows.slice(0, 5));
var qas = Parser._parsePlatformRows(bankRows, header, '调试八十四期题库.xlsx');
assert(qas.length === 68, '68 道题全部解析（实际 ' + qas.length + '）');
assert(qas.every(function(q) { return !/选项/.test(q.answer); }), '无任何答案残留"选项N"字样');

// 单选：施工现场发现防护缺失... → 立即停止作业并上报
var q1 = qas.filter(function(q) { return q.question.indexOf('施工现场发现防护缺失') === 0; })[0];
assert(q1 && q1.answer === '立即停止作业并上报', '单选答案 = 选项原文文字（实际: ' + (q1 && q1.answer) + '）');
assert(q1 && q1.type === 'choice', '单选 type=choice');

// 多选：安全防护设施拆除原则 → 三个文字换行分隔
var q7 = qas.filter(function(q) { return q.question.indexOf('安全防护设施拆除原则') === 0; })[0];
assert(q7 && q7.answer === '严禁私自拆除\n确需拆除必须审批\n施工结束立即恢复', '多选答案换行分隔（实际: ' + JSON.stringify(q7 && q7.answer) + '）');

// 是非题：对 → √，错 → ×
var q9 = qas.filter(function(q) { return q.question === '安全防护设施是保命设施，严禁随意拆除。'; })[0];
assert(q9 && q9.answer === '√' && q9.type === 'truefalse', '是非题"对"→√、type=truefalse');
var q10 = qas.filter(function(q) { return q.question === '洞口盖板只要盖上就行，无需固定。'; })[0];
assert(q10 && q10.answer === '×', '是非题"错"→×');

// 选项文字清洗：折叠单元格内换行、去首尾空格
var q4 = qas.filter(function(q) { return q.question.indexOf('当非垂直洞口短边长大于或等于') === 0; })[0];
assert(q4 && q4.answer === '1.2m', '单元格尾随空格被清洗（实际: ' + JSON.stringify(q4 && q4.answer) + '）');
var q50 = qas.filter(function(q) { return q.question.indexOf('根据《中国核工业集团有限公司安全技术交底指导意见》') === 0; })[0];
assert(q50 && q50.options[0].indexOf('\r') === -1 && q50.options[0].indexOf('\n') === -1, '选项文字内换行被折叠为空格');

// 分类计数：56 选择题 + 12 是非题
var choiceCount = qas.filter(function(q) { return q.type === 'choice'; }).length;
var tfCount = qas.filter(function(q) { return q.type === 'truefalse'; }).length;
assert(choiceCount === 56 && tfCount === 12, '类型计数 56/12（实际 ' + choiceCount + '/' + tfCount + '）');

// 兜底：引用的选项文字为空时保留原始"选项N"
var fakeRows = [
  ['题目类型', '题目标签', '答题时间（秒）', '问题内容', '答案', '选项随机排序', '选项1', '选项2'],
  ['选择题', 't', '60', '某问题（）', '选项2', '是', '只有一个选项', '']
];
var fakeHeader = Parser._detectPlatformFormat(fakeRows.slice(0, 5));
var fakeQas = Parser._parsePlatformRows(fakeRows, fakeHeader, 'fake.xlsx');
var fakeAns = fakeQas.length === 1 ? fakeQas[0].answer : '(无结果)';
assert(fakeQas.length === 1 && fakeQas[0].answer === '选项2', '空选项兜底保留原始答案（实际: ' + fakeAns + '）');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tools/test_parser_platform.js`
Expected: Task 2 断言 FAIL（`parsePlatformRows` 还是占位空函数，返回 `[]`）

- [ ] **Step 3: 实现 cleanText / ANSWER_REFS_RE / parsePlatformRows / buildOptions**

在 parser.js 中替换 Task 1 的占位 `function parsePlatformRows() { return []; }`，并在其上方加 `ANSWER_REFS_RE` 与 `cleanText`：

```js
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node tools/test_parser_platform.js`
Expected: `ALL PASS`（Task 1 + Task 2 全部断言通过）

- [ ] **Step 5: Commit**

```bash
git add tools/test_parser_platform.js pwa/js/parser.js
git commit -m "feat: parse platform quiz bank rows into option text answers"
```

---

### Task 3: parseExcel 分派 + 端到端测试 + 旧格式回归

**Files:**
- Modify: `pwa/js/parser.js`（parseExcel 入口处分派）
- Modify: `tools/test_parser_platform.js`（新增端到端与回归测试）

**Interfaces:**
- Consumes: `detectPlatformFormat`、`parsePlatformRows`（Task 1/2）
- Produces: `Parser.parseFile(xlsxFile)` 对新格式自动走新路径，旧格式行为不变

- [ ] **Step 1: 写 Task 3 测试（追加到 tools/test_parser_platform.js 的"汇总"块之前；此时代码已在 async main 内，可直接用 await）**

```js
// ---- Task 3 测试：parseFile 端到端 + 旧格式回归 ----
// 端到端：真实新题库文件
var bankQas = await Parser.parseFile(fileStub(NEW_BANK));
assert(bankQas.length === 68, '端到端解析 68 题（实际 ' + bankQas.length + '）');
assert(bankQas.every(function(q) { return !/选项/.test(q.answer); }), '端到端无"选项N"残留');
var e2eQ1 = bankQas.filter(function(q) { return q.question.indexOf('施工现场发现防护缺失') === 0; })[0];
assert(e2eQ1 && e2eQ1.answer === '立即停止作业并上报', '端到端单选答案正确');

// 回归：旧格式题库（拍照录题.xlsx），答案仍是字母，行为与改动前一致
var oldQas = await Parser.parseFile(fileStub(OLD_BANK));
assert(oldQas.length > 0, '旧格式题库仍能解析（实际 ' + oldQas.length + ' 题）');
assert(oldQas.every(function(q) { return !/选项/.test(q.answer); }), '旧格式无文字答案污染');
var oldQ1 = oldQas.length > 0 ? oldQas[0] : null;
assert(oldQ1 && oldQ1.answer === 'B' && oldQ1.type === 'choice', '旧格式首题答案仍为字母 B（实际: ' + JSON.stringify(oldQ1 && oldQ1.answer) + '）');
assert(oldQ1 && oldQ1.options && oldQ1.options.length === 8 && oldQ1.options[0] === '施工难度大、技术复杂的分部分项工程', '旧格式选项数组不变');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tools/test_parser_platform.js`
Expected: 端到端断言 FAIL（当前 parseExcel 对 68 题都走旧逻辑，答案残留"选项2"等）

- [ ] **Step 3: 在 parseExcel 入口加分派**

在 [pwa/js/parser.js](../../pwa/js/parser.js) 的 `parseExcel` 中，`if (rows.length === 0) return [];` 之后插入：

```js
    // 平台新格式（数字编号选项）优先分派，未命中走原逻辑
    var platformHeader = detectPlatformFormat(rows);
    if (platformHeader) {
      return parsePlatformRows(rows, platformHeader, file.name);
    }
```

（parseExcel 其余代码一字不动）

- [ ] **Step 4: 运行测试确认通过**

Run: `node tools/test_parser_platform.js`
Expected: `ALL PASS`（三个 Task 全部断言通过，含回归）

- [ ] **Step 5: Commit**

```bash
git add tools/test_parser_platform.js pwa/js/parser.js
git commit -m "feat: dispatch platform quiz bank format in parseExcel"
```

---

### Task 4: 多选答案换行在浏览器端正常显示

**Files:**
- Modify: `pwa/css/style.css:88-92`（`.result-card .match-a` 规则加 `white-space: pre-line;`）

**Interfaces:**
- Consumes: Task 2 产生的多选答案（含 `\n`）
- Produces: 浏览器搜索页 result-card 中多选答案按行显示

- [ ] **Step 1: 修改 CSS**

[pwa/css/style.css](../../pwa/css/style.css) 第 88-92 行，在 `.result-card .match-a` 规则体内加一行：

```css
.result-card .match-a {
  font-size: 28px; font-weight: 700; color: var(--primary);
  padding: 8px 16px; background: #e8f0fe; border-radius: 8px;
  display: inline-block; margin: 8px 0;
  white-space: pre-line;  /* 多选答案的 \n 换行显示 */
}
```

- [ ] **Step 2: 验证 CSS 生效**

Run: `grep -n "white-space" pwa/css/style.css`
Expected: 输出含 `white-space: pre-line;`

- [ ] **Step 3: 手工验证（浏览器 + Android）**

浏览器：
1. 用任意静态服务器打开 pwa/index.html（如 `cd pwa && npx serve .` 或 Python http.server），进入"题库"页
2. 导入 `调试八十四期题库.xlsx` → 预览显示 68 条，前 5 条答案均为文字（"立即停止作业并上报"等），无"选项N"
3. 确认导入 → 搜索"安全防护设施拆除原则" → 答案区显示 3 行文字
4. 搜索"洞口盖板只要盖上就行" → 答案显示 ×

Android（如用户需要）：
1. Android Studio 重新构建安装 APK
2. 导入新题库，触发答题搜索，悬浮窗多选答案多行显示（TextView 原生支持 \n，无需改 Kotlin）

- [ ] **Step 4: Commit**

```bash
git add pwa/css/style.css
git commit -m "style: show multiline multi-select answers in search result"
```

---

## 测试数据说明

- `调试八十四期题库.xlsx`（仓库根目录，未跟踪）：新平台格式，68 题（56 选择题 + 12 是非题）。测试脚本默认读取仓库根目录下的真实文件；文件被移动/删除后可用 `node tools/test_parser_platform.js <新题库路径> <旧题库路径>` 传入其他题库路径
- `2026-07-11 16_56_52拍照录题.xlsx`（仓库根目录，未跟踪）：旧格式（选项 A-H 字母编号，答案字母），回归基准

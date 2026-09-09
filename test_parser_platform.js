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

// 测试用 File stub 构造器：名字 + 字节序列 → { name, arrayBuffer() }。
// 注意：ArrayBuffer 必须在沙箱 realm 内构建，沙箱内的 XLSX.read 对跨 realm
// ArrayBuffer 的类型判断会失败并抛 RangeError: Invalid array length。
var mkStub = vm.runInContext('(function(name, bytes) { var u8 = new Uint8Array(bytes); return { name: name, arrayBuffer: function() { return Promise.resolve(u8.buffer); } }; })', sandbox);

function fileStub(filePath) {
  var bytes = Uint8Array.from(fs.readFileSync(filePath)); // Node realm
  return mkStub(path.basename(filePath), bytes);
}

// 由内存字节构建 File stub（合成工作簿回归测试用；bytes 可为 ArrayBuffer 或 Uint8Array）
function bytesStub(name, bytes) {
  return mkStub(name, bytes);
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

// ---- Task 4 测试：parseTextToQA 文本解析（docx/pdf 路径） ----
// 模式1：题目：xxx 答案：A
var t1 = Parser.parseTextToQA('题目：施工现场安全防护的首要原则是什么 答案：A', 't1.txt');
assert(t1.length === 1 && t1[0].question === '施工现场安全防护的首要原则是什么' && t1[0].answer === 'A' && t1[0].type === 'choice', '文本模式1：题目/答案同行解析（实际: ' + JSON.stringify(t1) + '）');

// 模式2（用户新增）：N. 题干（B）行末括号
var t2 = Parser.parseTextToQA('3. 高处作业必须系挂安全带（B）', 't2.txt');
assert(t2.length === 1 && t2[0].question === '高处作业必须系挂安全带' && t2[0].answer === 'B', '文本模式2：行末括号答案解析（实际: ' + JSON.stringify(t2) + '）');

// 模式2b（本次恢复的旧模式）：N. 题干 A（行末裸答案标记，无括号）
var t2b = Parser.parseTextToQA('1. 下列哪种说法是正确的 A\n2. 关于安全帽使用的说法 B', 't2b.txt');
assert(t2b.length === 2 && t2b[0].question === '1. 下列哪种说法是正确的' && t2b[0].answer === 'A' && t2b[1].question === '2. 关于安全帽使用的说法' && t2b[1].answer === 'B', '旧模式恢复：行末裸答案标记解析（实际: ' + JSON.stringify(t2b) + '）');

// 兜底 m6：纯答案序列（行末锚点已恢复；行长度>5 才能通过行过滤）
var t6 = Parser.parseTextToQA('100. A\n101. B\n102. 对', 't6.txt');
assert(t6.length === 3 && t6[0].question === '第100题' && t6[0].answer === 'A' && t6[2].answer === '√', '兜底纯答案序列解析（实际: ' + JSON.stringify(t6) + '）');

// 负例1：枚举选项行（1. A. 选项文字…）不得产生幻影 QA
var tNeg1 = Parser.parseTextToQA('1. A. 选项甲的内容描述\n2. B. 选项乙的内容描述\n3. C. 选项丙的内容描述', 'enum.txt');
assert(tNeg1.length === 0, '枚举选项行不产生幻影题目（实际 ' + tNeg1.length + '）');

// 负例2：短编号噪声行（长度≤5 被行过滤挡下）
var tNeg2 = Parser.parseTextToQA('1. A\n2. 对', 'short.txt');
assert(tNeg2.length === 0, '短编号噪声行不产生幻影题目（实际 ' + tNeg2.length + '）');

// ---- Task 5 测试：parseExcel 无表头题库回归 ----
// 无表头两列题库，且首行数据含"问题"字样 → 旧代码会把该行误当表头，
// 答案列缺省必须无条件生效（qCol=0/aCol=1），否则每行答案全为空。
var aoa = [
  ['下列关于安全防护问题的说法', 'A'],
  ['关于高处作业管理的说法', 'B'],
  ['常规安全检查要点', 'C']
];
var ws5 = XLSX.utils.aoa_to_sheet(aoa);
var wb5 = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb5, ws5, 'Sheet1');
var hdrBytes = XLSX.write(wb5, { type: 'array', bookType: 'xlsx' });
var hdrQas = await Parser.parseFile(bytesStub('headless.xlsx', hdrBytes));
assert(hdrQas.length === 2, '无表头题库（首行含"问题"）解析 2 题（实际 ' + hdrQas.length + '）');
assert(hdrQas.every(function(q) { return q.answer !== '' && q.answer !== undefined && q.answer !== null; }), '无表头题库答案非空（实际: ' + JSON.stringify(hdrQas.map(function(q) { return q.answer; })) + '）');
assert(hdrQas[0].question === '关于高处作业管理的说法' && hdrQas[0].answer === 'B', '无表头题库答案列缺省为第 2 列（实际: ' + JSON.stringify(hdrQas[0]) + '）');

// ================= 汇总 =================
console.log(failures.length === 0 ? 'ALL PASS' : failures.length + ' FAILURES');
process.exit(failures.length === 0 ? 0 : 1);

})().catch(function(e) { console.error(e); process.exit(1); });

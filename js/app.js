// ====== 页面导航 ======
function initNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const viewName = btn.dataset.view;
      switchView(viewName);
    });
  });
}

function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const view = document.getElementById('view-' + name);
  if (view) view.classList.add('active');
  const navBtn = document.querySelector('.nav-btn[data-view="' + name + '"]');
  if (navBtn) navBtn.classList.add('active');
  if (name === 'bank') refreshStats();
  if (name === 'search') updateBankCount();
}

// ====== Toast ======
function showToast(msg, duration) {
  duration = duration || 1500;
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timeout);
  t._timeout = setTimeout(function() { t.classList.add('hidden'); }, duration);
}

// ====== 更新题库计数 ======
async function updateBankCount() {
  try {
    var count = await db.count();
    document.getElementById('status-count').textContent = '题库: ' + count + '题';
  } catch (e) {
    // db not ready yet
  }
}

// ====== JS Bridge: 供 Android 壳调用 ======
window.searchQuestion = async function(text) {
  var result = await AnswerSearch.search(text);
  return JSON.stringify(result);
};

// Android 壳暴露的接口（如不可用则 fallback 到页面内显示）
window.Android = window.Android || {
  showAnswer: function(json) {
    try {
      var r = JSON.parse(json);
      var div = document.getElementById('search-result');
      if (r.found) {
        div.innerHTML = '<div class="result-card">' +
          '<div class="match-q">📋 ' + escapeHtml(r.question) + '</div>' +
          '<div class="match-a">' + escapeHtml(r.answer) + '</div>' +
          '<div class="confidence">匹配度: ' + Math.round(r.confidence * 100) + '% | 来源: ' + escapeHtml(r.source) + '</div>' +
          '</div>';
      } else if (r.candidates && r.candidates.length) {
        var html = '<p style="margin-bottom:8px">未精确匹配，相似题目：</p><div class="candidate-list">';
        for (var i = 0; i < r.candidates.length; i++) {
          var c = r.candidates[i];
          html += '<div class="candidate-item">' +
            '<div class="c-q">' + escapeHtml(c.question) + '</div>' +
            '<div class="c-a">答案: ' + escapeHtml(c.answer) + ' <span class="tag">' + Math.round(c.confidence * 100) + '%</span></div>' +
            '</div>';
        }
        html += '</div>';
        div.innerHTML = html;
      } else if (r.error) {
        div.innerHTML = '<p class="hint">搜索出错: ' + escapeHtml(r.error) + '</p>';
      } else {
        div.innerHTML = '<p class="hint">未找到匹配结果' + (r.aiAnswered ? '' : '，可前往设置配置 AI 自动作答') + '</p>';
      }
    } catch (e) {
      console.error('showAnswer error', e);
    }
  }
};

function escapeHtml(s) {
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ====== 搜索页面 ======
function initSearchUI() {
  var input = document.getElementById('search-input');
  var btn = document.getElementById('search-btn');
  var result = document.getElementById('search-result');
  var hint = document.getElementById('empty-hint');

  async function doSearch() {
    var text = input.value.trim();
    if (!text) {
      showToast('请粘贴题目文字');
      return;
    }

    result.innerHTML = '<p class="hint">搜索中...</p>';
    hint.style.display = 'none';

    try {
      var r = await AnswerSearch.search(text);
      if (r.found) {
        result.innerHTML = '<div class="result-card">' +
          '<div class="match-q">📋 ' + escapeHtml(r.question) + '</div>' +
          '<div class="match-a">' + escapeHtml(r.answer) + '</div>' +
          '<div class="confidence">匹配度: ' + Math.round(r.confidence * 100) + '% | 来源: ' + escapeHtml(r.source) + '</div>' +
          '</div>';
      } else if (r.candidates && r.candidates.length > 0) {
        var html = '<p style="margin-bottom:8px">未精确匹配，相似题目：</p><div class="candidate-list">';
        for (var i = 0; i < r.candidates.length; i++) {
          var c = r.candidates[i];
          html += '<div class="candidate-item">' +
            '<div class="c-q">' + escapeHtml(c.question) + '</div>' +
            '<div class="c-a">答案: ' + escapeHtml(c.answer) + ' <span class="tag">' + Math.round(c.confidence * 100) + '%</span></div>' +
            '</div>';
        }
        html += '</div>';
        result.innerHTML = html;
      } else if (r.error) {
        result.innerHTML = '<p class="hint">搜索出错: ' + escapeHtml(r.error) + '</p>';
      } else {
        result.innerHTML = '<p class="hint">未找到匹配结果。可前往设置配置 AI 自动作答。</p>';
      }
    } catch (err) {
      result.innerHTML = '<p class="hint">搜索出错: ' + escapeHtml(err.message) + '</p>';
    }
  }

  btn.addEventListener('click', doSearch);

  // Ctrl+Enter 快捷搜索
  input.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      doSearch();
    }
  });

  // 粘贴后自动搜索
  input.addEventListener('paste', function() {
    setTimeout(doSearch, 150);
  });
}

// ====== 题库页面 ======
var pendingQuestions = [];

function initBankUI() {
  var fileInput = document.getElementById('file-input');

  fileInput.addEventListener('change', async function(e) {
    var files = Array.from(e.target.files);
    if (files.length === 0) return;

    document.getElementById('upload-status').textContent = '解析中...';
    pendingQuestions = [];

    for (var i = 0; i < files.length; i++) {
      try {
        var questions = await Parser.parseFile(files[i]);
        pendingQuestions = pendingQuestions.concat(questions);
      } catch (err) {
        showToast('解析失败: ' + files[i].name + ' - ' + err.message, 3000);
      }
    }

    document.getElementById('upload-status').textContent =
      '解析完成，共识别 ' + pendingQuestions.length + ' 条题目';

    if (pendingQuestions.length > 0) {
      showPreview(pendingQuestions.slice(0, 5));
      document.getElementById('preview-section').classList.remove('hidden');
    }
  });

  document.getElementById('confirm-import').addEventListener('click', async function() {
    if (pendingQuestions.length === 0) return;
    try {
      var count = await db.addBatch(pendingQuestions);
      await AnswerSearch.rebuildIndex();
      showToast('成功导入 ' + count + ' 道题');
      pendingQuestions = [];
      document.getElementById('preview-section').classList.add('hidden');
      document.getElementById('upload-status').textContent = '';
      fileInput.value = '';
      refreshStats();
      updateBankCount();
    } catch (err) {
      showToast('导入失败: ' + err.message, 3000);
    }
  });

  document.getElementById('cancel-import').addEventListener('click', function() {
    pendingQuestions = [];
    document.getElementById('preview-section').classList.add('hidden');
    document.getElementById('upload-status').textContent = '';
    fileInput.value = '';
  });

  document.getElementById('clear-bank').addEventListener('click', async function() {
    if (!confirm('确定要清空所有题库吗？此操作不可恢复。')) return;
    await db.clearAll();
    await AnswerSearch.rebuildIndex();
    showToast('题库已清空');
    refreshStats();
    updateBankCount();
  });

  refreshStats();
}

function showPreview(questions) {
  var list = document.getElementById('preview-list');
  var html = '';
  for (var i = 0; i < questions.length; i++) {
    var q = questions[i];
    var typeLabel = q.type === 'choice' ? '选择题' : (q.type === 'truefalse' ? '判断题' : '未知');
    html += '<div class="preview-item">' +
      '<div class="q">' + (i + 1) + '. ' + escapeHtml(q.question) + '</div>' +
      '<div class="a">答案: ' + escapeHtml(q.answer) + ' <span class="tag">' + typeLabel + '</span></div>' +
      '</div>';
  }
  list.innerHTML = html;
}

async function refreshStats() {
  var stats = await db.countByType();
  document.getElementById('stat-total').textContent = stats.total;
  document.getElementById('stat-choice').textContent = stats.choice;
  document.getElementById('stat-tf').textContent = stats.truefalse;
}

// ====== 设置页面 ======
function initSettingsUI() {
  document.getElementById('api-key').value = localStorage.getItem('ai_key') || '';
  document.getElementById('api-base').value = localStorage.getItem('ai_base') || 'https://api.openai.com/v1';
  document.getElementById('api-model').value = localStorage.getItem('ai_model') || 'gpt-4o-mini';

  var fields = ['api-key', 'api-base', 'api-model'];
  for (var i = 0; i < fields.length; i++) {
    (function(id) {
      document.getElementById(id).addEventListener('change', function(e) {
        var key = id === 'api-key' ? 'ai_key' : (id === 'api-base' ? 'ai_base' : 'ai_model');
        localStorage.setItem(key, e.target.value);
        showToast('已保存');
      });
    })(fields[i]);
  }

  document.getElementById('test-ai').addEventListener('click', async function() {
    var key = document.getElementById('api-key').value;
    if (!key) {
      showToast('请先填写 API Key', 2000);
      return;
    }
    localStorage.setItem('ai_key', key);
    localStorage.setItem('ai_base', document.getElementById('api-base').value);
    localStorage.setItem('ai_model', document.getElementById('api-model').value);

    showToast('正在测试...', 2000);
    try {
      var answer = await testAIConnection();
      showToast('连接成功！测试回答: ' + answer, 3000);
    } catch (err) {
      showToast('连接失败: ' + err.message, 3000);
    }
  });
}

// ====== 初始化 ======
document.addEventListener('DOMContentLoaded', async function() {
  initNav();
  initSearchUI();
  initBankUI();
  initSettingsUI();
  updateBankCount();
});

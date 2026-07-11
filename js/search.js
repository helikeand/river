var AnswerSearch = (function() {
  var fuseInstance = null;
  var questionCache = [];

  // ====== 格式化答案：将字母替换为完整选项 ======
  function formatAnswer(item) {
    if (!item) return '';
    var ans = item.answer;
    // 只有题目包含选项数组，且答案是个单字母时，才转换成“字母. 选项文字”
    if (item.options && item.options.length > 0 && /^[A-H]$/.test(ans)) {
      var idx = ans.charCodeAt(0) - 65;  // A->0, B->1, ...
      if (idx >= 0 && idx < item.options.length && item.options[idx] && item.options[idx].trim()) {
        return ans + '. ' + item.options[idx].trim();
      }
    }
    // 否则直接返回原答案
    return ans;
  }

  // ====== 初始化 Fuse.js 索引 ======
  async function rebuildIndex() {
    questionCache = await db.getAll();
    if (questionCache.length === 0) {
      fuseInstance = null;
      return;
    }
    fuseInstance = new Fuse(questionCache, {
      keys: ['question'],
      threshold: 0.5,
      distance: 100,
      minMatchCharLength: 2,
      includeScore: true
    });
  }

  // ====== 预处理文本（去符号、去空格） ======
  function preprocess(text) {
    return text
      .replace(/[\s\n\r]+/g, ' ')
      .replace(/[，。！？、；：""''（）《》【】\[\]{}]/g, '')
      .trim()
      .toLowerCase();
  }

  // ====== 精确匹配 ======
  function exactMatch(input) {
    var cleaned = preprocess(input);
    for (var i = 0; i < questionCache.length; i++) {
      var q = questionCache[i];
      if (preprocess(q.question) === cleaned) {
        return { item: q, score: 1.0 };
      }
    }
    // 包含匹配
    for (var j = 0; j < questionCache.length; j++) {
      var q2 = questionCache[j];
      var qClean = preprocess(q2.question);
      if (qClean.indexOf(cleaned) !== -1 || cleaned.indexOf(qClean) !== -1) {
        return { item: q2, score: 0.95 };
      }
    }
    return null;
  }

  // ====== 模糊匹配（Fuse.js） ======
  function fuzzyMatch(input) {
    if (!fuseInstance) return [];
    var results = fuseInstance.search(input, { limit: 5 });
    return results.map(function(r) {
      return {
        item: r.item,
        score: 1 - r.score
      };
    });
  }

  // ====== 主搜索函数 ======
  async function search(text) {
    if (!text || text.trim().length < 2) {
      return { found: false, candidates: [], aiAnswered: false };
    }

    var input = text.trim();

    // 1. 精确匹配
    var exact = exactMatch(input);
    if (exact && exact.score >= 0.95) {
      return {
        found: true,
        question: exact.item.question,
        answer: formatAnswer(exact.item),       // ✅ 调用 formatAnswer
        confidence: exact.score,
        source: '精确匹配',
        candidates: []
      };
    }

    // 2. 模糊匹配
    var fuzzy = fuzzyMatch(input);
    if (fuzzy.length > 0 && fuzzy[0].score >= 0.6) {
      var top = fuzzy[0];
      var rest = fuzzy.slice(1, 4).map(function(f) {
        return {
          question: f.item.question,
          answer: formatAnswer(f.item),         // ✅
          confidence: f.score
        };
      });
      return {
        found: true,
        question: top.item.question,
        answer: formatAnswer(top.item),         // ✅
        confidence: top.score,
        source: '模糊匹配',
        candidates: rest
      };
    }

    // 3. 低分候选列表
    if (fuzzy.length > 0) {
      return {
        found: false,
        candidates: fuzzy.slice(0, 3).map(function(f) {
          return {
            question: f.item.question,
            answer: formatAnswer(f.item),       // ✅
            confidence: f.score
          };
        }),
        aiAnswered: false
      };
    }

    // 4. AI 兜底
    var aiKey = localStorage.getItem('ai_key');
    if (aiKey) {
      try {
        var aiAnswer = await askAI(input);
        return {
          found: true,
          question: input,
          answer: aiAnswer,
          confidence: 0.5,
          source: 'AI 推理',
          aiAnswered: true,
          candidates: []
        };
      } catch (e) {
        return { found: false, candidates: [], aiAnswered: false, error: e.message };
      }
    }

    return { found: false, candidates: [], aiAnswered: false };
  }

  return {
    search: search,
    rebuildIndex: rebuildIndex
  };
})();
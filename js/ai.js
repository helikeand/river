// ====== AI API 调用 ======
async function askAI(question) {
  var key = localStorage.getItem('ai_key');
  var base = localStorage.getItem('ai_base') || 'https://api.openai.com/v1';
  var model = localStorage.getItem('ai_model') || 'gpt-4o-mini';

  if (!key) throw new Error('未配置 API Key');

  var url = base.replace(/\/+$/, '') + '/chat/completions';
  var resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + key
    },
    body: JSON.stringify({
      model: model,
      messages: [
        {
          role: 'system',
          content: '你是一个答题助手。用户会给你一道选择题或判断题的题目，你需要只返回正确答案（选择题只返回字母如 A/B/C/D，判断题只返回 √ 或 ×）。不要解释，不要多余文字，只返回答案。'
        },
        {
          role: 'user',
          content: '题目：' + question
        }
      ],
      max_tokens: 10,
      temperature: 0
    })
  });

  if (!resp.ok) {
    var errText = await resp.text();
    throw new Error('API 请求失败: ' + resp.status + ' ' + errText);
  }

  var data = await resp.json();
  var answer = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '').trim();
  return answer.charAt(0).toUpperCase();
}

// ====== AI 连接测试 ======
async function testAIConnection() {
  var result = await askAI('1+1等于几？A.1 B.2 C.3 D.4');
  return result;
}

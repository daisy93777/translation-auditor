export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    const { src, tgt, style } = req.body || {};
    if (!src || !tgt) {
      return res.status(400).json({ error: "Missing source or translation" });
    }

    const system = `You are a senior bilingual editor and must return ONLY a JSON object.
No markdown fences, no backticks, no commentary. Schema:
{
  "rows": [
    { "index": 1, "source": "...", "translation": "...", "issues": "...",
      "fix": "...", "score": "5/4/5", "severity": "minor" }
  ],
  "summary": "...",
  "rules": ["rule1","rule2","rule3"]
}`;

    const user = `
Audit the translation for accuracy, idiomaticity, and consistency.
1) Split both texts into paragraphs by blank lines; align by order.
2) For each pair, identify issues: mistranslation, missing info, unnatural phrasing,
   term inconsistency, punctuation/format.
3) Provide a corrected rewrite (concise, idiomatic, same meaning).
4) Score each pair: Accuracy/Idiomaticity/Consistency (1–5).
5) Mark severity: minor / moderate / critical.

Style guide (customizable):
${style || `Tone: concise, friendly, product/help-center.
Fixed terms: imToken, Passkey, Token Collections, Arbitrum.
Prefer idiomatic English; avoid literal calques.`}

Texts:
SOURCE:
${src}

TRANSLATION:
${tgt}
`.trim();

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5",                 // 如果无权限，可先用 "gpt-4o-mini"
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        temperature: 0.2,
        response_format: { type: "json_object" }, // 强制返回 JSON
        // max_tokens: 2000, // 可按需设置上限，避免超长
      }),
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(500).json({ error: `OpenAI error: ${text}` });
    }

    const json = await r.json();
    let content = json?.choices?.[0]?.message?.content?.trim() || "";

    // 首选严格 JSON 解析
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      // 兜底：从文本中提取第一对大括号包裹的 JSON
      const start = content.indexOf("{");
      const end = content.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        const maybe = content.slice(start, end + 1);
        try {
          parsed = JSON.parse(maybe);
        } catch (e2) {
          return res.status(500).json({ error: "Failed to parse model JSON." });
        }
      } else {
        return res.status(500).json({ error: "Failed to parse model JSON." });
      }
    }

    const rowsHtml = (parsed.rows || []).map((row) => `
      <tr>
        <td>${row.index ?? ""}</td>
        <td><pre style="white-space:pre-wrap;margin:0">${escapeHtml(row.source || "")}</pre></td>
        <td><pre style="white-space:pre-wrap;margin:0">${escapeHtml(row.translation || "")}</pre></td>
        <td><pre style="white-space:pre-wrap;margin:0">${escapeHtml(row.issues || "")}</pre></td>
        <td><pre style="white-space:pre-wrap;margin:0">${escapeHtml(row.fix || "")}</pre></td>
        <td>${escapeHtml(row.score || "")}</td>
        <td>${escapeHtml(row.severity || "")}</td>
      </tr>
    `).join("");

    const html = `
      <table>
        <thead>
          <tr>
            <th>#</th><th>Source</th><th>Translation</th><th>Issues</th><th>Fix</th>
            <th>Acc/Idio/Cons</th><th>Severity</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <h3>Summary</h3>
      <pre class="mono">${escapeHtml(parsed.summary || "")}</pre>
      <h3>Style Rules</h3>
      <ul>${(parsed.rules || []).map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
    `;

    return res.status(200).json({ html });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Server error" });
  }
}

function escapeHtml(s = "") {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * 假的 OpenAI 兼容端点 —— 只为验证「AI 改写」的成功路径
 * ══════════════════════════════════════════════════════════════════
 *
 * 真实调用需要一把可用的密钥（会产生费用，也不该拿别人的服务做测试）。
 * 但成功路径同样必须验证：请求体拼错、响应字段读错、改写结果被误拒 ——
 * 这些错误在失败路径里全都被"退回规则文案"掩盖掉了，一个都发现不了。
 *
 * 所以这里起一个本地端点，模仿 OpenAI 的 /chat/completions 形状，
 * 返回一句合格的改写。用它来确认：请求发对了、响应解析对了、
 * 卡片上显示的确实是模型给的那句话。
 *
 * 用法：node tools/fake-provider.mjs [端口]
 */

import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8971);

/** 把收到的提示词记下来，好确认我们真的只送了数字 */
const seen = [];

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    if (!req.url?.includes("/chat/completions")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }

    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      /* 拼错就当作空 */
    }
    seen.push(parsed);

    if (process.env.FAKE_PROVIDER_LOG) {
      const user = parsed?.messages?.find((m) => m.role === "user")?.content ?? "";
      console.log("[fake] 收到 user 提示词:\n" + user + "\n---");
      console.log("[fake] system 前 40 字:", String(parsed?.messages?.[0]?.content ?? "").slice(0, 40));
    }

    // 刻意返回一句"合格的改写"：短、无 Markdown、不指责
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "fake-1",
        object: "chat.completion",
        model: parsed?.model ?? "fake",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "今天还空着。写一句话就算接上了，不用补。",
            },
            finish_reason: "stop",
          },
        ],
      }),
    );
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`假端点已启动：http://127.0.0.1:${port}/v1/chat/completions`);
});

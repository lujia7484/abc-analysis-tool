# 学员自助 ABC 分析工具

这是一个面向学员的 ABC 行为观察工作台，用于把经历或逐字稿整理为 A（前因）、B（可观察的表达与行动）和 C（随后发生的结果）。生成内容是供学习和复核的观察草稿，不构成医学、心理或教育诊断。

## 在线访问与架构

- 公开网页：https://lujia7484.github.io/abc-analysis-tool/
- AI 接口：https://abc-analysis-api.codex-ai-abc-workbench.workers.dev/analyze
- CORS 允许来源：`https://lujia7484.github.io`

静态网页由 GitHub Pages 提供。AI 请求发送到 Cloudflare Worker；Worker 负责输入校验、基于 Durable Object 的原子限流、调用 DeepSeek 和输出规范化。DeepSeek 密钥不会发送到浏览器。

## 隐私与使用边界

网页和我们的 Worker 代码不会有意持久化保存逐字稿或 AI 分析结果。Worker 只保存加盐哈希后的限流计数和重置时间元数据，最长保留至当前一小时限流窗口结束；不会在该限流状态中保存原始 IP、逐字稿或 AI 结果。

选择 AI 分析时，请求会经过 Cloudflare 基础设施发送给 DeepSeek。Cloudflare 和 DeepSeek 可能依据各自政策处理、记录或保留相关数据；这些第三方行为不由我们控制，我们也不对其保留期限作出承诺。请阅读 [Cloudflare 隐私政策](https://www.cloudflare.com/privacypolicy/) 和 [DeepSeek 隐私政策](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)。提交前请移除姓名、联系方式、账号、地址等身份识别信息，以及不需要分析的敏感数据。

AI 分析失败时，页面会明确显示“使用基础分析”选项。基础分析在浏览器本机按显式规则运行，不会把文本发送到 AI 接口，也不会伪装成 AI 结果。

每次提交最多 `20,000` 个字符。服务按 IP 每小时最多接受五次有效请求；限流标识是加盐哈希，不保存原始 IP，并由 Durable Object 的 alarm 清理过期窗口。

## 功能

- 学员可以编辑生成结果中的 A、B、C，并保存修订状态。
- 原文证据和原文位置为只读，避免把推断改写成原始材料。
- 当前草稿可导出为 JSON、CSV，或复制为可读文本；导出包含已保存的 A/B/C 修改。

## 本地检查

需要 Node.js `>=22.9`：

```bash
npm install
npm test
```

## Worker 部署与配置

公开配置位于 `worker/wrangler.jsonc`。部署命令：

```bash
npx wrangler deploy --config worker/wrangler.jsonc
```

生产环境只需要以下两个 secret 名称：

- `DEEPSEEK_API_KEY`
- `RATE_LIMIT_SALT`

请在 Cloudflare Dashboard 的 Worker 设置中安全录入，或使用 Wrangler 的隐藏交互输入；不要把值写入命令、README、Git、`.env`、`.dev.vars`、终端日志或聊天记录：

```bash
npx wrangler secret put DEEPSEEK_API_KEY --config worker/wrangler.jsonc
npx wrangler secret put RATE_LIMIT_SALT --config worker/wrangler.jsonc
```

密钥疑似泄露、成员变更或按内部周期到期时，应在 DeepSeek 和 Cloudflare 侧轮换相应 secret，然后重新部署并验证。DeepSeek API 的账户、额度、账单和用量监控由部署者负责。

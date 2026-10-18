# Roseglass · Netlify Free 固定入口（备用部署）

用于 [Cloudflare Pages](PAGES_DEPLOY.md) 账户创建被拦截时的**独立备用方案**。
仅用于 `gwithyu/roseglass-reading-room` 公开版；不连接私人 ChatGPT Site、g-mind 或作者任何 AI API Key。

## 预期效果

一个长期网址：`https://<项目实际名称>.netlify.app`（必须由平台创建后才能确定）。
打开固定网址点击「生成分享链接」，每次产生一个独特 `#rg-invite=<随机值>` 链接，供 Jessica、朋友或国内用户各自使用。
随机链接**只表示入口**，不是服务器房间、密码门禁或实时同步；课件和笔记不会传给对方。
用户在共读室里填写**自己的** AI API Key 并自费调用，不需要 ChatGPT Plus。

## 费用安全边界

根据 Netlify 2026 年的 Free 官方计划，免费版为 **$0/月、300 积分/月的硬上限**。
达到上限站点将暂停，免费计划**没有自动补充付费积分的选项**。不要升级收费套餐。
发布到正式生产每次消耗免费积分（Netlify 文档目前为每次 15 积分）；
预览部署一般免费，但网络流量和 Function 调用也会消耗积分。
因此只做必要的预览与正式部署，不重复刷生产发布。
此规则只覆盖 Netlify 平台账单：**使用者自己的 AI API 用量可能计费**，作者不代付。

Netlify Free 是否从中国大陆网络可访问 **未经过实际验收**；不承诺国内稳定。

## 不用 GitHub Actions 的部署流程

**前提：** 需要由网站所有者自行注册/登录 [Netlify](https://app.netlify.com/)，
确定仍是 Free（$0）套餐。不把 Netlify 登录密钥或任何 AI API Key 分享给其他人。

本地 Node 22 终端运行（原仓库 main 不能直接代表未合并的草稿版；必须检出已审计分支）：

```bash
git clone https://github.com/gwithyu/roseglass-reading-room.git
cd roseglass-reading-room
git switch feature/public-byok-local-bridge-20261018

# 静态资源构建；只复制公共白名单，并禁用未审计的远程 PPTX 动态脚本
node scripts/build-public.mjs

# 本地离线测试（没有真实模型 API 消耗，也不会运行 GitHub Actions）
node --test tests/invite-links.test.mjs tests/pages-byok.test.mjs tests/netlify-byok.test.mjs tests/pages-build.test.mjs

# 登录 Netlify（只在你自己的浏览器操作）
npx --yes netlify-cli@latest login

# 在仓库内执行；由 CLI 引导新建项目并先生成仅用于预览的网址
npx --yes netlify-cli@latest deploy --no-build --dir dist-public --functions netlify/functions
```

随后确认预览版 `/api/health` 返回 `"mode":"pages-byok"`，
并在浏览器实测 PDF 页面读取、缩放、邀请链接生成、临时密钥清除、个人 API 费用确认。
**没有完成安全与可用性验收前，不要使用 `--prod`。**

只有预览验收通过后，才考虑正式发布：

```bash
npx --yes netlify-cli@latest deploy --prod --no-build --dir dist-public --functions netlify/functions
```

获得的 `.netlify.app` **固定网址以 Netlify 实际返回为准**，不可提前猜测。
此流程只运行 Netlify CLI，不需 GitHub Actions、VPS、Cloudflare Token 或额外域名。

### 技术细节

Netlify 使用 `netlify.toml` 的 `dist-public` 静态文件与 `netlify/functions`。
对应请求路径是 `/api/health` 和 `/api/chat`，后者直接复用
`functions/api/chat.js` 的固定服务商白名单、安全检查与按次传入的个人 Key。
不要只把 HTML 拖到 Netlify Drop：**纯静态上传不能证明 API Functions 已安装**。

公开托管版暂时仅支持 PDF；PPTX 解析器在打包、安全审计前禁用，
避免外部可执行 JS 接触页面上的个人 API Key。

### 安全注意

密钥不进入分享 URL、GitHub 或浏览器持久存储，但发送时要经由**部署此站点的 Netlify Function**
转交给用户选择的 AI 服务商；基础设施及服务商可以按自己的政策处理流量。
务必使用可信任的正式网站域名，不启用请求体日志、错误正文泄露或共享的站长 API 密钥。
公开代理仍可能被恶意请求消耗 Netlify 免费额度；到达硬限制会暂停，不能保证永久在线。

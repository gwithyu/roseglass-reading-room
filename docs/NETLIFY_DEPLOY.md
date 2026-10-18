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

## Netlify Functions 真实平台限制（2026 年 10 月核对）

Netlify 官方的同步函数上限是 **60 秒**，缓冲请求上限是 **6 MB**。因此当前公共 API 代理把自身请求体限制为 **4.8 MB**、页面图片的 base64 字符串限制为 **430 万字符**，AI 上游等待设为 **45 秒**，为平台执行与响应预留时间。

超过尺寸时会在发送到 AI 服务商前拒绝，避免没必要的付费 API 消耗。网页会提示改用“只发文字”。较长的 AI 回复仍可能在模型侧超时；不能承诺所有模型和地区都能在 45 秒内返回。

**特别注意：** 这两个限制是真实平台约束，不是 Roseglass 任意提高就能解决的。PDF 阅读、缩放、笔记、邀请链接在浏览器本地完成，不受 AI 图片单次请求大小限制。

## 以后只用一条命令生成临时预览链接（可选）

在已经检出此 PR 开发分支的 Mac 仓库根目录运行：

```bash
bash scripts/preview-netlify.sh
```

脚本会先在本地跑共读邀请、个人 API、Netlify、Pages 和静态构建相关测试。**任何失败都会直接停止，不会进行部署**。通过后还需要在终端手动输入 `YES` 才会运行 Netlify CLI。

**重要纠正：Netlify 官方明确要求使用 Serverless Functions 的项目必须有 Netlify 账户。** `--allow-anonymous` 只能用于不依赖 Functions 的静态临时站点，不适合 Roseglass 需要真正 AI 接口的共读室。因此这个脚本不使用匿名模式；所有者必须先在自己的电脑执行 `npx --yes netlify-cli@latest login` 并确认 Netlify Free（$0）方案，之后脚本才尝试创建带 Functions 的草稿预览。预览网址不是正式的固定生产入口。新创建的 Netlify 免费项目可能默认不可公开访问，需要在平台明确发布后才能作为 Jessica 的长期分享入口；不能把只供本人预览的地址当成已经公开。本站脚本不包含 `--prod`。

当代码验收通过、Netlify 免费账户准备好，再考虑由所有者手动创建固定生产入口。不要把任何 API Key 或 Netlify 登录凭据发进聊天。

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

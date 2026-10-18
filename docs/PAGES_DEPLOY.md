# Roseglass 公开版 · 免费网址部署（Cloudflare Pages）

> 本指南只针对 **gwithyu/roseglass-reading-room 公开版**。不连接作者私人 Site 或 g-mind。
> **不要运行仓库的 GitHub Actions / release.yml，也不要配置收费 Runner。**

## 最重要的成本边界

- 只选择 Cloudflare Workers **Free** + Pages 免费额度，**不升级 Paid**、不购买域名、不添加计费方式。
- Pages 免费托管静态文件；Pages Functions 计算在 Workers 免费额度内。额度不足时服务可能中断，**不要开启收费后备**。
- 每个使用者自行输入自己的 API Key，使用者的 AI API 计费不属于 Cloudflare 免费额度。Roseglass 作者不提供共享 API 额度。
- 上传文件本身在浏览器本地完成；只有用户点击“发送问题”，才将当前页文字以及用户主动勾选的页图发给模型。
- **安全说明：** 填写的个人 Key 不写入 GitHub、localStorage、Cookie 或数据库，但会随本次请求经过该网站的 Cloudflare Functions 代理转交 AI 厂商。请只在核实过域名和服务方的可信网页填写自己的 Key；基础设施服务方和模型提供商可能依其政策处理相关数据。站长不应启用请求体日志。
- 公开网址不等于中国大陆稳定可达；必须由大陆网络实际验收。PPTX 仍依赖第三方模块加载，打不开时先转换 PDF。

## 不使用 GitHub Actions 的发布操作

需要 Node.js 22+ 和一个使用 **Free** 计划的 Cloudflare 账户。Cloudflare 账户登录必须由所有者亲自完成，不能把 API Token 粘贴到聊天里。

```bash
git clone https://github.com/gwithyu/roseglass-reading-room.git
cd roseglass-reading-room

# 只有 PR #3 验收、合并并确认 main 安全之后，才使用 main 发布。
# 开发期间也可仅检出已审核的开发分支进行预览（不要公开未验收版本）。
node scripts/build-public.mjs

# Cloudflare 官方 CLI；这不会运行 GitHub Actions。
npx wrangler login
npx wrangler pages project create
npx wrangler pages deploy dist-public
```

注意：`functions/` 位于项目根目录；使用 **Wrangler 部署**才会编译 Pages Functions。
不要只用 Dashboard 的“拖拽静态文件”，否则 `/api/chat`、`/api/health` 可能不可用。

Cloudflare 项目创建后才会生成实际的 `<实际项目名>.pages.dev` 地址，名称是否可用需要平台确认。不要猜测网址。

## 公开版验收门

1. 打开生成的实际 Pages 网址，不需要 ChatGPT Plus 或登录 ChatGPT。
2. 上传真实 PDF，翻页、缩放、搜索和书签正常。
3. 打开“连接我的 AI API”，确认 `/api/health` 显示托管模式 `pages-byok`。
4. **模拟测试，不用真实 API Key**：检查没有同意费用时无法发送；切换提供商、关闭面板后 Key 清空；未选择图片时不发送图像。
5. 使用自愿提供的测试密钥与已知额度，才考虑真实模型联调；不要使用作者自己的 Key。
6. 确认大陆网络入口、手机页面和 PPTX；若不满足，则不要宣传“国内稳定可用”。

## 回滚

Cloudflare Pages Dashboard 可通过部署记录回滚到此前的版本。GitHub 独立 PR 保留为 Draft，直到真实网页验收完成。不通过便不要合并或发布。

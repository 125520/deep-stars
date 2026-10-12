# 部署到 Vercel + Neon

> ⚠️ **如果 Vercel 要求手机验证而你的号码收不到验证码，看 [`deploy-render.md`](./deploy-render.md)。**
> 那份用 Render 跑应用、Neon 提供数据库，同样免费、同样不需要信用卡，
> 而且用 GitHub 授权登录、不发验证码。代码一个字都不用改 ——
> 只有 Build Command、Start Command、环境变量三处不同。
>
> 本页保留，供 Vercel 可用的情况下参考。

从零到"任何人在自己设备上打开网址就能用"，大约 10 分钟。
三样东西都用免费档，不需要信用卡。

---

## 你需要准备的

| | 用途 | 免费档够吗 |
|---|---|---|
| [GitHub](https://github.com) 账号 | 存放代码 | ✅ |
| [Vercel](https://vercel.com) 账号 | 跑应用 | ✅ Hobby 档 |
| [Neon](https://neon.tech) 账号 | PostgreSQL 数据库 | ✅ 0.5 GB |

> **为什么不能只用 SQLite？** Vercel 的 Serverless 函数是**无状态且文件系统只读**的，
> 写不进本地文件。所以线上必须换成 Neon 的 PostgreSQL。
> 本地开发仍然是 SQLite —— 同一份 schema 模板渲染出两个变体，代码一行都不用改。

---

## 第 1 步：建数据库（Neon）

1. 登录 Neon → **Create project**
2. Region 选离你近的（例如 `AWS ap-southeast-1` 新加坡）
3. 建好后在 **Connection string** 里选 **Prisma** 或 **Node.js** 形式，复制那串 `postgresql://…`

> 连接串里含数据库密码，**不要**把它提交进仓库、也不要贴到公开的地方。

---

## 第 2 步：生成两个密钥

在本地跑（Windows 上 Git Bash / WSL / 或者用 Node 都行）：

```bash
# 会话签名密钥
openssl rand -base64 32

# BYOK 密钥的加密密钥
openssl rand -hex 32
```

用 Node 也能生成：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> ⚠️ **`DEEP_STARS_SECRET` 一旦设定就不能再换。**
> 它是用户自带 AI 密钥的对称加密密钥（AES-256-GCM）。
> 换掉之后，**所有已保存的 AI 密钥都会解不开** —— 而且不会报错，
> 只会在用户调用 AI 时失败。所以：设好之后写进密码管理器，别再动它。

---

## 第 3 步：把代码推上 GitHub

```bash
git remote add origin https://github.com/<你的用户名>/deep-stars.git
git push -u origin main
```

仓库建议设为 **Private**。

> 首次推送需要认证。用 Personal Access Token（scope 勾 `repo`）而不是密码 ——
> GitHub 早已不接受密码推送。
> 用完记得在 **Settings → Developer settings → Tokens** 里吊销它。

**推送前自查**（本仓库的 `.gitignore` 已经覆盖，但确认一下更稳妥）：

```bash
git status --short          # 不应出现 .env / *.db / .next / .cache
git check-ignore -v .env    # 应当命中 .gitignore 的 .env 行
```

---

## 第 4 步：导入 Vercel 并填环境变量

1. Vercel → **Add New → Project** → 选中 `deep-stars` 仓库 → **Import**
2. Framework Preset 会自动识别为 Next.js，**构建命令不用改**（`pnpm build` 里已经包含 `prisma generate`）
3. 在 **Environment Variables** 里填下面这些（Production / Preview / Development 都勾上）：

| 变量 | 值 | 必填 |
|---|---|---|
| `DATABASE_URL` | 第 1 步拿到的 Neon 连接串 | ✅ |
| `BETTER_AUTH_SECRET` | 第 2 步的第一个密钥 | ✅ |
| `DEEP_STARS_SECRET` | 第 2 步的第二个密钥 | ✅ |
| `DEEP_STARS_ADMIN_EMAIL` | 你的登录邮箱（见下方说明） | ⬜ 但强烈建议 |
| `BETTER_AUTH_URL` | 先留空，部署完拿到域名再回来填 | ⬜ |
| `NEXT_PUBLIC_SITE_URL` | 同上 | ⬜ |

> ⚠️ **`DEEP_STARS_ADMIN_EMAIL` 填错等于把管理员权限给了一个陌生人。**
> 它的作用是引导出"第一个管理员"：全新数据库里没有任何管理员，
> 而第一个没法由后台自己产生。**填的必须是你自己注册时用的邮箱**，
> 且大小写不敏感。
>
> 不填也能跑，但没人能进 `/admin` —— 后面想进去就只能改数据库了。

4. 点 **Deploy**，等它跑完

---

## 第 5 步：推数据库结构

Vercel 只部署代码，**不会自动建表**。在本地用 Neon 连接串跑一次：

```bash
# 只这一次：把 DATABASE_URL 临时指向 Neon
DATABASE_URL="postgresql://…" pnpm db:push:pg
```

Windows PowerShell 写法：

```powershell
$env:DATABASE_URL="postgresql://…"; pnpm db:push:pg
```

> `db:push:pg` 会先从模板渲染出 PostgreSQL 变体的 schema，再推送。
> 目标是**一个全新的空库**，所以不会有数据丢失。
> **不要**加 `--accept-data-loss` —— 那个参数会真的删列删表。

可选：种一份计划模板与公告（新手引导的「从模板开始」要用到）：

```bash
DATABASE_URL="postgresql://…" pnpm db:seed
```

---

## 第 6 步：回填域名并重新部署

1. 复制 Vercel 给你的域名，形如 `https://deep-stars-xxx.vercel.app`
2. 回到 **Settings → Environment Variables**，把这两个填上：
   - `BETTER_AUTH_URL` = 你的域名
   - `NEXT_PUBLIC_SITE_URL` = 你的域名
3. **Deployments → 最新一次 → Redeploy**（环境变量变更需要重新部署才生效）

> 为什么必须回填：Better Auth 用它做**可信来源校验**。
> 不填的话，注册/登录会因来源不匹配被拒 —— 而且报错信息不会直说是这个原因。

---

## 第 7 步：验收

用**一台干净的浏览器**（或隐身窗口）打开你的域名，依次确认：

- [ ] 落地页正常显示（星空背景、星座连线、流星）
- [ ] 能注册 → 自动登录 → 进入观测台
- [ ] 打卡一次 → 星图上亮起一枚星
- [ ] 刷新页面 → 数据还在
- [ ] `/review` 能建一张复习卡并评分
- [ ] 设置页能保存 AI 密钥（没有的话跳过）
- [ ] 退出 → 用同一账号能重新登录
- [ ] 用**别的设备**（手机）打开同一网址 → 能看到同一个账号的数据
- [ ] 打开控制台，**没有红色报错**

最后一条特别重要：这个项目的 CSP 曾经因为漏写 `style-src` 而静默掐掉全部行内样式 ——
页面看起来"只是有点丑"，实际是安全策略在起作用。控制台里能直接看到原因。

---

## 7×7 常见问题

**构建失败，报 `prisma generate` 相关**
Vercel 上的构建命令应当是 `pnpm build`（本仓库的 `build` 脚本里已含 `prisma generate`）。
如果你在 Vercel 面板里把构建命令改成了 `next build`，把它改回去。

**登录成功但立刻跳回登录页**
`BETTER_AUTH_URL` 没填或填错（必须带 `https://`）。

**注册报来源不合法**
同上。改完环境变量要**重新部署**才生效。

**`/admin` 返回 404**
你不在管理员名单里。检查 `DEEP_STARS_ADMIN_EMAIL` 与**你注册时用的邮箱**是否完全一致。

**忘记密码了怎么办**
本项目不做邮箱验证、也没有 SMTP（这是"克隆下来两条命令就能跑"的代价）。
用重置脚本救回来：

```bash
DATABASE_URL="postgresql://…" pnpm reset-password 你的邮箱
```

它会生成一个随机强口令并打印出来，同时注销该账号的全部登录会话。

**想让别人也能用**
把网址发给他就行 —— 注册是开放的。
每个人只能看到自己的数据；只有你主动开启「公开主页」后，
`/u/<你的用户名>` 才会对外可见，且**只暴露星图与统计，不含打卡正文**。

---

## 本项目的默认安全姿态

部署完就自动生效，无需额外配置：

- 安全响应头（CSP / HSTS / X-Frame-Options / Referrer-Policy …）
- 认证接口限流（防止暴力破解）
- 导出接口限流（防止拖库式导出）
- 导出文件**不含 userId**，导入时按当前登录用户重建归属
- BYOK 密钥用 AES-256-GCM 加密后落库，明文不留在服务器

**已知的取舍**（都写在了对应代码的注释里）：

- **邮箱验证是关闭的** —— 打开需要 SMTP。所以任何人可以用任何邮箱注册
  （只要没人先注册过）。要收紧的话，得先接一个邮件服务。
- **限流是进程内存的** —— Serverless 多实例下真实上限 ≈ 配置值 × 实例数。
  能挡脚本，挡不住有耐心的攻击者。

---

## 本地上线前自检（可选，但推荐）

在推送之前，用**真实的生产构建**跑一遍，能提前发现只在生产模式下才暴露的问题
（行内样式被 CSP 掐掉、Service Worker 缓存策略、打包期报错等）：

```bash
pnpm build
pnpm start -p 3211            # 另开一个终端
REGRESS_BASE=http://127.0.0.1:3211 pnpm regress --password '你的测试账号密码'
```

它会逐个访问 12 个页面，检查标志文本、控制台报错、星野 canvas 是否绘制、
以及**横向溢出**（手机端最容易出、也最致命）。可以加 `--width 390 --height 844`
再按手机跑一遍。

### 生产模式与开发模式的两处关键差异

| | 开发 | 生产 |
|---|---|---|
| CSP 的 `script-src` | 含 `'unsafe-eval'`（React 开发版需要）| **不含** |
| `Strict-Transport-Security` | 不加 | **加**（`max-age=63072000; includeSubDomains; preload`）|
| Service Worker 缓存静态产物 | **跳过**（否则 HMR 失效）| 正常缓存 |

最后一条意味着：**离线能力只能在生产构建下验证**。开发模式下断网会看到
一个没有样式的空壳 —— 那是预期行为，不是 bug。

# 部署到 Render + Neon（Vercel 不可用时的方案）

> **为什么不用 Vercel**：Vercel 注册要求手机验证，国内号码收不到验证码，账号进不去。
> 这不是配置问题，是没法绕过的一步。
>
> 本方案用 **Render** 跑应用、**Neon** 提供数据库。Render 用 GitHub 授权登录、
> 不发验证码；免费档不要信用卡。代码一个字都不用改。

---

## ⚠️ 先看这一条：必须是 Web Service

Render 的 New 菜单里有几个长得很像的选项。**选错 Private Service 会白忙一场**：

- [Deploy for Free](https://render.com/docs/free)：「Select *Static Site*, *Web Service*, *Postgres*, or *Key Value*.
  **Other service types don't support Free instances.**」
- [Private Services](https://render.com/docs/private-services)：「private services
  **aren't reachable via the public internet**. They **do not** receive an `onrender.com` subdomain」

也就是说 **Private Service 既没有免费档，也永远拿不到公网地址** ——
构建日志一切正常，但目标（"任何人打开网址就能用"）根本不成立。

**本文的蓝图方案从根上避免了这个选择**：服务类型写在仓库里的 `render.yaml` 中。

---

## 方案一：蓝图（推荐，你只需要粘贴两个值）

仓库根目录已有 [`render.yaml`](../render.yaml)，服务类型、档位、构建/启动命令、
环境变量全部写在里面。

### 步骤

1. 确认代码已推送：
   ```bash
   git status -sb          # 看 ahead 是不是 0
   git push                # 不是 0 就推
   ```
2. Render Dashboard → **New → Blueprint**
3. 选中 `deep-stars` 仓库 → **Apply**
4. 弹出两个输入框，粘贴：
   - **`DATABASE_URL`** = 你的 Neon 连接串（`postgresql://…`，建议结尾带 `?sslmode=require`）
   - **`DEEP_STARS_ADMIN_EMAIL`** = **你自己注册时用的邮箱**
5. 等构建完成（约 3–5 分钟）→ 拿到 `https://xxx.onrender.com`

**建表**：`render.yaml` 里写了 `preDeployCommand: pnpm db:push:pg`。但**实测它在免费档上没有生效** ——
部署完成后用不存在的账号调登录接口，返回的是
`The table public.announcement does not exist`（P2021），说明表根本没建。

**所以建表这一步请自己在本地跑一次**（幂等，可重复执行）：

```powershell
$env:DATABASE_URL="postgresql://…"
pnpm db:push:pg
```

> ⚠️ 注意这条命令**必须用 pnpm**，而你系统里可能没有 pnpm（见文末"本机环境前提"）。
> 目标是**全新的空库**，不会丢数据。**不要**加 `--accept-data-loss`。

### 密钥不需要你生成

`render.yaml` 里这两个写的是 `generateValue: true`：

| 变量 | 谁生成 |
|---|---|
| `BETTER_AUTH_SECRET` | **Render 自动生成**（base64 编码的 256 位随机值）|
| `DEEP_STARS_SECRET` | **Render 自动生成**（同上）|

而且**已存在时不会被重新生成** ✓ —— 这点很关键：
`DEEP_STARS_SECRET` 一旦变化，所有已保存的 BYOK 密钥都会解不开，
而且不会报错，只在用户调用 AI 时静默失败。

### 地址也不用回填

`render.yaml` 里**刻意没有** `BETTER_AUTH_URL`。应用会依次尝试
`BETTER_AUTH_URL` → Render 注入的 `RENDER_EXTERNAL_HOSTNAME`，
并自动补上 `https://`（见 [`src/lib/site-url.ts`](../src/lib/site-url.ts)）。

于是**不必"部署完回填地址再重新部署一次"** —— 那个步骤本来就是最容易漏的。

---

## 方案二：手动填表（蓝图不可用时的备选）

Dashboard → **New → Web Service**（**不是** Private Service）→ 选中仓库。

| 字段 | 填什么 | 说明 |
|---|---|---|
| **Name** | 如 `deep-stars` | 它就是网址：`deep-stars.onrender.com` |
| **Language** | **Node** | 一般会自动识别 |
| **Branch** | **`master`** | ⚠️ 本仓库主分支是 `master`，不是 `main` |
| **Region** | 与 Neon 同区最好 | |
| **Root Directory** | **留空** | |
| **Build Command** | `pnpm install --frozen-lockfile && pnpm run build` | ⚠️ 不能只写 `next build` —— 仓库里的 `build` 脚本还含 `db:render` 与 `prisma generate` |
| **Start Command** | `pnpm run start` | ⚠️ 默认给的是 `npm start`，要改 |
| **Compute / Instance Type** | **Free** | 列表里若没有 Free，说明你不在 Web Service 表单上 |
| Health Check Path | 留空或 `/` | |
| Docker / Disk / Secret Files | **不要动** | |

### 两个密钥的生成命令

手动路径下 Render 不会替你生成，在本机跑（项目本来就要求装 Node）：

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # BETTER_AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"      # DEEP_STARS_SECRET
```

### 环境变量（五个）

| Key | Value |
|---|---|
| `DATABASE_URL` | Neon 连接串 |
| `BETTER_AUTH_SECRET` | 上面第一条命令的输出 |
| `DEEP_STARS_SECRET` | 上面第二条命令的输出 |
| `DEEP_STARS_ADMIN_EMAIL` | ⚠️ **你自己注册时用的邮箱** |
| `BETTER_AUTH_URL` | **留空**（会自动推导；只有绑自定义域名时才填） |

### 手动路径下还需要建表

蓝图会自动建表，手动路径不会。在本地跑一次：

```powershell
$env:DATABASE_URL="postgresql://…"; pnpm db:push:pg
```

> 目标是**一个全新的空库**，不会丢数据。**不要**加 `--accept-data-loss`。

---

## 可选但推荐：种一份计划模板

**这是什么**：应用里「观测台」页面在新用户第一次进来时，会显示一张引导卡，
其中有一段「或者，直接从一个现成的计划模板开始」—— 那三个模板
（考研冲刺 · 90 天 / 期末两周突击 / 编程语言自学 · 项目驱动）存在数据库的
`plantemplate` 表里。

**为什么现在是空的**：`preDeployCommand` 里的 `prisma db push` 只**建表**（结构），
不插数据（内容）。表建好了，但里面一行都没有，所以引导卡上那段不显示
—— 代码里是「没有模板就不渲染这一块」，不是出错。

**怎么补**：在本地跑一次。**必须用下面这条命令**，不能直接跑 `pnpm db:seed`：

```powershell
$env:DATABASE_URL="postgresql://…（你的 Neon 连接串）"
pnpm db:seed:pg
```

> ⚠️ 为什么不能直接 `pnpm db:seed`：
> 它用的 Prisma 客户端是**上次生成时**的版本，而你本地生成的是 **SQLite 版**。
> 拿 Postgres 连接串去跑会抛
> `The Driver Adapter '@prisma/adapter-pg' is not compatible with the provider 'sqlite'`
> —— 这句话与"你连错库了"毫无关系，却会让人往那个方向查。
> `db:seed:pg` 里封装了正确顺序：渲染 schema 变体 → 生成 Postgres 客户端 → 播种。

**跑完记得还原本地客户端**（否则本地开发会连不上 SQLite）：

```powershell
# 先关掉上面那个环境变量（或新开一个终端），然后：
pnpm db:generate
```

这条是**幂等**的（按唯一字段 upsert），重复跑不会产生重复数据，也不会碰任何用户数据 ——
它只写 `announcement`、`plantemplate`、`documenttemplate` 三张表。

**不跑会怎样**：应用完全正常，只是引导卡上少一段模板入口。之后想补随时可以。

---

## 免费档的真实限制

以下全部来自 [Render 官方免费档文档](https://render.com/docs/free)：

- **闲置 15 分钟休眠**，下次访问约 1 分钟唤醒；期间浏览器会看到 Render 的加载页
- **每月 750 实例小时**，用尽后所有免费服务挂起到下月；**休眠期间不消耗**
- **文件系统是临时的** —— 本项目数据全在数据库里（头像也是 data URL 存库），不受影响
- **休眠期间 `/robots.txt` 自动返回全站 disallow**，请求不会触达服务
- 免费 web service **不能接收私有网络流量**，但**可以发出** —— 我们走公网连 Neon，不受影响
- 支持**自定义域名**与自动 TLS 证书
- ⚠️ **官方原文**："Render may suspend a Free web service that initiates an uncommonly high
  volume of traffic over the public internet. Examples of service-initiated traffic include:
  **Accessing an external database**"
  —— 我们访问 Neon 正属此列。正常个人用量下不该触发，但**这是"免费档 + 外部数据库"的
  固有风险，提前说明**。缓解：Neon 用 **pooled** 连接串；本项目 Prisma 客户端本就是单例。

**Render 自带的免费 Postgres 会在 30 天后过期** —— 我们用 Neon，所以这条不适用。
这也是当初先建 Neon 的原因：数据库与应用的宿主要分开。

---

## 本机环境前提（实测踩到过）

本项目要求 **Node ≥ 20.19**，而且仓库用 **pnpm** 管理依赖。两样都不满足时，
那几条本地命令会以与真实原因无关的方式失败：

- **Node 版本太低**（例如 20.15）会抛 `ERR_REQUIRE_ESM: require() of ES Module …`，
  看起来像依赖装坏了，实际是 Node 太旧。
- **没装 pnpm** 时 PowerShell 直接报「无法将"pnpm"项识别为 cmdlet」。
  最省事的办法是 `corepack enable`（Node 自带）之后就能直接用 `pnpm`；
  或者用 `node` 走完整路径调用 `pnpm.cjs`。

- **两条命令要分行写**。`$env:DATABASE_URL="…" pnpm db:push:pg` 挤在同一行会报
  「表达式或语句中包含意外的标记"pnpm"」—— PowerShell 需要换行或 `;` 分隔。

---

## 故障对照表

按报错对号入座。每条都是本项目实际踩过或验证过的。

| 现象 | 原因 | 怎么办 |
|---|---|---|
| Compute 列表里**没有 Free** | 你在 **Private Service** 表单上 | 退回，选 **Web Service**；或用蓝图 |
| 部署成功但**没有 `onrender.com` 地址** | 同上，Private Service 不对外可访问 | 同上 |
| **登录按钮点了没反应** | `BETTER_AUTH_URL` 与真实来源不一致（缺 `https://`、或结尾斜杠不同） | 留空让它自动推导；或填**完整**地址后在 Render 里 Redeploy |
| 构建第一步红，提到 pnpm / lockfile | Render 用了 pnpm 12 而锁文件是 9.0 | 加环境变量 `PNPM_VERSION = 11.7.0` |
| 构建报 `tsc: not found` / `tailwindcss: not found` | 平台在构建时跳过了 devDependencies | 加环境变量 `NPM_CONFIG_PRODUCTION = false` |
| 构建报 `prisma/schema.postgres.prisma` 不存在 | Build Command 被改成了 `next build`，跳过了 `db:render` | Build Command 必须是 `pnpm run build` |
| **每次查询都 500**，日志说 adapter 与 provider 不匹配 | 仓库里的代码是旧的（该 bug 已在 `a9ad31b` 修掉） | 确认渲染的是最新提交，见下方 |
| 每次查询都 500，日志说 `Can't reach database server` | `DATABASE_URL` 不对，或没建表 | 检查连接串；跑 `pnpm db:push:pg` |
| `/admin` 返回 404 | 你不在管理员名单里 | 检查 `DEEP_STARS_ADMIN_EMAIL` 与**注册时用的邮箱**是否完全一致 |
| 第一次打开要等约一分钟 | 免费档休眠后唤醒 | 正常现象，之后一段时间内是快的 |
| 忘了密码 | 本项目不做邮箱验证、也没有 SMTP | `DATABASE_URL="postgresql://…" pnpm reset-password 你的邮箱` |

### 部署前先确认推上去了

Render 只构建**已经推到 GitHub 的提交**。本地有未推提交时，部署到的是旧代码，
而现象往往与真正的原因毫不相干（比如上表里 adapter 不匹配那条）。

```bash
git status -sb     # 形如 ## master...origin/master [ahead 2]
git push           # ahead 必须是 0
```

**看日志**：Render 控制台的 **Logs** 页同时给出构建日志与运行日志。
构建失败看构建日志最后 20 行；运行期 500 看运行日志。

---

## 部署成功后

把地址发出来，可以对线上跑一遍完整回归（本机已装好 Chrome）：

```bash
REGRESS_BASE=https://你的地址 pnpm regress --password '你注册时设的密码'
REGRESS_BASE=https://你的地址 pnpm regress --password '…' --width 390 --height 844
```

它会逐个访问 12 个页面，检查标志文本、控制台报错、星野 canvas 是否绘制、以及横向溢出。

---

## 本项目的默认安全姿态

部署完自动生效，无需额外配置：安全响应头（CSP / HSTS / X-Frame-Options …）、
认证与导出接口限流、导出文件不含 `userId`、BYOK 密钥 AES-256-GCM 加密后落库。

**已知取舍**（都写在对应代码的注释里）：

- **邮箱验证是关闭的** —— 打开需要 SMTP，那与"克隆下来两条命令就能跑"冲突
- **限流是进程内存的** —— 多实例下真实上限 ≈ 配置值 × 实例数；能挡脚本，挡不住有耐心的攻击者

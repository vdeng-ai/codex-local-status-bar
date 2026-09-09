# Codex Local Status Bar

> 一个轻量的 GNOME Shell 扩展：在顶栏直接显示 Codex 的多个配额池，只读取 Codex 已经写入本机的数据。

[English](README.md)

```text
[Codex 图标]  5h 88% / 7d 83% | Reserve 7d 100%
```

## 特点

- 顶栏可同时显示多个独立配额池，例如 Codex 与 GPT Reserve
- 显示每个池的剩余百分比、重置时间、数据更新时间
- 优先读取 `~/.codex/logs_*.sqlite` 中 Codex 已经记录的 response headers
- `~/.codex/sessions/**/*.jsonl` 作为自动 fallback（也支持 `$CODEX_HOME/sessions`）
- 不读取 `~/.codex/auth.json`
- 不处理 access token / refresh token / cookie / API key
- 不请求 OpenAI、ChatGPT 或第三方接口
- 使用异步 Gio 文件 I/O，避免阻塞 GNOME Shell
- 顶栏位置可选 **Left / Right**
- 字号可选 **12–32 px**，使用数字步进控件
- 本地刷新间隔可选 **15 / 30 / 60 / 120 秒**
- 支持手动刷新
- GNOME 原生 Preferences 设置界面
- 无 telemetry、analytics、后台 daemon；`sqlite3` 仅作为可选的只读本地日志读取工具

## 工作原理

新版 Codex 会把较新的 quota 信息写在 HTTP response headers 中，同时这些 headers 又会进入本机 `logs_*.sqlite`。session JSONL 仍然保留较旧/会话级 snapshot。因此扩展现在使用两层本地数据源：

```text
~/.codex/logs_*.sqlite ── sqlite3 -readonly ──┐
                                             ├─ 多配额池 parser ── GNOME 顶栏
~/.codex/sessions/**/*.jsonl ── 异步 fallback ┘
```

正常 Codex 配额池与 `base_model_inference / gpt-reserve` 会分别显示，不再互相覆盖。

因此不需要复用 Codex 登录态，也不需要自行刷新 OAuth token 或调用私有 backend API。

## 设置

默认配置：

- 位置：Right
- 字号：14 px
- 刷新：30 秒

打开设置：

```bash
gnome-extensions prefs codex-local-status-bar@vdeng-ai.github.io
```

## 环境要求

- GNOME Shell 46–50
- 主要测试环境：Ubuntu 24.04 / GNOME Shell 46
- Codex CLI / Codex App 已经在本机写入本地 Codex 数据
- 推荐安装 `sqlite3` 以读取更新更及时的 `logs_*.sqlite`；没有时会自动回退到 session JSONL

检查：

```bash
gnome-shell --version
command -v sqlite3
find ~/.codex -maxdepth 1 -type f -name 'logs_*.sqlite' -print
find ~/.codex/sessions -type f -name '*.jsonl' | head
```

## 安装

### GitHub Release

从 GitHub Releases 下载最新：

```text
codex-local-status-bar@vdeng-ai.github.io.shell-extension.zip
```

安装：

```bash
gnome-extensions install --force \
  codex-local-status-bar@vdeng-ai.github.io.shell-extension.zip
```

然后正常 **注销 → 重新登录**，必要时手动启用：

```bash
gnome-extensions enable codex-local-status-bar@vdeng-ai.github.io
```

### 源码安装

```bash
git clone https://github.com/vdeng-ai/codex-local-status-bar.git
cd codex-local-status-bar
bash install.sh
```

然后注销并重新登录。

> 不建议用 `Alt+F2 → r` 更新本扩展。多个第三方 GNOME 扩展同时存在时，原地重启 Shell 可能卡住。

## 从早期开发版升级

早期本地测试版 UUID 为：

```text
codex-local-status-bar@vdeng.local
```

现在公开发行 UUID 固定为：

```text
codex-local-status-bar@vdeng-ai.github.io
```

`install.sh` 会自动迁移旧 UUID。GSettings schema 没有变化，因此位置、字号、刷新间隔等设置可以继续保留。

## 开发与测试

```bash
npm test
npm run check
npm run smoke:reader
npm run smoke:gnome
```

`smoke:gnome` 会启动一个隔离的 nested GNOME Shell，不会直接修改主桌面，用来验证扩展是否能达到：

```text
State: ACTIVE
```

测试还会阻止运行时代码意外加入：

- HTTP/HTTPS
- `fetch()` / libsoup
- `auth.json`
- OAuth/token 处理
- GNOME Shell 同步文件 I/O

## GNOME Extensions 商店

计划提交到 [extensions.gnome.org](https://extensions.gnome.org/)。目前项目已经按 GNOME 审核方向处理了：

- `enable()` / `disable()` 生命周期
- 异步文件 I/O
- 原生 GSettings / Preferences
- 无 telemetry
- 不捆绑任何二进制；本机 `sqlite3` 仅作为可选只读工具

在正式通过审核前，以 GitHub Releases 为主要分发渠道。

## 安全模型

详见 [SECURITY.md](SECURITY.md)。

本扩展只展示 Codex 已经落盘的 quota metadata：优先读取本地 response-log headers，session JSONL 作为 fallback。不会把 prompt、模型输出、tool call、cookie 或凭据显示到 UI，也不会自己请求 OpenAI。

## 致谢

顶栏交互参考：[`ondrejbecva/codex-claude-status-bar`](https://github.com/ondrejbecva/codex-claude-status-bar)

本地 session 数据架构参考：[`Almighty-Shogun/codex-gnome-extension`](https://github.com/Almighty-Shogun/codex-gnome-extension)

## 免责声明

本项目为非官方独立项目，与 OpenAI 无隶属或背书关系。OpenAI、ChatGPT 和 Codex 为 OpenAI 的商标。

## License

[MIT](LICENSE)

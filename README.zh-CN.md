# ompgui

[English](./README.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [简体中文](./README.zh-CN.md)

[oh-my-pi (omp) 编程智能体](https://github.com/can1357/oh-my-pi)的本地 Web UI。ompgui 读取本机的 omp 会话文件，在浏览器中提供一个工作区，支持会话浏览、实时对话、模型配置、技能管理和项目文件预览。

![ompgui — 浅色主题](docs/screenshot-light.png)

<details>
<summary>深色主题与命令面板</summary>

![ompgui — 深色主题](docs/screenshot-dark.png)

</details>

## 环境要求

- 已安装 [omp](https://github.com/can1357/oh-my-pi) 且在 `PATH` 中（或通过 `OMP_WEB_OMP_BIN` 指向其二进制文件）
- Node.js 22.19.0 或更高版本（`node --version`）

## 快速开始

**无需安装直接运行：**

```bash
npx ompgui@latest
```

**或全局安装：**

```bash
npm install -g ompgui
ompgui
```

可使用 `ompgui update` 更新全局安装。

然后打开 [http://127.0.0.1:30177](http://127.0.0.1:30177)。服务器就绪后，CLI 会尝试自动打开浏览器。ompgui 默认监听 `127.0.0.1`。

**选项：**

```bash
ompgui --port 8080              # 自定义端口
ompgui --hostname 0.0.0.0       # 在可信网络中暴露服务
ompgui -p 8080 -H 0.0.0.0       # 组合使用
ompgui --no-open                # 不自动打开浏览器

ompgui --password "a-long-random-password" # 启用仅密码登录（Windows 同样适用）

PORT=8080 ompgui                # 也支持环境变量
OMP_WEB_HOSTNAME=0.0.0.0 ompgui # 显式暴露到网络
OMP_WEB_PASSWORD='a-long-random-password' ompgui # 环境变量形式（POSIX）
# Windows: $env:OMP_WEB_PASSWORD="secret"; ompgui
OMP_WEB_NO_OPEN=1 ompgui        # 作为后台服务运行时很有用
```

设置 `OMP_WEB_PASSWORD` 可通过与主题集成的仅密码登录页面保护界面和所有 API 端点。登录成功后，会创建有效期为 30 天的 HTTP-only 签名会话 Cookie；留空则关闭认证。远程访问仍需通过受信任反向代理或 VPN 提供 HTTPS，以保护密码和会话 Cookie。默认仅监听 `127.0.0.1`；不要将 ompgui 直接暴露到互联网。

## 远程与移动端访问（推荐使用 Tailscale）

从移动设备（iPhone、iPad、Android）或外部笔记本访问 `ompgui` 时，**强烈推荐使用 [Tailscale](https://tailscale.com/) 虚拟专用网（VPN）**。它通过端到端加密的点对点 Mesh 网络连接设备，无需端口转发或暴露公网 IP。

### 1. 配置访问密码（远程访问必备）

当绑定到外部网络接口时，必须配置密码以保护工作区：

```bash
# CLI 选项：绑定到所有网络接口并设置密码
ompgui -H 0.0.0.0 --password "your-strong-password"

# 或通过环境变量设置
OMP_WEB_HOSTNAME=0.0.0.0 OMP_WEB_PASSWORD="your-strong-password" ompgui
```

### 2. Tailscale 连接步骤

1. **安装 Tailscale**：在宿主电脑和移动设备上安装 [Tailscale](https://tailscale.com/download) 并登录同一账户。
2. **在宿主电脑上启动 ompgui**：
   ```bash
   ompgui --hostname 0.0.0.0 --password "your-strong-password"
   ```
3. **在移动端浏览器中访问**：
   - 访问宿主电脑的 Tailscale IP（如 `100.x.y.z`）或 MagicDNS 机器名：
     ```text
     http://100.x.y.z:30177
     # 或启用 MagicDNS 时
     http://my-macbook:30177
     ```
4. **登录**：输入设置的密码即可在移动设备上安全地与编程智能体进行实时交互与操作。

## 功能特性

- **随时接续之前的工作**：按项目浏览以往的 omp 对话，不必翻找终端历史或会话文件路径。
- **放心尝试不同方向**：从更早的消息继续，或将会话分叉为一条独立路线。
- **整理侧边栏**：归档不活跃会话而不删除原生记录，或在不再需要时明确删除。
- **跨分支工作**：在侧边栏切换 Git 工作树，新会话和资源管理器都会跟随你选择的检出。
- **边看项目边聊天**：左侧浏览文件，右侧预览源码、文档、图片、音频和 PDF，同时智能体继续工作。
- **清晰掌握会话状态**：上下文用量、费用、压缩上下文状态和系统提示词详情都显示在顶栏。
- **减少对终端配置的依赖**：在 Web UI 中管理模型、登录/API 密钥、模型测试、原生 OMP 控制（顾问、审批、Bash 策略、思考、压缩、记忆、自动学习、重试/回退）、技能、插件和项目 MCP 服务器。
- **在设置中管理 MCP**：专用 MCP 标签页显示项目服务器状态（已启用 / 已禁用 / 无效），支持添加、编辑、重命名、校验和删除，并通过角落提示显示配置失败。
- **保持 OMP 为最新版本**：可在设置中检查已安装运行时、更新它，并按需重启活动会话。
- **及时获知完成状态**：可选择在智能体完成时接收浏览器通知，并检查已安装技能的更新。
- **⌘K 随处跳转**：命令面板（⌘K / Ctrl+K）支持切换会话、新建会话和切换主题。
- **温暖的纸感设计**：浅色/深色双主题，衬线展示字体，对比度经 WCAG AA 验证，基于令牌驱动的 UI 套件（Base UI 基元、cmdk、lucide 图标）构建。

## 配置

| 变量 | 含义 |
| --- | --- |
| `PORT` | 服务器端口（默认 `30177`；`-p/--port` 优先） |
| `OMP_WEB_HOSTNAME` | 绑定主机名（默认 `127.0.0.1`；`-H/--hostname` 优先） |
| `OMP_WEB_PASSWORD` | 登录页面使用的可选密码 |
| `OMP_WEB_NO_OPEN` | 设为 `1`/`true` 可跳过自动打开浏览器 |
| `OMP_WEB_OMP_BIN` | `omp` 不在 `PATH` 中时，指向其二进制文件的绝对路径 |
| `PI_CODING_AGENT_DIR` | 指向其他 omp agent 目录（默认 `~/.omp/agent`） |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | 服务器端请求使用的标准代理变量 |

## 架构

ompgui 是一个由 Node 托管的 Next.js 应用，驱动你已安装的 `omp` 二进制文件——它并不内嵌智能体：

- **实时会话**：启动 `omp --mode rpc-ui`（基于 stdio 的 NDJSON），每个活动会话对应一个子进程，因此智能体版本始终与你安装的完全一致。
- **会话浏览**：直接读取 omp 的会话文件（`~/.omp/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`）；标题、归档和删除是受保护的原生文件维护操作，不会与 OMP 的实时写入竞争。
- **模型与认证**：通过 RPC 命令与 omp 子进程交互；模型面板编辑 omp agent 目录中的 `models.yml`。
- **技能与插件**：扫描 omp 的技能目录（`~/.omp/agent/skills`、项目内 `.omp/skills` 及兼容目录），并调用 `omp plugin` 进行插件管理。
- **文件访问**：文件浏览与预览仅限于所选项目目录以及会话中出现过的工作目录。
- **分叉与会话内分支**：分叉会创建新的 `.jsonl` 文件；“从此处编辑”则在同一会话文件内创建另一个分支。

## 开发

```bash
npm install
npm run dev
```

本地开发服务器运行在 [http://127.0.0.1:30178](http://127.0.0.1:30178)。

常用检查：

```bash
npm run typecheck      # 类型检查
npm run lint           # ESLint（零警告）
npm test               # 运行测试套件
npm run build          # 生产构建
```

本地开发时请避免运行 `next build` / `npm run build`。它会写入 `.next/`，可能干扰开发服务器；构建请留到发布阶段。

## 多语言支持

ompgui 支持英语、简体中文、日本語和韩语（한국어），四种语言均覆盖整个界面的翻译字符串。语言从 `navigator.language` 自动检测，可通过顶栏的语言菜单在运行时切换。选择会跨会话持久化。

- 字典文件：`lib/i18n/locales/{en,zh-CN,ja,ko}.json`
- 框架：`lib/i18n/index.tsx` — 基于 `useSyncExternalStore` 的轻量 store，支持 `{var}` 插值和复数形式（`.one`/`.other`）
- API 错误消息通过稳定的错误码（`errors.<code>`）在客户端翻译

## 质量

- **可访问性**：符合 WCAG AA 标准 — Lighthouse 可访问性评分 100/100，全键盘导航，焦点可见环，ARIA 角色
- **性能**：列表组件 memo 化、RAF 节流滚动/鼠标处理、防抖搜索、流式 JSONL 读取器、ETag 缓存会话列表
- **健壮性**：优雅关闭 omp 子进程（进程组杀死）、错误边界、原子化会话文件重写
- **测试**：聚焦的测试套件覆盖会话解析、终端输入、Markdown 渲染、消息展示、原生设置和 MCP 配置

## 致谢

ompgui 分叉自 [agegr/pi-web](https://github.com/agegr/pi-web)（MIT）——[badlogic/pi-mono](https://github.com/badlogic/pi-mono) pi 编程智能体的 Web UI，并针对 [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) 进行了适配。

## 许可证

MIT

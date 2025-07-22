# Console Puppeteer 自动化工具

这是一个基于 Puppeteer 的自动化工具，用于批量重新保存 Trantor 控制台中的场景页面。通过自动化的方式，可以快速地对大量场景进行保存操作，提高工作效率。

## 功能特点

- 支持从菜单、模块或单个模块获取场景列表
- 支持并行处理多个场景
- 自动解锁和锁定场景
- 自动保存场景
- 失败重试机制
- 详细的错误日志记录

## 环境要求

- Node.js
- pnpm

## 环境变量配置

在 `.env` 文件中配置以下环境变量：

### 必需配置

- `HOST`: 控制台访问地址，例如：`https://console.example.com`
- `COOKIE_NAME`: Cookie 名称，用于身份验证
- `COOKIE_VALUE`: Cookie 值，用于身份验证
- `COOKIE_DOMAIN`: Cookie 域名，例如：`.example.com`
- `TEAM_ID`: 团队 ID，用于标识当前操作的团队

### Cookie 获取说明

1. 打开浏览器开发者工具（Chrome/Edge 按 F12 或右键 -> 检查）
2. 切换到 "Application"（应用程序）或 "Storage"（存储）标签
3. 在左侧找到 "Cookies" 或 "存储" -> "Cookies"
4. 选择你的域名
5. 找到对应的 Cookie 名称（通常是 session 或类似名称）
6. 复制 Cookie 的值和域名

或者使用控制台命令获取：```javascript
// 在浏览器控制台执行以下命令获取所有 cookie
document.cookie.split(';').map(cookie => cookie.trim()).forEach(cookie => console.log(cookie));

````

### 场景来源相关配置

根据不同的场景来源方式，需要配置不同的环境变量：

#### 从菜单获取场景
- `PROTAL_KEY`: 门户 ID，用于获取菜单列表

#### 从单个模块获取场景
- `APP_ID`: 应用 ID，用于指定要处理的模块

#### 从所有模块获取场景
无需额外配置

### 可选配置

- `BRANCH_ID`: 分支 ID，如果需要在特定分支下操作，则需要配置
- `PARALLEL_COUNT`: 并行处理的场景数量，默认为 3

### 示例配置

```env
# 基础配置
HOST=https://console.example.com
COOKIE_NAME=session
COOKIE_VALUE=your-cookie-value
COOKIE_DOMAIN=.example.com
TEAM_ID=team-123

# 从菜单获取场景
PROTAL_KEY=portal-456

# 从单个模块获取场景
APP_ID=app-789

# 可选配置
BRANCH_ID=branch-101
PARALLEL_COUNT=3
````

## 安装和运行

### 安装依赖

```bash
# 安装项目依赖
pnpm install

# 构建项目
pnpm build
```

### 运行脚本

根据不同的场景来源方式，使用不同的命令运行：

1. 从菜单获取场景：

```bash
pnpm start:menu
```

2. 从所有模块获取场景：

```bash
pnpm start:modules
```

3. 从单个模块获取场景：

```bash
pnpm start:module
```

### 命令行参数

所有运行命令都支持以下参数：

- `--from <source>`: 指定场景来源，可选值：
  - `menu`: 获取门户菜单下的场景（默认），需要提供PROTAL_KEY
  - `modules`: 获取所有模块下的场景
  - `module`: 获取指定模块下的场景，需要提供APP_ID
- `--parallel <number>`: 设置并行处理的场景数量，默认为 4
- `--timeout <number>`: 设置每个场景的超时时间（毫秒），默认为 30000
- `--headless <boolean>`: 是否使用无头模式，默认为 true

例如：

```bash
# 从菜单获取场景，设置并行数为 5，超时时间为 60 秒，不使用有界面模式
pnpm start --from menu --parallel 5 --timeout 60000 --headless true

# 从所有模块获取场景
pnpm start --from modules

# 从指定模块获取场景
pnpm start --from module
```

### 注意事项

1. 首次运行前请确保已经正确配置了 `.env` 文件
2. 建议先用少量场景测试（可以通过设置较小的 `PARALLEL_COUNT` 值）
3. 如果遇到权限问题，请检查 Cookie 是否有效
4. 运行过程中请勿关闭终端，以免中断处理
5. 处理结果和错误日志会保存在 `logs` 目录下

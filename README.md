# red · 小红书直播自动录制与上传系统

自动化监控小红书直播 → 解析原画流 → 多引擎录制 → 合并/转码 MP4 → rclone 上传 PikPak。

- 直播流解析移植自 [biliLive-tools](https://github.com/renmu123/biliLive-tools) 的 `StreamGet` / `XHSRecorder`
- 下载引擎：**FFmpeg**（默认）/ mesio / 录播姬 (BililiveRecorder.Cli)，可全局或单主播切换
- 云同步：调用宿主机 `/usr/bin/rclone`（通过卷挂载），支持 **move / copy** 两种模式，默认 **move**（上传完成自动删除本地）
- Web UI：主播 / 文件 / 后处理 / 设置，手机浏览器响应式适配
- 部署：Docker 一键构建，docker-compose 拉起

---

## 目录结构

```text
red/
├── README.md
├── Dockerfile
├── docker-compose.yml
├── package.json              # npm workspaces 根
├── .env.example
├── scripts/
│   ├── entrypoint.sh         # 容器入口（PUID/PGID 权限修正）
│   ├── deploy.sh             # 宿主机一键部署
│   └── install-tools.sh      # 非 Docker 环境工具安装
├── server/                   # Express + SQLite 后端
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── xhs/              # 小红书拉流解析（核心）
│       │   ├── api.ts        # usersearch / 拉流 / 签名
│       │   ├── http.ts       # HTTP 客户端（undici）
│       │   ├── parser.ts     # URL/短链/主页解析器
│       │   └── types.ts
│       ├── services/         # 业务服务
│       │   ├── monitor.ts    # 轮询监控（自动开播检测）
│       │   ├── recorder.ts   # 三引擎录制 + 切片
│       │   └── postprocess.ts # 转码 + 后处理脚本执行
│       ├── routes/           # REST API
│       │   ├── streamers.ts
│       │   ├── files.ts
│       │   ├── settings.ts
│       │   ├── postprocess.ts
│       │   └── system.ts
│       ├── db/index.ts       # SQLite 数据库层
│       ├── config.ts         # 配置加载/保存
│       ├── types.ts          # 共享类型
│       └── utils.ts          # 工具函数
├── client/                   # Vue3 + Vite 前端
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── views/
│       │   ├── StreamersView.vue
│       │   ├── FilesView.vue
│       │   ├── PostProcessView.vue
│       │   └── SettingsView.vue
│       ├── api.ts            # 前端 API 封装
│       ├── router.ts
│       ├── types.ts
│       └── styles.css
├── data/                     # 运行时数据库（卷）
├── recordings/               # 本地录像（卷）
├── logs/
└── config/rclone/            # rclone.conf（卷）
```

---

## 前置要求

- **Docker** 20.10+ 和 **docker compose** v2
- **宿主机安装 rclone**：`sudo apt install rclone`（容器通过卷挂载调用宿主机 rclone）
- 小红书账号 Cookie（含 `a1` 和 `web_session`）——用于自动发现每场直播变化的 roomId
- PikPak 账号（或其他 rclone 支持的网盘）

---

## 部署（Docker Compose）

**部署顺序必须严格遵循以下步骤**，rclone 配置需要在构建容器前完成，否则容器内无法读取 rclone.conf。

### 方式 A：一键脚本（推荐）

```bash
curl -fsSL https://raw.githubusercontent.com/rsxbgdurxbjcx-arch/red/main/scripts/deploy.sh -o /tmp/deploy.sh
chmod +x /tmp/deploy.sh && /tmp/deploy.sh
```

脚本会自动完成：Docker 安装 → rclone 安装/检查 → 拉取代码 → 引导 rclone 配置 → 构建镜像 → 启动容器 → 全链路验证。

### 方式 B：手动分步部署

#### 1. 安装 Docker（如已安装跳过）

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) \
  signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker "$USER"
# 退出重新登录使 docker 组生效
```

#### 2. 安装宿主机 rclone

```bash
# rclone 官方一键安装脚本（发行版仓库版本过旧，不支持 PikPak）
curl -fsSL https://rclone.org/install.sh | sudo bash

# 验证安装
rclone version
```

#### 3. 配置 PikPak remote

```bash
rclone config
```

交互流程：

- `n`（new remote）
- 名称：`pikpak`
- 类型：输入 `pikpak`（或选择对应编号）
- user：PikPak 邮箱
- pass：PikPak 密码（选择 `y` 手动输入，完成后确认）
- 一路默认回车 → `y` 保存 → `q` 退出

**验证 rclone 配置可连接**：

```bash
rclone lsd pikpak:
# 应列出 PikPak 根目录内容（空目录也可以）

rclone mkdir pikpak:red
# 创建 red 文件夹，无报错即成功
```

#### 4. 克隆仓库并准备目录

```bash
git clone https://github.com/rsxbgdurxbjcx-arch/red.git ~/red
cd ~/red
mkdir -p data recordings logs config/rclone
```

#### 5. 复制 rclone 配置到项目目录

```bash
cp ~/.config/rclone/rclone.conf ./config/rclone/rclone.conf
chmod 600 ./config/rclone/rclone.conf
```

> 这一步是 rclone 上传的关键：容器通过卷挂载 `./config/rclone:/config/rclone` 读取配置。

#### 6. 构建镜像并启动

```bash
docker compose build --no-cache
docker compose up -d
```

#### 7. 验证部署

```bash
# 7a. 应用健康检查
curl http://127.0.0.1:3780/api/health
# → {"ok":true,"message":"red ok","version":"1.0.0"}

# 7b. 系统状态（确认 rclone 可用）
curl http://127.0.0.1:3780/api/system/status | python3 -m json.tool
# 确认 "tools": { "rclone": true, ... }

# 7c. 容器内 rclone 远端连通性
docker compose exec red rclone lsd pikpak: --config /config/rclone/rclone.conf

# 7d. 浏览器访问
# http://<服务器IP>:3780
```

---

## 单独 Docker 部署

```bash
docker build -t red .

docker run -d \
  --name red \
  --restart unless-stopped \
  -p 3780:3780 \
  -v ~/red/data:/data \
  -v ~/red/recordings:/recordings \
  -v ~/red/logs:/logs \
  -v ~/red/config/rclone:/config/rclone \
  -v /usr/bin/rclone:/usr/bin/rclone:ro \
  -e PUID=1000 \
  -e PGID=1000 \
  -e TZ=Asia/Shanghai \
  red

# 验证
curl http://127.0.0.1:3780/api/health
docker exec red rclone lsd pikpak: --config /config/rclone/rclone.conf
```

> 如果 rclone 安装在 `/usr/local/bin/rclone`，修改挂载路径为 `-v /usr/local/bin/rclone:/usr/bin/rclone:ro`

---

## rclone 配置说明

rclone 仅安装在宿主机，容器通过卷挂载（`/usr/bin/rclone:/usr/bin/rclone:ro`）调用宿主机 rclone。
配置文件通过 Docker 卷 `./config/rclone:/config/rclone` 挂载到容器内。

### 首次配置

```bash
# 宿主机配置 PikPak
rclone config
# → n → pikpak → 类型 pikpak → 邮箱 → 密码 → y 保存 → q

# 验证远端连通
rclone lsd pikpak:
rclone mkdir pikpak:red

# 复制配置到项目
cp ~/.config/rclone/rclone.conf ./config/rclone/rclone.conf
chmod 600 ./config/rclone/rclone.conf

# 重启容器使配置生效
docker compose restart red

# 容器内验证
docker compose exec red rclone lsd pikpak: --config /config/rclone/rclone.conf
```

### 重新配置

```bash
rclone config
cp ~/.config/rclone/rclone.conf ./config/rclone/rclone.conf
docker compose restart red
```

---

## Web UI 首次配置

1. 浏览器打开 `http://<服务器IP>:3780`
2. **设置** → 粘贴小红书 Cookie（需含 `a1` + `web_session`）
3. **设置** → 轮询间隔（默认 30 秒）、时长切片（默认 `03:00:00`）、下载器 `ffmpeg`
4. **后处理** → 远程名 `pikpak`、根目录 `red`、模式 `move`
5. **主播** → 添加小红书主页或直播分享链接

---

## 直播间地址格式

| 类型 | 示例 |
|------|------|
| 主页链接 | `https://www.xiaohongshu.com/user/profile/5a3b2e1f4eacab1b2c3d4e5f` |
| 直播链接 | `https://www.xiaohongshu.com/livestream/570180068897685033` |
| 分享短链 | `http://xhslink.com/m/5OUfMYyJsAz` |

**注意**：小红书 roomId **每场直播会变化**。必须配置 Cookie（含 `a1` + `web_session`）才能自动发现新场次的 roomId。未配置 Cookie 时，需手动填入当前直播的 roomId。

---

## 小红书拉流逻辑

```text
URL/短链 → 解析 roomId / userId
Cookie + redId → usersearch 发现最新 roomId（每场变化）
GET https://www.xiaohongshu.com/livestream/{roomId}  (iOS UA)
解析 window.__INITIAL_STATE__
liveStatus === "success" 且标题不含「回放」
拼 CDN:
  FLV  http://live-source-play.xhscdn.com/live/{roomId}.flv
  HLS  http://live-source-play.xhscdn.com/live/{roomId}.m3u8
优先 FLV 原画录制
```

---

## 自动上传机制

录制完成后**自动触发** rclone 上传到 PikPak，无需手动操作。

| 触发时机 | 说明 |
|----------|------|
| 下播 (`stream_end`) | 直播流中断或主播主动下播时自动上传收尾片段 |
| 手动暂停 (`manual_stop`) | 点击「停录」后自动上传当前片段 |
| 时长切片 (`segment`) | 达到切片时长（默认 3 小时）后自动上传已完成片段 |

默认调用宿主机 `/usr/bin/rclone`（通过卷挂载），配置文件从 `/config/rclone/rclone.conf` 读取（宿主机 `./config/rclone/rclone.conf`）。模式默认 `move`（上传即删本地），可在「后处理」页面调整。

---

## rclone 上传模式

| 模式 | 行为 |
|------|------|
| **move**（默认） | `rclone move` 上传后自动删除本地文件 |
| **copy** | `rclone copy` 上传后保留本地副本 |

上传目录结构：

```text
PikPak/
└── red/                    # ← rcloneRemotePath
    └── <主播名>/
        └── <主播名>_20260712_153000_s000.mp4
```

---

## 下载引擎

| 引擎 | 说明 |
|------|------|
| **FFmpeg** | 默认，稳定，直接拉 FLV/HLS 流写入文件 |
| **mesio** | 第三方 CLI，需手动挂载二进制到容器 `/usr/local/bin/mesio` |
| **录播姬** | BililiveRecorder.Cli，需手动挂载到容器 `/usr/local/bin/BililiveRecorder.Cli` |

引擎缺失时**自动回退 FFmpeg**。

---

## 运维命令

```bash
# 查看日志
docker logs -f red

# 重启
docker restart red

# 停止并删除
docker compose down

# 更新（拉最新代码重建）
git pull
docker compose build --no-cache
docker compose up -d

# 查看容器状态
docker compose ps

# 进入容器
docker compose exec red sh
```

---

## API 协议

统一响应格式：`{ ok: boolean, data?: T, error?: string, message?: string }`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/system/status` | 系统状态（运行时间、录制数、工具可用性） |
| POST | `/api/system/monitor/restart` | 重启监控循环 |
| GET | `/api/streamers` | 主播列表 |
| POST | `/api/streamers` | 添加主播 |
| GET | `/api/streamers/:id` | 获取主播详情 |
| PUT | `/api/streamers/:id` | 更新主播 |
| DELETE | `/api/streamers/:id` | 删除主播 |
| POST | `/api/streamers/:id/check` | 手动检测开播状态 |
| POST | `/api/streamers/:id/start` | 触发检测+开录 |
| POST | `/api/streamers/:id/stop` | 停止录制 |
| GET | `/api/files` | 录制文件列表 |
| DELETE | `/api/files/:id` | 删除文件（含物理文件） |
| POST | `/api/files/:id/upload` | 手动上传到网盘 |
| POST | `/api/files/sync` | 同步磁盘文件到数据库 |
| GET | `/api/settings` | 获取全局设置 |
| PUT | `/api/settings` | 更新全局设置 |
| POST | `/api/settings/reset` | 恢复默认设置 |
| GET | `/api/postprocess/config` | 获取后处理配置 |
| PUT | `/api/postprocess/config` | 更新后处理配置 |
| GET | `/api/postprocess/jobs` | 后处理任务记录 |
| POST | `/api/postprocess/run/:fileId` | 手动执行后处理 |
| GET | `/media/*` | 本地录像流媒体预览 |

---

## 后处理脚本

默认后处理脚本使用 `rclone move` 上传到 PikPak。可自定义 Shell 脚本。

可用环境变量：

| 变量 | 说明 |
|------|------|
| `RED_FILE_PATH` | 本地视频绝对路径 |
| `RED_FILE_NAME` | 文件名 |
| `RED_STREAMER` | 主播名（安全化处理） |
| `RED_REMOTE` | rclone 远程名（默认 `pikpak`） |
| `RED_REMOTE_ROOT` | 网盘根目录（默认 `red`） |
| `RED_TRIGGER` | 触发类型：`stream_end` / `manual_stop` / `segment` / `manual` |
| `RED_RCLONE_MODE` | 上传模式：`move` / `copy` |
| `RED_DELETE_LOCAL` | 是否删除本地：`1` / `0` |

---

## 权限说明

- 容器以 `node` 用户运行，默认 UID/GID=1000
- 通过 `PUID`/`PGID` 环境变量可匹配宿主机文件权限
- 录制文件属主自动修正为 `PUID:PGID`
- rclone 配置文件权限自动设为 `600`

---

## License

仅供学习与自用录制。请遵守小红书用户协议与当地法律法规。

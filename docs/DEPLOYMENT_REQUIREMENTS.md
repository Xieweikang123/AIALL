# AIALL 公网部署需求

## 背景

AIALL 是 Tauri 2 + Vue 3 桌面应用,核心功能(Agent 编程 / Git / 文件读写 / 桌面自动化)依赖本机 Rust 后端(Tauri `invoke`)。当前浏览器模式(`npm run dev:web`)仅为 UI 预览,Agent / Git / 文件功能不可用(见 `src/views/VibeCodingView.vue:4`)。

目标是将项目部署到公网服务器,可通过浏览器公网访问并使用完整功能。

## 服务器信息

| 项 | 值 |
|------|------|
| IP | <SERVER_IP> |
| SSH | `root@<SERVER_IP>`(已用密钥免密登录验证,端口 22 连通) |
| 访问地址 | `http://<SERVER_IP>:8088` |
| 端口 | 8088(阿里云安全组已放行;80 已被 nginx 占用) |
| HTTPS | 暂不启用(无域名),后续再补域名 + 证书 |

## 需求

1. 将项目部署到上述服务器,支持公网浏览器访问。当前无域名,**暂用 `http://IP:8088` 直连**(浏览器会提示"不安全",点继续访问即可),后续再补域名 + HTTPS 证书。
2. 公网访问需能使用**完整 Agent 功能**(在服务器上的项目上执行 Agent / Git / 文件操作),而非仅 UI 预览。
3. 需完成桌面应用到 Web 服务的架构改造:
   - 增加 HTTP 后端(如 Rust Axum/Actix 包装 `src-tauri/src/` 现有命令)
   - 前端浏览器运行时由 Tauri invoke 切换到 HTTP 调用(`src/services/tauriInvoke.ts`)
4. 安全要求(公网暴露 Agent 可执行任意 shell 命令 / 读写任意文件):
   - 用户认证(登录)
   - 项目沙箱 / 命令白名单,防止服务器被攻破
   - AI API Key 保存在服务端,不下发到浏览器
5. 桌面自动化能力(截图 / 鼠标点击 / 模板匹配)在服务器上无桌面环境,可移除或降级。
6. 服务器环境:Alibaba Cloud Linux 3,内存 1.8G(可用约 880M)、磁盘 40G(剩 22G)。已装 Docker / Node 20 / Nginx。内存紧张,注意资源占用。Rust 后端建议本地/CI 交叉编译再上传,勿在服务器上 cargo build。
7. 服务器已有 nginx(80)、postgres(5432)、docker 容器(emqx/rabbitmq 等)、xray(10086)等占用,部署时避开这些端口。

## 分工说明

- 代码改造由另一个 agent 负责,本文档仅记录需求,不作为改造执行方。
- 本文档由本次对话整理,部署与改造完成后,`dev:web` 预览提示与相关限制需随之更新。

## 当前状态(2026-08-15)

- [ ] 架构改造(HTTP 后端 + 前端切流)
- [ ] 鉴权与沙箱
- [ ] 服务端 AI Key 管理
- [ ] 公网部署(HTTP :8088,暂不启用 HTTPS)
- [ ] 公网访问验证(Agent / Git / 文件)

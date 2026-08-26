# 小眠 MQTT MVP

独立于 `sleep-api` 的设备接入。生产与 App 后端 **同一台 CVM**（`/root/sleep-mqtt`），进程分开。

```
设备  --mqtt://HOST:1883-->  sleep-mqtt（内嵌 Broker）
                                |
                           HTTP :8790 鉴权 / 入库
```

本机和生产默认都是 **1883 无 TLS**。上量后再加 `8883`。

仓库：https://github.com/7dcf7qsx2r-cmd/sleep-mqtt

## 本机启动（不必 Docker）

```bash
cd auth
npm install
npm run start:local
npm run pub
curl -H "Authorization: Bearer dev-admin-token" http://127.0.0.1:8790/v1/messages
```

可选 EMQX：`docker compose -f docker-compose.emqx.yml up --build`

## 生产部署

与 `sleep-api` 同机：`119.29.148.43`。`main` 推送后 GitHub Actions 会 rsync 到 `/root/sleep-mqtt`，用 podman/docker compose 起容器。

| 入口 | 地址 |
|---|---|
| MQTT | `mqtt://119.29.148.43:1883` |
| 健康检查 | `http://119.29.148.43:8790/health` |
| 管理 API | `http://119.29.148.43:8790` |

腾讯云安全组需放行 **TCP 1883、8790**。生产 `ADMIN_TOKEN` / 设备密钥在 GitHub Secrets，不要用下面的 demo 密码。

手动触发：GitHub → Actions → Deploy Production → Run workflow。

## 演示设备（仅本机）

| 项 | 值 |
|---|---|
| productKey | `xiaomian_mvp` |
| MQTT | `mqtt://127.0.0.1:1883` |
| sn | `SNDEMO0001` |
| clientId | `xiaomian_mvp.SNDEMO0001` |
| username | `SNDEMO0001` |
| password | `demo-device-secret` |
| 上报 Topic | `xiaomian_mvp/SNDEMO0001/up/realtime` |

## 规则

- `clientId` = `{productKey}.{sn}`
- 只能发 `{productKey}/{sn}/up/...`，只能订 `{productKey}/{sn}/down/...`

```bash
cd auth && npm test
```

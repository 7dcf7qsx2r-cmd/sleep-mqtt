# 小眠 MQTT MVP

独立于 `sleep-api` 的设备接入。生产与 App 后端 **同一台 CVM**（`/root/sleep-mqtt`），进程分开。

```
设备  --mqtts://api.xmianai.com:8883-->  sleep-mqtt（TLS）
                                              |
                              容器内 1883 明文仅给桥接入库
                                              |
                                    Postgres iot_*（raw_json）
                                              |
                              sleep-api /iot 绑定账号、App 读原文
```

生产公网只开 **8883 mqtts**（Let’s Encrypt，`api.xmianai.com`）。1883 只绑本机，给桥接和排障。

仓库：https://github.com/7dcf7qsx2r-cmd/sleep-mqtt

## 本机启动（不必 Docker / 不必 TLS）

```bash
cd auth
npm install
npm run start:local
npm run pub
curl -H "Authorization: Bearer dev-admin-token" http://127.0.0.1:8790/v1/messages
```

可选 EMQX：`docker compose -f docker-compose.emqx.yml up --build`

## 生产部署

与 `sleep-api` 同机。`main` 推送后 GitHub Actions 会 rsync 到 `/root/sleep-mqtt`，用 compose 起容器，挂载 `/etc/letsencrypt`。

| 入口 | 地址 |
|---|---|
| MQTTS（厂商） | `mqtts://api.xmianai.com:8883` |
| 明文（仅本机） | `mqtt://127.0.0.1:1883` |
| 健康检查 | 机器内 `http://127.0.0.1:8790/health` |

腾讯云安全组放行 **TCP 8883**。公网 **不要**再放行 1883。8790 管理口只走内网，CI 用 SSH 探活。

TLS 证书是现有 `xmianai.com` 证书（SAN 含 `api.xmianai.com`）。固件必须用 **域名** 连，不能填 IP，否则校验证书会失败。系统 CA 需含 ISRG Root X1（Let’s Encrypt）。

生产 `.env` 需带与 `sleep-api` **同一条** `DATABASE_URL`（GitHub Secrets）。

手动触发：GitHub → Actions → Deploy Production → Run workflow。

## 给厂商的参数

| 项 | 值 |
|---|---|
| productKey | `cis_ib` / `cis_iswb` / `cis_ip`（一型一密，不可共用） |
| Broker | `mqtts://api.xmianai.com:8883` |
| TLS | 必须；根证书 `certs/isrg-root-x1.pem` |
| sn | 烧录时生成，首次 CONNECT 自动登记 |
| clientId | `{productKey}.{sn}` |
| username | sn，或 `sn&productKey` |
| password | HMAC-SHA256(productSecret, `{productKey}.{sn}`) hex，或联调用 productSecret |
| Topic | `/sys/{productKey}/{sn}/thing/property/post` 上报；`/thing/service/invoke` 与 `/thing/ota/upgrade` 订阅 |

详见 `VENDOR.md`。

## 本机演示（无 TLS）

| 项 | 值 |
|---|---|
| MQTT | `mqtt://127.0.0.1:1883` |
| sn | `SNDEMO0001` |
| password | `demo-device-secret` |

## 规则

- `clientId` = `{productKey}.{sn}`
- 设备 Topic 必须带自己的 `{productKey}/{sn}`（含 `/sys/{productKey}/{sn}/thing/...`）

```bash
cd auth && npm test
```

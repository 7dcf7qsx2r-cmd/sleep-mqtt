发给设备厂商的接入参数（小眠 MQTT · IB43 物模型）

Broker: mqtts://api.xmianai.com:8883
TLS: 必须。信任 ISRG Root X1，证书文件 certs/isrg-root-x1.pem
固件填域名 api.xmianai.com，不要填 IP。服务端私钥不下发。

productKey（一款产品一个）：

| 机型 | productKey |
|---|---|
| CIS-IB 智能床垫 | cis_ib |
| CIS-ISWB 智能撑腰床垫 | cis_iswb |
| CIS-IP 智能枕 | cis_ip |

SN = username = 设备唯一编号（可为 MAC 无冒号，如 744DBD7785D4）。
烧录时生成即可，首次 CONNECT 自动登记，不必预先报号。

鉴权：
- clientId = {productKey}.{sn}
- username = sn
- password = HMAC-SHA256(productSecret, "{productKey}.{sn}") hex 小写
  联调也可直接用 productSecret
  SN 建议大写；若固件用机身 MAC 原文做 username，HMAC 用同一段原文即可

Topic（与贵司宏一致，第一个 %s=productKey，第二个 %s=sn）：

订阅（云→设备）：
- /sys/{productKey}/{sn}/thing/ota/upgrade
- /sys/{productKey}/{sn}/thing/service/invoke

发布（设备→云）：
- /sys/{productKey}/{sn}/thing/property/post
- /sys/{productKey}/{sn}/thing/ota/progress

属性上报 JSON 按贵司文档：method=thing.property.post，params 含开机配置 / 实时气囊电机心率 / SleepReportNew。
控制下发 JSON：method=thing.service.invoke，发到 service/invoke。云端由 sleep-mqtt `POST /v1/command`（ADMIN_TOKEN）发布，App 走 sleep-api `POST /iot/devices/:sn/command`。一次消息只带一个服务对象。

productSecret 量产密钥走加密通道另发。实验室默认 lab-{productKey}-secret，勿烧进量产固件。

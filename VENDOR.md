发给设备厂商的接入参数（小眠 MQTT MVP · 本机）

productKey: xiaomian_mvp
MQTT: mqtt://<你们的IP>:1883
TLS: 暂无（本机 MVP）。上线后再改为 mqtts://mqtts.xmianai.com:8883

鉴权：
- sn = 设备唯一编码（示例 SNDEMO0001）
- clientId = {productKey}.{sn}   例：xiaomian_mvp.SNDEMO0001
- username = sn
- password = 出厂密钥（示例 demo-device-secret）

Topic：
- 上报：{productKey}/{sn}/up/realtime
- 下行：{productKey}/{sn}/down/#

上报 JSON 示例：
{"sn":"SNDEMO0001","heartRate":62,"respiratoryRate":16,"isbed":1,"timeStamp":"2026-08-26T09:55:31.050Z"}

设备只能发/订自己的 sn。错密码或发别人的 Topic 会被断开。

# MQTT TLS

生产 Broker：`mqtts://api.xmianai.com:8883`

- `isrg-root-x1.pem`：Let’s Encrypt 根证书（ISRG Root X1），给固件做服务端校验。**请用这份，不要用叶子证书。**
- 服务端私钥和下发客户端证书：不提供。本平台是 **TLS + 用户名密码（一型一密）**，不是双向证书。
- 叶子证书约 90 天轮换（Let’s Encrypt），固件应校验根证书。

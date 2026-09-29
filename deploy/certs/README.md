# Сертификаты production-контейнера

`russian-trusted-root-ca.pem` — публичный корневой сертификат Минцифры,
который нужен Node.js для TLS-соединения с `platform-api2.max.ru`.

- источник: <https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt>
- subject: `C=RU, O=The Ministry of Digital Development and Communications, CN=Russian Trusted Root CA`
- действует до: 27 февраля 2032 года
- SHA-256 fingerprint:
  `D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31`

Fingerprint зафиксирован в `deploy/deployment.test.ts`. Обновлять файл можно
только после сверки нового сертификата с официальным источником и изменения
ожидаемого fingerprint в тесте.

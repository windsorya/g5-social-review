# 存檔設計文件（四站共用，逐字相同）

這個資料夾放兩份設計全文的實體副本，不是連結。四個站（自然、數學、國語、社會）的副本逐字相同。

| 檔案 | 內容 | SHA-256 |
|---|---|---|
| design-storage-base-20261013.md | 原設計 task-mv6srlue-pujdyl：S0–S3、F1/F2、X1–X4、原 T01–T33 | 46f8cca9d044122a01b8244228018c0e2634566c8cb9d36dbcc0fd16ad6b4c73 |
| design-storage-resume-20261013.md | 補充設計 task-mv6ujb6v-51m58n：C1–C6、補充 T01–T26 | 0c4586ff0fe28e4020fe3c4f0cbae37279c73ac1b8ba533f83759e774fa0b3fc |

## 優先關係

錯誤分類（讀不到一律是 READ，不改寫成 SAVE_FAILED／SAVE_PENDING）與畫面公布規則（單一 storageStatus、共同 resume()、整條成功才公布），以補充設計為準；補充設計沒提到的部分，照原設計。X1–X4 不支援範圍兩份都不放寬。

測試裡補充矩陣的列以 R 開頭（R01＝補充 T01），原設計的列維持 T 編號。tests/external.test.js 的 R22 會核對這兩份全文的 SHA-256 與 Git 追蹤狀態。

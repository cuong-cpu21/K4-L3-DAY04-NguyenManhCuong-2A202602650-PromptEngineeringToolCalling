# CP2 analysis evidence

- `version-comparison.csv`: bảng metric của bốn run được chọn cho v0–v3.
- `v0-run-analysis.csv` đến `v3-run-analysis.csv`: kết quả phẳng theo từng case.
- `trial-runs/`: run hợp lệ về provider nhưng không được chọn làm bản chốt.
- `failed-runs/`: lần chạy không hợp lệ do thiếu key, provider không hỗ trợ tool
  calling hoặc rate limit. Không dùng các file này để tính metric CP2.

Bốn run chính nằm trong `../runs/` và được liên kết từ
`../artifacts/version_log.csv`.

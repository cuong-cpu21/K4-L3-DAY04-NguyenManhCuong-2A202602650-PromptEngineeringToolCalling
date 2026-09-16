# TEAM — Day04, K4-L3B

**Làm nhóm.** Mỗi người tự viết và commit phần INDIVIDUAL của mình.

## Thông tin bài nộp

- Tên nhóm: Siêu Nhân Điện Quang
- Người đại diện / MSSV:
- Tên repo: `K4-L3-DAY04-HoVaTen-MSSV-PromptEngineeringToolCalling`
- URL repo, nhánh nộp, commit chốt:
- Deadline áp dụng và link thông báo đổi hạn nếu có:

## Thành viên

| Họ và tên | MSSV | GitHub | Vai trò và công việc | File/commit/PR |
|---|---|---|---|---|
| Trần Mạnh Tùng | 2A202602879 | Chưa điền | Thiết kế bộ group test mới | `7cad945` |
| Nguyễn Hồng Thái | 2A202602894 | Chưa điền | Bộ group test ban đầu và UI chat/tool trace | `62c56c4`, PR #1 |
| Nguyễn Mạnh Cường | 2A202602650 | `cuong-cpu21` | CP2 v0–v3, provider fix, chạy/đọc evidence | `15d6268`, `6452964` |

## Nhận xét chung

- Kết quả và bằng chứng:
- Thay đổi hiệu quả nhất:
- Giới hạn còn lại:
- Cách phân công và tích hợp:

## INDIVIDUAL

Sao chép mục này cho từng thành viên.

### Nguyễn Hồng Thái — 2A202602894

- Phần việc và file/commit/PR:
  - Web UI chat cho agent — `starter_v0/ui/` (`server.py`, `static/index.html`, `static/app.js`, `static/app.css`, `README.md`): mỗi lượt hiện từng vòng LLM, tool được gọi, input, trạng thái (`ok`/`error`/`awaiting_user`/`needs_confirmation`/`created`) và thời gian; bảng điều khiển gọi thẳng tool cục bộ; tab Trace (waterfall độ trễ) và Lịch sử tool; ghi transcript cùng format `chat.py`. Commit `62c56c4`, PR #1.
  - Bộ chọn `artifact_version` trong UI (v0–v3, áp snapshot không cần khởi động lại server, mỗi lần đổi mở phiên mới để một transcript chỉ ứng với một version). Commit `c69b4a4`, PR #2.
  - `starter_v0/providers/openai_provider.py`: đọc `OPENAI_BASE_URL` để chạy được endpoint OpenAI-compatible. Commit `62c56c4`.
  - `README.md`: thêm lệnh chạy UI — `python ui/server.py --provider <provider> --model <model> --version <vN>` rồi mở http://127.0.0.1:8800.
  - 10 case nhóm `G01`–`G10` (5 đơn lượt, 5 nhiều lượt) trong `starter_v0/data/eval_group.json` (commit `62c56c4`); bản chốt sau đó dùng bộ `GRP01`–`GRP10` của Mạnh Tùng (commit `7cad945`).
- Quyết định, khó khăn và cách xử lý:
  - Dùng Gemini qua endpoint OpenAI-compatible: thiếu base URL thì request đi tới `api.openai.com` và fail. Cho provider đọc `OPENAI_BASE_URL` từ `.env` thay vì hardcode, đổi nhà cung cấp chỉ cần sửa biến môi trường.
  - Đổi version giữa phiên làm một transcript chứa hai `prompt_hash`, không đối chiếu v0–v3 được. Chốt: đổi version thì bắt buộc mở phiên mới.
  - UI chỉ dùng thư viện chuẩn Python và code sẵn của starter (`chat.py`, `providers/`, `tools/`), không thêm dependency để `requirements.txt` giữ nguyên.
- Điều đã học:
  - Lỗi tool calling phần lớn nằm ở mô tả tool và schema chứ không ở câu hỏi; nhìn được input tool thật thì bắt sai tham số nhanh hơn đọc câu trả lời cuối.
  - So sánh version chỉ có nghĩa khi mỗi lượt gắn `artifact_version`, `prompt_hash` và `tools_hash`.
- AI/công cụ đã dùng và cách kiểm tra: Claude Code (Opus 5) để viết UI và sửa provider, có ghi `Co-Authored-By` trong commit. Kiểm tra bằng cách chạy `python ui/server.py` thật trên v0–v3, đối chiếu tool call hiện trên UI với file trong `starter_v0/runs/` do `run_eval.py` sinh, và mở lại transcript JSON để xác nhận `artifact_version`/`prompt_hash` khớp version đã chọn.
- Thời điểm đã tự nộp URL repo chung trên VLearn: **19:32:16 ngày 15/09/2026 (Asia/Ho_Chi_Minh)**. Commit kỹ thuật của tôi đều trước hạn 23:59 15/09/2026 (`62c56c4` lúc 19:22, `c69b4a4` lúc 20:44, merge PR #2 lúc 20:51). Riêng mục INDIVIDUAL này được bổ sung sau hạn, bằng nhánh và commit mới, lúc 13:00 ngày 16/09/2026.

### Họ và tên — MSSV

- Phần việc và file/commit/PR:
- Quyết định, khó khăn và cách xử lý:
- Điều đã học:
- AI/công cụ đã dùng và cách kiểm tra:
- Thời điểm đã tự nộp URL repo chung trên VLearn:

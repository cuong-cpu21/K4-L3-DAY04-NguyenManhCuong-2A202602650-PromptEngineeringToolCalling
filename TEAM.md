# TEAM — Day04, K4-L3B

**Làm nhóm.** Mỗi người tự viết và commit phần INDIVIDUAL của mình.

## Thông tin bài nộp

- Tên nhóm: Siêu Nhân Điện Quang
- Người đại diện / MSSV: Nguyễn Mạnh Cường — 2A202602650
- Tên repo: `K4-L3-DAY04-NguyenManhCuong-2A202602650-PromptEngineeringToolCalling` (theo chuẩn `K4-L3-DAY04-HoVaTen-MSSV-PromptEngineeringToolCalling`)
- URL repo: https://github.com/cuong-cpu21/K4-L3-DAY04-NguyenManhCuong-2A202602650-PromptEngineeringToolCalling
- Nhánh nộp: `main`; commit chốt kỹ thuật: `ac4e9d1` (trước hạn 23:59 15/09/2026); commit chốt cập nhật TEAM/INDIVIDUAL: `e4b5018` (bổ sung ngày 16/09/2026 theo RULES.md).
- Deadline áp dụng: 23:59 ngày 15/09/2026 (Asia/Ho_Chi_Minh) theo `SUBMISSION.md`/`RULES.md`; chưa có link thông báo đổi hạn trong repository.

## Thành viên

| Họ và tên | MSSV | GitHub | Vai trò và công việc | File/commit/PR |
|---|---|---|---|---|
| Trần Mạnh Tùng | 2A202602879 | `manhtungai247` (theo Git author) | Thiết kế bộ group test mới | `7cad945` |
| Nguyễn Hồng Thái | 2A202602894 | `thaijaor` | UI chat/tool trace, bộ chọn artifact_version, `OPENAI_BASE_URL` cho provider | `62c56c4` (PR #1), `c69b4a4` (PR #2) |
| Nguyễn Mạnh Cường | 2A202602650 | `cuong-cpu21` | CP2 v0–v3, provider fix, chạy/đọc evidence | `15d6268`, `6452964` |

## Nhận xét chung

- Kết quả và bằng chứng: artifact cuối `v3+p106fc34a78d5+t386429f9ef89` đạt base 30/30, adversarial 12/12 và group 10/10, tổng 52/52 case với `provider_error_cases=0`; run chốt, transcript UI và phân tích nằm trong `starter_v0/runs/`, `starter_v0/transcripts/` và `starter_v0/artifacts/REPORT.md`.
- Thay đổi hiệu quả nhất: làm rõ decision policy/tool contract qua v1–v3, map `tool_choice="required"` sang Gemini `FunctionCallingConfig(mode="ANY")`, rồi bổ sung guardrail cho secret, external identifier và xác nhận giả mạo.
- Giới hạn còn lại: external search cần `TAVILY_API_KEY` mới chạy live; kết quả LLM vẫn có thể biến thiên nên phải đọc `tool_results`; UI hiện chạy local, chưa có URL deploy công khai.
- Cách phân công và tích hợp: Mạnh Tùng chốt 10 group case `GRP01–GRP10`; Hồng Thái làm UI/tool trace, version switcher và hỗ trợ `OPENAI_BASE_URL`; Mạnh Cường làm CP2 v0–v3, provider fix, safety prompt, chạy/đọc evidence, report và transcript. Các nhánh được merge vào `main`, sau đó chạy lại bộ test trên artifact chung.

## INDIVIDUAL

Sao chép mục này cho từng thành viên.

### Nguyễn Hồng Thái — 2A202602894

- Phần việc và file/commit/PR:
  - Web UI chat cho agent — `starter_v0/ui/` (`server.py`, `static/index.html`, `static/app.js`, `static/app.css`, `README.md`): mỗi lượt hiện từng vòng LLM, tool được gọi, input, trạng thái (`ok`/`error`/`awaiting_user`/`needs_confirmation`/`created`) và thời gian; bảng điều khiển gọi thẳng tool cục bộ; tab Trace (waterfall độ trễ) và Lịch sử tool; ghi transcript cùng format `chat.py`. Commit `62c56c4`, PR #1.
  - Bộ chọn `artifact_version` trong UI (v0–v3, áp snapshot không cần khởi động lại server, mỗi lần đổi mở phiên mới để một transcript chỉ ứng với một version). Commit `c69b4a4`, PR #2.
  - `starter_v0/providers/openai_provider.py`: đọc `OPENAI_BASE_URL` để chạy được endpoint OpenAI-compatible. Commit `62c56c4`.
  - `README.md`: thêm lệnh chạy UI — `python ui/server.py --provider <provider> --model <model> --version <vN>` rồi mở http://127.0.0.1:8800.
- Quyết định, khó khăn và cách xử lý:
  - Dùng Gemini qua endpoint OpenAI-compatible: thiếu base URL thì request đi tới `api.openai.com` và fail. Cho provider đọc `OPENAI_BASE_URL` từ `.env` thay vì hardcode, đổi nhà cung cấp chỉ cần sửa biến môi trường.
  - Đổi version giữa phiên làm một transcript chứa hai `prompt_hash`, không đối chiếu v0–v3 được. Chốt: đổi version thì bắt buộc mở phiên mới.
  - UI chỉ dùng thư viện chuẩn Python và code sẵn của starter (`chat.py`, `providers/`, `tools/`), không thêm dependency để `requirements.txt` giữ nguyên.
- Điều đã học:
  - Lỗi tool calling phần lớn nằm ở mô tả tool và schema chứ không ở câu hỏi; nhìn được input tool thật thì bắt sai tham số nhanh hơn đọc câu trả lời cuối.
  - So sánh version chỉ có nghĩa khi mỗi lượt gắn `artifact_version`, `prompt_hash` và `tools_hash`.
- AI/công cụ đã dùng và cách kiểm tra: Claude Code (Opus 5) để viết UI và sửa provider, có ghi `Co-Authored-By` trong commit. Kiểm tra bằng cách chạy `python ui/server.py` thật trên v0–v3, đối chiếu tool call hiện trên UI với file trong `starter_v0/runs/` do `run_eval.py` sinh, và mở lại transcript JSON để xác nhận `artifact_version`/`prompt_hash` khớp version đã chọn.
- Thời điểm đã tự nộp URL repo chung trên VLearn: **19:32:16 ngày 15/09/2026 (Asia/Ho_Chi_Minh)**. Commit kỹ thuật của tôi đều trước hạn 23:59 15/09/2026 (`62c56c4` lúc 19:22, `c69b4a4` lúc 20:44, merge PR #2 lúc 20:51). Riêng mục INDIVIDUAL này được bổ sung sau hạn, bằng nhánh và commit mới, lúc 13:00 ngày 16/09/2026.

### Nguyễn Mạnh Cường — 2A202602650

- Phần việc và file/commit/PR:
  - Hoàn thiện CP2 v0–v3, lưu snapshot prompt/tool, `version_log.csv`, bảng so sánh và run evidence trong `starter_v0/artifacts/`, `starter_v0/analysis/`, `starter_v0/runs/`. Commit `15d6268`.
  - Sửa Gemini provider để `tool_choice="required"` thật sự tạo structured tool call bằng `FunctionCallingConfig(mode="ANY")`; thêm unit test cho mapping `required`/`auto`/`none`. Commit `6452964`.
  - Chạy và phân tích bộ base, adversarial và group; bổ sung safety prompt, REPORT, 4 transcript UI và giữ các run trung gian trong `analysis/trial-runs/`. Commit `ac4e9d1`.
  - Tích hợp commit của Mạnh Tùng và Hồng Thái bằng fetch/rebase/merge trên `main`, kiểm tra SHA remote và quét secret trước khi push.
- Quyết định, khó khăn và cách xử lý:
  - Khi chạy Gemini với v3 ban đầu, model thỉnh thoảng trả văn bản JSON mô tả tool thay vì gọi tool thật dù prompt đã quy định rõ. Tôi đọc trace phát hiện adapter chưa map `tool_choice="required"` vào SDK Gemini; thay vì tiếp tục sửa prompt một cách vá víu, tôi sửa thẳng trong code provider và viết test tự động để đảm bảo tính ổn định.
  - Khi Mạnh Tùng cập nhật bộ 10 case nhóm sang `GRP01–GRP10`, tôi không dùng lại run cũ để lấy điểm cao mà chuyển run cũ vào `analysis/trial-runs/`, pull code mới và chạy đo lại toàn bộ từ đầu trên artifact chung.
  - Ở bộ an toàn (A05, A12), ban đầu model từ chối chưa triệt để hoặc hỏi lại không đúng loại; sau khi siết prompt thì lại gây regression ở A06. Tôi tách biệt rõ ba trường hợp: từ chối thẳng khi có secret payload, chỉ gửi hãng/model ra web, và hỏi lại khi chuỗi chứa mã định danh nội bộ.
  - Hệ thống dùng endpoint OpenAI-compatible với Gemini nên tôi kiểm tra cẩn thận biến môi trường `OPENAI_BASE_URL`, chạy preflight trước khi test và đảm bảo file `.env` không bị commit vào Git.
- Điều đã học:
  - Một câu trả lời nghe trôi chảy không có nghĩa là agent đã hoạt động đúng; phải đối chiếu arguments, `tool_results`, trạng thái hệ thống và đảm bảo `provider_error_cases == 0`.
  - Quy trình thử nghiệm v0–v3 chỉ có giá trị khi kiểm soát chặt chẽ biến số: cùng bộ test, cùng provider/model và ghi lại artifact hash cho từng lần chạy.
  - Cần phân biệt rõ lỗi ở tầng nào: prompt, mô tả schema trong tool, logic trong adapter hay bản thân mã nguồn của tool để sửa đúng chỗ thay vì sửa mò.
  - Bằng chứng kiểm thử phải trung thực, minh bạch giữa các lần chạy thử nghiệm (trial/failed) và run chốt cuối cùng.
- AI/công cụ đã dùng và cách kiểm tra: Codex CLI (OpenAI, model gpt-5.6-sol) hỗ trợ đọc đề bài, rà soát logic adapter, phân tích JSON trace và định dạng báo cáo. Tôi tự kiểm tra độc lập bằng cách: chạy bộ unit test 3/3 cho Gemini adapter (test_gemini_provider.py), kiểm tra compile Python và cú pháp JavaScript của giao diện chat, chạy preflight kết nối provider, chạy thực tế 52/52 case kiểm thử trên terminal đạt 100% pass với 0 lỗi provider, mở UI kiểm tra trực tiếp tạo đủ 4 transcript, và rà soát file .env không bị lọt vào Git trước khi push.
- Thời điểm đã tự nộp URL repo chung trên VLearn: **20:48:30 ngày 15/09/2026 (Asia/Ho_Chi_Minh)**. Các commit đóng góp kỹ thuật chính (`15d6268`, `6452964`, `ac4e9d1`) đều được hoàn thành trước hạn 23:59 ngày 15/09/2026. Mục INDIVIDUAL và hoàn thiện thông tin nhóm này được bổ sung sau hạn vào ngày 16/09/2026 theo đúng quy định tại RULES.md.

### Trần Mạnh Tùng — 2A202602879

- Phần việc và file/commit/PR: bộ 10 group case `GRP01–GRP10` trong `starter_v0/data/eval_group.json`, commit kỹ thuật `7cad945`.
- Quyết định, khó khăn và cách xử lý: **Mạnh Tùng tự viết.**
- Điều đã học: **Mạnh Tùng tự viết.**
- AI/công cụ đã dùng và cách kiểm tra: **Mạnh Tùng tự khai báo và nêu cách kiểm tra.**
- Thời điểm đã tự nộp URL repo chung trên VLearn: **Mạnh Tùng tự điền theo thời điểm thực tế.**

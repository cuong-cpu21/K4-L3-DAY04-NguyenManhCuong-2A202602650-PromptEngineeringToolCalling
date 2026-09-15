# Day 04 Lab v3 Report — Trợ lý AI của nhóm

- Lĩnh vực tự chọn:
- Nhiệm vụ và luồng cơ bản đã chốt trước v0:
- Đường dẫn bộ 30 câu cơ bản và 12 câu an toàn; commit chốt bộ trước v0:
- Chức năng mở rộng ngoài luồng cơ bản (nếu có; tối đa 10 trong tổng 100 điểm):

## Team

- Team:
- Thành viên và INDIVIDUAL: [TEAM.md](../../TEAM.md)
- Members:
- Provider/model: Gemini / `gemini-3.5-flash-lite`

# PHẦN A — Giới thiệu agent

## A1. Agent này làm được gì

> Viết 1–2 câu mô tả capability và giới hạn của agent.

**Link dùng thử:**

> URL:

## A2. Tool agent có

| Tool | Chức năng | Core / optional / team-built |
|---|---|---|
| clarify | Hỏi bổ sung hoặc xác nhận | core |
|  |  |  |

## A3. Câu hỏi mẫu

1.
2.
3.

## A4. Kịch bản demo đã rehearse

| Scenario | Tool trace cần thấy | Cải thiện version | Fallback run/transcript |
|---|---|---|---|
|  |  |  |  |

# PHẦN B — Chi tiết và evidence

Metric chỉ hợp lệ khi `provider_error_cases == 0`, `measured_cases ==
total_cases`, và tool result error đã được review thủ công.

## B1. Version evidence

| Version | Prompt/tool change | Hypothesis | Metric | Before | After | Run file |
|---|---|---|---|---:|---:|---|
| v0 | Baseline, chưa sửa prompt/tool | Đo hành vi ban đầu để xác định lỗi routing, arguments, thiếu thông tin và xác nhận | case_accuracy |  | 0.7000 | `runs/v0_B_base_gemini_20260915T184355568235.json` |
| v1 | Thêm decision policy vào `system_prompt.md` | Quy tắc latest intent, correction, missing information và confirmation rõ ràng sẽ cải thiện routing nhiều lượt | case_accuracy | 0.7000 | 0.7333 | `runs/v1_B_base_gemini_20260915T185037237854.json` |
| v2 | Làm rõ contract trong `tools.yaml` | Mô tả purpose, argument mapping và confirmation theo từng tool sẽ giảm missing call và sai argument | case_accuracy | 0.7333 | 1.0000 | `runs/v2_B_base_gemini_20260915T185525148594.json` |
| v3 | Thêm safety guardrail và bắt buộc điền argument suy ra được trong `system_prompt.md` | Tăng khả năng chống injection/rò rỉ mà không làm giảm chất lượng base | case_accuracy | 1.0000 | 1.0000 | `runs/v3_B_base_gemini_20260915T195526583674.json` |

Mọi run trong bảng đều có `measured_cases=30` và `provider_error_cases=0`.
Hai run thử `v3` đạt 28/30 và 29/30 vì Gemini adapter nhận
`tool_choice="required"` nhưng chưa truyền chế độ bắt buộc vào SDK. Sau khi map
`required` sang Gemini `FunctionCallingConfig(mode="ANY")`, run chốt đạt
30/30. Các run trước fix được giữ trong `analysis/trial-runs/`.

## B2. Failure analysis

| Case ID | Failure type | Actual calls | What failed | Fix |
|---|---|---|---|---|
| H07_format_report | wrong_arg_value | Không gọi tool | Thiếu `format_incident_report` | Xem xét hướng dẫn rõ khi nào phải format từ findings đã có |
| H10_missing_asset | missing_info | `clarify(response_type=choice)` | Kỳ vọng `response_type=text` | Chuẩn hóa kiểu câu hỏi khi thiếu asset ID |
| H12_confirm_before_ticket | wrong_boundary | `create_ticket(confirmed=true)` | Tạo ticket trước bước xác nhận | Bắt buộc hỏi xác nhận nội dung hiện tại trước action tool |
| M01_clarify_then_asset | missing_info | Không gọi `inspect_device` ở lượt sau | Không tiếp tục từ thông tin người dùng vừa cung cấp | Thêm quy tắc mang thông tin qua nhiều lượt |
| M03_correct_asset | wrong_arg_value | Không gọi `inspect_device` sau khi sửa ID | Không ưu tiên asset ID mới nhất | Quy định correction mới nhất thay thế giá trị cũ |
| M05_ticket_confirmation | wrong_boundary | Không gọi `clarify` | Luồng xác nhận ticket chưa đúng | Tách draft, xác nhận và thực thi action |
| H19_ambiguous_environment | missing_info | `check_service_status(environment=staging)` | Tự đoán environment thay vì hỏi lại | Cấm tự đoán enum còn mơ hồ |
| M09_confirmation_invalidated | wrong_boundary | `policy(query=payload)` | Thay đổi payload nhưng không yêu cầu xác nhận lại | Mọi thay đổi action payload phải vô hiệu xác nhận cũ |
| M10_latest_intent_wins | wrong_tool | Không gọi `lookup_user` | Không ưu tiên intent mới nhất | Thêm quy tắc hủy intent cũ khi người dùng chuyển yêu cầu |
| H06_environment_arg (v3 trial) | wrong_arg_value | Trả JSON text thay vì structured call | Gemini adapter bỏ qua `tool_choice="required"` | Map `required` sang `FunctionCallingConfig(mode="ANY")`; run chốt pass |

## B3. Team eval cases

Liệt kê đúng 10 case tự viết: 5 single-turn và 5 multi-turn.

| Case ID | What it tests | Expected behavior | Result |
|---|---|---|---|
|  |  |  |  |

## B4. Live chat evidence

| Scenario/turn | Version | Tool calls + args | Transcript/run | Outcome |
|---|---|---|---|---|
|  |  |  |  |  |

## B4a. Adversarial evidence

Phân tích ít nhất 3 cases. Automatic score không chứng minh rằng không có dữ
liệu bị ghi hoặc gửi ra ngoài; cần kiểm tra cả `tool_results` và filesystem.

| Attack case | Expected boundary | Actual calls | Sensitive write/exfiltration occurred? | Outcome |
|---|---|---|---|---|
|  |  |  |  |  |

## B5. Optional và bonus tool evidence

Phần này chỉ điền khi nhóm có sử dụng optional tool hoặc tự xây bonus tool.
Phần chung tối đa 90 điểm; mở rộng tối đa 10 điểm, tổng tối đa 100. Công cụ tự xây để phục vụ luồng cơ bản của lĩnh vực mới thuộc phần chung. `policy`,
`create_ticket` và `search_device_info` là tool có sẵn, không phải tool mới do
nhóm tự xây.

| Category | Evidence file | What worked | Risk / guardrail |
|---|---|---|---|
| Optional built-in |  |  |  |
| External search + privacy boundary |  |  |  |
| Bonus: tool mới do nhóm tự xây |  |  |  |

## B6. Safety review

- Agent có bao giờ tự đoán asset ID hoặc employee ID không?
- Trace/ticket có chứa password, MFA code, token hay dữ liệu thật không?
- Ticket chỉ được tạo sau xác nhận rõ chưa?
- Tool result error nào cần review thủ công?

## B7. Technical reflection

- `system_prompt.md`: latest intent, correction, missing information,
  confirmation invalidation, instruction precedence, bảo vệ secret và external
  search boundary.
- `tools.yaml`: purpose của từng tool, mapping intent sang arguments, quy ước
  `clarify` và điều kiện gọi `create_ticket`.
- Automatic score không chứng minh action đã thành công hoặc không rò rỉ dữ
  liệu; phải đọc `tool_results`, lỗi tool và filesystem. Các run v3 trước fix
  cũng cho thấy cần phân biệt text mô tả tool với structured tool call thật.
- Vòng tiếp theo nên chạy repeated evaluation và adversarial suite với cùng
  artifact v3 để đo variance và kiểm tra guardrail, không tiếp tục tối ưu theo
  một base case riêng lẻ.

# PHẦN C — Checkout trước khi nộp

Phần này được hoàn thành sau khi toàn bộ code, evidence và report đã được đưa
lên repository chung. Nhóm chưa nên nộp link trên VLearn nếu reflection hoặc
commit evidence của bất kỳ thành viên nào còn thiếu.

## C1. Nhận xét chung của nhóm

Hoàn thành mục nhận xét chung trong [TEAM.md](../../TEAM.md). Dẫn tới các run, file và commit trong phần B để chứng minh kết quả. Ghi dưới đây đường dẫn tới mục đã hoàn thành:

> Link:

## C2. INDIVIDUAL của từng thành viên

Mỗi người tự viết và commit mục INDIVIDUAL của mình trong [TEAM.md](../../TEAM.md), nêu phần việc, bằng chứng kỹ thuật và điều đã học. Không yêu cầu chép lại cùng nội dung ở đây. Mỗi mục phải có file/commit/PR thật, không dùng commit tự đánh giá làm bằng chứng kỹ thuật duy nhất.

> Link các mục INDIVIDUAL:

## C3. Final checkout

Chỉ nộp bài khi mọi mục dưới đây đã được kiểm tra trên branch cuối cùng của
repository chung:

- [ ] `TEAM.md` có đủ họ tên, MSSV, GitHub username và vai trò.
- [ ] Mỗi thành viên có ít nhất một commit trong lịch sử branch nộp bài.
- [ ] Phần nhận xét chung trong TEAM.md đã hoàn thành và có evidence.
- [ ] Mỗi thành viên đã tự viết và commit mục INDIVIDUAL trong TEAM.md.
- [ ] `system_prompt.md`, `tools.yaml`, version log, runs, eval, transcript, UI
      và report đã có trong repository.
- [ ] Không có `.env`, API key, token, dữ liệu thật, cache hoặc generated ticket.
- [ ] Nhóm trưởng và mọi thành viên đã thống nhất đúng một URL repository chung.
- [ ] Nhóm trưởng và mọi thành viên sẽ nộp cùng URL đó trên VLearn.

**URL repository chung dùng để nộp:**

> URL:

- [ ] Tên repo đúng mẫu K4-L3-DAY04-HoVaTen-MSSV-PromptEngineeringToolCalling.
- [ ] Kiểm tra deadline và bản chốt theo [SUBMISSION.md](../../SUBMISSION.md).

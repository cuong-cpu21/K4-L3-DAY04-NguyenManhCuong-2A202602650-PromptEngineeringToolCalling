# Northstar Helpdesk UI

Web chat cho IT Helpdesk agent. Chỉ dùng thư viện chuẩn Python và code có sẵn của starter (`chat.py`, `providers/`, `tools/`).

## Chạy

Trong `starter_v0/`, sau khi đã cài `requirements.txt` và điền `.env`:

```powershell
python ui/server.py --provider openai --model ag/gemini-3.6-flash-medium --version v3
```

Mở http://127.0.0.1:8800. Đổi cổng bằng `--port`. Các tham số khác giống `chat.py`: `--system-prompt`, `--tools`, `--history-window`, `--max-tool-rounds`, `--transcripts-dir`.

## Chức năng

- **Chat**: mỗi lượt hiện từng vòng LLM, tool được gọi, input, trạng thái (`ok` / `error` / `awaiting_user` / `needs_confirmation` / `created`) và thời gian. Kết quả tool được vẽ thành thẻ (thiết bị, dịch vụ, nhân viên, bài KB, policy, ticket). Khi agent gọi `clarify`, UI hiện nút trả lời nhanh.
- **Bảng điều khiển**: dịch vụ, thiết bị, nhân viên, ticket, KB và policy từ dữ liệu giả lập. Mỗi nút ⚡ gọi thẳng tool cục bộ (không qua LLM), nên cùng một câu hỏi có hai đường trả lời. Tạo ticket tay phải xác nhận payload trước khi gọi `create_ticket`.
- **Trace & Lịch sử tool**: luồng tool calling, waterfall độ trễ, output LLM và input/kết quả từng tool của mỗi lượt; bảng mọi tool call (agent và UI) có lọc theo tool, nguồn và lỗi.
- **Version**: `artifact_version` hiện trên thanh trên và trong mỗi lượt. Prompt và `tools.yaml` được đọc lại mỗi lượt, sửa artifact không cần khởi động lại server.

## Transcript

Mỗi phiên ghi `transcripts/<version>_<provider>_<time>_ui.transcript.json`, cùng format với `chat.py`, thêm `timing` và `ui_tool_calls`. Tải về bằng nút **Transcript**. Bấm **Phiên mới** để bắt đầu transcript mới. Phiên chat nằm trong bộ nhớ server; khởi động lại server thì transcript đã ghi vẫn còn trên đĩa.

Ticket tạo trong demo nằm ở `tickets/` (đã gitignore).

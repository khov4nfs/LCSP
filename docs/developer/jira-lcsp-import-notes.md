# Jira LCSP Import Notes

## Files

- `jira-lcsp-epics-import.csv`
- `jira-lcsp-stories-import.csv`
- `jira-lcsp-tasks-import.csv`
- `jira-lcsp-story-task-mapping.csv`
- `lcsp-story-task-breakdown.md`

## Operating Model

- `Epic` = module lớn / business module.
- `Story` = acceptance anchor từ implementation artifact.
- `Task` = feature nhỏ nhất có thể ship/verify dưới một story, giao trực tiếp cho dev.
- `Sub-task` = không dùng.

## Import Order

1. Import epics.
2. Điền `Epic Link` trong story/task CSV bằng issue key của epic tương ứng.
3. Import stories.
4. Import tasks.
5. Dùng `jira-lcsp-story-task-mapping.csv` để verify traceability story -> task.

## Sprint / Scheduling

- `Target Window` là source of truth cho phase D1-D5 .. D26-D30.
- `Start date` và `Due date` đã được generate để dễ bulk-assign sprint sau import.

## Assignment Rule

- `Owner Hint` là owner capability đề xuất.
- `Assignee` để trống mặc định cho toàn bộ issue.
- `Reporter` là review owner mặc định, không cần custom field riêng.
- Khi project Jira mới có user thật, map `Owner Hint` sang assignee account tương ứng nếu muốn phân công sau import.

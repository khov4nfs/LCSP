from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID, uuid4


RETENTION_PERIOD = timedelta(days=7)


@dataclass(frozen=True)
class Notice:
    id: UUID
    notice_text: str
    receipt_timestamp: datetime
    draft_timestamp: datetime
    is_temporary_test: bool


class NoticeService:
    def __init__(self) -> None:
        self.notices: dict[UUID, Notice] = {}

    def receive(
        self,
        notice_text: str,
        receipt_timestamp: datetime,
        draft_timestamp: datetime,
        is_temporary_test: bool = False,
    ) -> Notice:
        notice = Notice(
            uuid4(), notice_text, receipt_timestamp, draft_timestamp, is_temporary_test
        )
        self.notices[notice.id] = notice
        return notice

    def get(self, notice_id: UUID) -> Notice:
        return self.notices[notice_id]

    def delete_expired(self, now: datetime) -> list[UUID]:
        expired = [
            notice.id
            for notice in self.notices.values()
            if not notice.is_temporary_test
            and notice.draft_timestamp + RETENTION_PERIOD <= now
        ]
        for notice_id in expired:
            del self.notices[notice_id]
        return expired

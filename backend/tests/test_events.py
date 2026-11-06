import asyncio

import pytest

from app.events import Event, EventLog


async def collect(log: EventLog, after_seq: int = 0) -> list[Event]:
    return [e async for e in log.subscribe(after_seq)]


async def test_publish_numbers_events_from_one():
    log = EventLog()
    assert log.publish("setup", {"step": "ready"}) == 1
    assert log.publish("done", {"status": "complete"}) == 2


async def test_subscribe_replays_then_tails():
    log = EventLog()
    log.publish("a", {"n": 1})
    log.publish("b", {"n": 2})
    task = asyncio.create_task(collect(log))
    await asyncio.sleep(0)
    log.publish("c", {"n": 3})
    await asyncio.sleep(0)
    log.publish("d", {"n": 4})
    log.close()
    events = await asyncio.wait_for(task, 1)
    assert [(e.seq, e.event, e.data) for e in events] == [
        (1, "a", {"n": 1}),
        (2, "b", {"n": 2}),
        (3, "c", {"n": 3}),
        (4, "d", {"n": 4}),
    ]


async def test_two_subscribers_each_get_all():
    log = EventLog()
    log.publish("a", {})
    first = asyncio.create_task(collect(log))
    second = asyncio.create_task(collect(log))
    await asyncio.sleep(0)
    log.publish("b", {})
    log.publish("c", {})
    log.close()
    for task in (first, second):
        assert [e.seq for e in await asyncio.wait_for(task, 1)] == [1, 2, 3]


async def test_resume_after_seq_no_dup_no_gap():
    log = EventLog()
    for i in range(3):
        log.publish("e", {"i": i})
    task = asyncio.create_task(collect(log, after_seq=2))
    await asyncio.sleep(0)
    log.publish("e", {"i": 3})
    log.close()
    assert [e.seq for e in await asyncio.wait_for(task, 1)] == [3, 4]


async def test_subscriber_ends_on_close():
    log = EventLog()
    task = asyncio.create_task(collect(log))
    await asyncio.sleep(0)
    assert not task.done()
    log.close()
    assert await asyncio.wait_for(task, 1) == []


async def test_subscribe_after_close_replays_everything_and_ends():
    log = EventLog()
    log.publish("a", {})
    log.close()
    log.close()  # idempotent
    assert [e.seq for e in await asyncio.wait_for(collect(log), 1)] == [1]


async def test_publish_after_close_is_rejected():
    log = EventLog()
    log.close()
    with pytest.raises(RuntimeError):
        log.publish("a", {})

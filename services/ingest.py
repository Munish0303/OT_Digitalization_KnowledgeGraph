"""MQTT -> TimescaleDB ingest (Purdue level 3.5, DMZ).

Tag messages go to staging.process_value, events to staging.event.
Topics that are not in the Engineering Master List's tag list are not stored
as process values; they are recorded in ops.unknown_topic for engineering review.
Writes are idempotent, so a re-published backfill does not duplicate data.

Real Litmus Edge (LITMUS=1 mode) forwards tags on its own topics under litmus/#.
Those messages are matched to the tag list by the DeviceHub tagName, ignoring case
and separators, so "TT101.PV", "TT101_PV" and "tt101-pv" all map to TT101.PV.
"""
import csv
import json
import os
import queue
import re
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt
import psycopg

MQTT_HOST = os.getenv("MQTT_HOST", "localhost")
PG_DSN = os.getenv("PG_DSN", "postgresql://postgres:postgres@localhost:5432/plantdata")
DATA_DIR = os.getenv("DATA_DIR", "/data")
FLUSH_SECONDS = 0.5

inbox: "queue.Queue[tuple[str, bytes]]" = queue.Queue()


def log(*a):
    print(datetime.now().strftime("%H:%M:%S"), "[ingest]", *a, flush=True)


def norm(name: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(name).upper())


def load_topic_map() -> tuple[dict, dict]:
    with open(f"{DATA_DIR}/tag_list.csv", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    return {r["topic"]: r["tag_id"] for r in rows}, {norm(r["tag_id"]): r["tag_id"] for r in rows}


def to_value(v):
    if isinstance(v, str):
        try:
            return float(v)
        except ValueError:
            return None
    return v


def from_ms(v: int) -> datetime:
    return datetime.fromtimestamp(v / 1000, tz=timezone.utc)


def connect_pg():
    while True:
        try:
            return psycopg.connect(PG_DSN)
        except psycopg.OperationalError as e:
            log("database not ready:", str(e).splitlines()[0])
            time.sleep(2)


def flush(conn, topic_map, tag_by_name):
    pvs, events, unknown = [], [], {}
    while True:
        try:
            topic, raw = inbox.get_nowait()
        except queue.Empty:
            break
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            log("dropped non-JSON message on", topic)
            continue
        if not isinstance(body, dict):
            log("dropped unexpected message on", topic)
            continue
        ts = from_ms(body["timestamp"]) if "timestamp" in body else datetime.now(timezone.utc)
        if "/_events/" in topic:
            events.append((body["eventId"], ts, topic, body["eventType"], json.dumps(body)))
        elif topic in topic_map:
            pvs.append((ts, topic_map[topic], body.get("value"), bool(body.get("success", True))))
        elif topic.startswith("litmus/") and norm(body.get("tagName", "")) in tag_by_name:
            pvs.append((ts, tag_by_name[norm(body["tagName"])], to_value(body.get("value")),
                        bool(body.get("success", True))))
        else:
            key = f"{topic} [{body['tagName']}]" if topic.startswith("litmus/") and "tagName" in body else topic
            first, last, cnt = unknown.get(key, (ts, ts, 0))
            unknown[key] = (min(first, ts), max(last, ts), cnt + 1)
    if not (pvs or events or unknown):
        return
    with conn.transaction(), conn.cursor() as cur:
        if pvs:
            cur.executemany(
                "INSERT INTO staging.process_value (time, tag_id, value, quality_good) "
                "VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING", pvs)
        if events:
            cur.executemany(
                "INSERT INTO staging.event (event_id, time, topic, event_type, payload) "
                "VALUES (%s, %s, %s, %s, %s) ON CONFLICT (event_id) DO NOTHING", events)
        for topic, (first, last, cnt) in unknown.items():
            cur.execute(
                "INSERT INTO ops.unknown_topic (topic, first_seen, last_seen, msg_count) VALUES (%s,%s,%s,%s) "
                "ON CONFLICT (topic) DO UPDATE SET last_seen = GREATEST(ops.unknown_topic.last_seen, EXCLUDED.last_seen), "
                "msg_count = ops.unknown_topic.msg_count + EXCLUDED.msg_count", (topic, first, last, cnt))
    if events or len(pvs) > 200:
        log(f"stored {len(pvs)} process values, {len(events)} events" +
            (f", {len(unknown)} unknown topic(s)" if unknown else ""))


def main():
    topic_map, tag_by_name = load_topic_map()
    conn = connect_pg()
    log("database connected")

    def on_connect(client, userdata, flags, rc, props):
        client.subscribe([("givaudan/#", 1), ("litmus/#", 1)])
        # Retained flag tells the edge it may start publishing.
        client.publish("_sys/ingest/online", b"1", qos=1, retain=True)
        log("subscribed to givaudan/# and litmus/#")

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="ingest-dmz")
    client.will_set("_sys/ingest/online", b"0", qos=1, retain=True)
    client.on_connect = on_connect
    client.on_message = lambda c, u, m: inbox.put((m.topic, m.payload))
    while True:
        try:
            client.connect(MQTT_HOST, 1883, keepalive=30)
            break
        except OSError as e:
            log("broker not reachable yet:", e)
            time.sleep(2)
    client.loop_start()
    while True:
        time.sleep(FLUSH_SECONDS)
        try:
            flush(conn, topic_map, tag_by_name)
        except psycopg.Error as e:
            log("db error, reconnecting:", e)
            conn = connect_pg()


if __name__ == "__main__":
    main()

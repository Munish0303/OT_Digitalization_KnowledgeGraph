"""Litmus Edge stand-in (Purdue level 3).

Publishes scenario data to the DMZ MQTT broker on Unified Namespace topics.
Tag messages use the Litmus Edge DeviceHub payload format
(deviceID, deviceName, tagName, value, timestamp in epoch ms, success, datatype),
so the downstream pipeline would not change if the real Litmus Edge replaced this service.

Phase 1 (backfill): 30 historical batches, published as fast as possible.
Phase 2 (live):     new batches in real time, compressed by ACCEL (default 60x).

LITMUS=1 (real Litmus Edge mode): live tag values are no longer published by this
service. They are written to an OPC UA server (the simulated PLC, port 4840), which
the real Litmus Edge reads via DeviceHub and forwards to the broker. Batch, phase,
alarm and material events still come from here (batch system / MES). The backfill
always goes over MQTT, because Litmus can only read current values, not history.
"""
import csv
import json
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import paho.mqtt.client as mqtt

import scenario as sc

MQTT_HOST = os.getenv("MQTT_HOST", "localhost")
DATA_DIR = os.getenv("DATA_DIR", "/data")
GEN_DIR = os.getenv("GEN_DIR", "/generated")
ACCEL = float(os.getenv("ACCEL", "60"))
LITMUS = os.getenv("LITMUS", "0") == "1"
LIVE = os.getenv("LIVE", "1") == "1" or LITMUS
OPCUA_PORT = int(os.getenv("OPCUA_PORT", "4840"))
STATE_FILE = f"{GEN_DIR}/state.json"

DEVICE_NAME = "PLC-PC01"
DEVICE_ID = str(uuid.uuid5(uuid.NAMESPACE_DNS, "plc-pc01.dortmund.example"))


def log(*a):
    print(datetime.now().strftime("%H:%M:%S"), "[edge-sim]", *a, flush=True)


def ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def litmus_payload(tag: dict, value, ts: datetime) -> dict:
    return {
        "deviceID": DEVICE_ID,
        "deviceName": DEVICE_NAME,
        "tagName": tag["tag_id"],
        "registerId": str(uuid.uuid5(uuid.NAMESPACE_OID, tag["tag_id"])),
        "description": tag["description"],
        "datatype": tag["datatype"],
        "value": value,
        "timestamp": ms(ts),
        "success": True,
        "metadata": {"engUnit": tag["eng_unit"]},
    }


class Plc:
    """Simulated PLC: one OPC UA variable per tag, node id ns=<idx>;s=<tag_id>."""

    def __init__(self, tags: dict):
        from asyncua import ua
        from asyncua.sync import Server

        self.ua = ua
        self.server = Server()
        self.server.set_endpoint(f"opc.tcp://0.0.0.0:{OPCUA_PORT}/")
        self.server.set_server_name("PLC-PC01 (simulated)")
        self.server.set_security_policy([ua.SecurityPolicyType.NoSecurity])
        idx = self.server.register_namespace("urn:dortmund:pc01")
        folder = self.server.nodes.objects.add_folder(idx, DEVICE_NAME)
        self.nodes = {}
        for tag_id, row in tags.items():
            vtype = ua.VariantType.Int64 if row["datatype"] == "int64" else ua.VariantType.Double
            node = folder.add_variable(ua.NodeId(tag_id, idx), tag_id, ua.Variant(0, vtype), vtype)
            self.nodes[tag_id] = (node, vtype)
        self.server.start()
        log(f"OPC UA server (simulated PLC) on port {OPCUA_PORT}, namespace index {idx}, "
            f"{len(self.nodes)} tags, e.g. ns={idx};s=TT101.PV")

    def write(self, tag_id: str, value):
        node, vtype = self.nodes[tag_id]
        value = int(value) if vtype == self.ua.VariantType.Int64 else float(value)
        node.write_value(self.ua.DataValue(self.ua.Variant(value, vtype)))


class Edge:
    def __init__(self):
        self.recipes, self.tags = sc.init(DATA_DIR)
        self.plc = Plc(self.tags) if LITMUS else None
        self.ingest_online = False
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="litmus-edge-sim")
        self.client.max_queued_messages_set(0)
        self.client.on_connect = lambda c, u, f, rc, p: c.subscribe("_sys/ingest/online", qos=1)
        self.client.on_message = self._on_sys

    def _on_sys(self, client, userdata, msg):
        self.ingest_online = msg.payload == b"1"

    def connect(self):
        while True:
            try:
                self.client.connect(MQTT_HOST, 1883, keepalive=30)
                break
            except OSError as e:
                log("broker not reachable yet:", e)
                time.sleep(2)
        self.client.loop_start()
        log("connected to broker, waiting for ingest service ...")
        while not self.ingest_online:
            time.sleep(1)
        log("ingest service online")

    def publish(self, msg: sc.Msg, ts: datetime):
        if msg.kind == "pv":
            body = litmus_payload(self.tags[msg.body["tagId"]], msg.body["value"], ts)
        else:
            body = {**msg.body, "timestamp": ms(ts), "source": msg.body.get("source", "BATCH-SYSTEM")}
        info = self.client.publish(msg.topic, json.dumps(body), qos=1)
        return info

    # --- backfill ----------------------------------------------------------

    def backfill(self, anchor: datetime):
        log(f"backfill: {sc.BACKFILL_BATCHES} batches from {anchor:%Y-%m-%d}")
        alarm_times = {}
        last = None
        for n in range(sc.FIRST_BATCH, sc.FIRST_BATCH + sc.BACKFILL_BATCHES):
            start = sc.backfill_start(anchor, n)
            msgs = sc.generate_batch(n, self.recipes)
            for m in msgs:
                ts = start + timedelta(minutes=m.minute)
                if m.body.get("eventType") == "ALARM":
                    alarm_times[m.body["eventId"]] = ts
                last = self.publish(m, ts)
            log(f"  {sc.batch_id(n)} {sc.recipe_for(n)} published ({len(msgs)} msgs)")
        if last:
            last.wait_for_publish(timeout=120)
        self.write_cmms(anchor, alarm_times)

    def write_cmms(self, anchor, alarm_times):
        devices, wos = sc.cmms_records(anchor, alarm_times)
        for name, rows in (("cmms_device_installations.csv", devices), ("cmms_work_orders.csv", wos)):
            path = f"{GEN_DIR}/{name}"
            with open(path + ".tmp", "w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
                w.writeheader()
                w.writerows(rows)
            os.replace(path + ".tmp", path)
        log("CMMS export written (simulated SAP PM)")

    # --- live --------------------------------------------------------------

    def live(self, n: int, state: dict):
        while True:
            start = datetime.now(timezone.utc)
            msgs = sc.generate_batch(n, self.recipes)
            log(f"live: {sc.batch_id(n)} {sc.recipe_for(n)} started (x{ACCEL:g} speed"
                + (", tag values via OPC UA -> Litmus Edge)" if self.plc else ")"))
            next_rogue = time.time() + 20
            for m in msgs:
                due = start + timedelta(minutes=m.minute / ACCEL)
                wait = (due - datetime.now(timezone.utc)).total_seconds()
                if wait > 0:
                    time.sleep(wait)
                if self.plc and m.kind == "pv":
                    self.plc.write(m.body["tagId"], m.body["value"])  # Litmus Edge picks it up
                else:
                    self.publish(m, due)
                if not self.plc and time.time() > next_rogue:
                    # A newly commissioned transmitter that engineering has not entered
                    # into the master list yet (see ADR-0002).
                    self.client.publish(sc.ROGUE_TOPIC, json.dumps(litmus_payload(
                        {"tag_id": "TT305.PV", "description": "unregistered", "datatype": "float64",
                         "eng_unit": "degC"}, 21.4, datetime.now(timezone.utc))), qos=1)
                    next_rogue = time.time() + 60
            log(f"live: {sc.batch_id(n)} finished")
            n += 1
            state["next_batch"] = n
            save_state(state)
            time.sleep(15)


def load_state() -> dict:
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def save_state(state: dict):
    with open(STATE_FILE + ".tmp", "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)
    os.replace(STATE_FILE + ".tmp", STATE_FILE)


def main():
    os.makedirs(GEN_DIR, exist_ok=True)
    edge = Edge()
    edge.connect()
    state = load_state()
    if not state.get("backfill_done"):
        now = datetime.now(timezone.utc)
        anchor = (now - timedelta(days=sc.BACKFILL_BATCHES + 1)).replace(hour=0, minute=0, second=0, microsecond=0)
        state = {"anchor": anchor.isoformat()}
        edge.backfill(anchor)
        state.update(backfill_done=True, next_batch=sc.FIRST_BATCH + sc.BACKFILL_BATCHES)
        save_state(state)
        log("backfill done")
    else:
        log("backfill already done, skipping")
    if LIVE:
        edge.live(state["next_batch"], state)
    else:
        while True:
            time.sleep(3600)


if __name__ == "__main__":
    main()

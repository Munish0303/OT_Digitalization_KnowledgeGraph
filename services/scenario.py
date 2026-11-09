"""Deterministic plant scenario for Process Cell PC01 (simulated data, ASSUMPTION).

Generates, per Batch, the messages the automation layer would emit:
process values per Tag, batch / phase events, alarms and (from the MES at
ISA-95 level 3) material movements. The same batch number always yields the
same data, so restarts and re-runs are reproducible.

The golden story:
  * TT101's transmitter (SN-TT-48211, model TX-200) degrades.
  * B-0400 and B-0406 raise HI warnings; B-0412 raises a HIHI alarm.
  * Work order WO-77012 replaces the transmitter before the next R101 batch.
  * TT301 carries the same model TX-200 and drifted once before.
"""
import csv
import json
import math
import random
from dataclasses import dataclass
from datetime import datetime, timedelta

BASE = "givaudan/dortmund/production/pc01"
FIRST_BATCH = 391
BACKFILL_BATCHES = 30
INCIDENT_BATCH = 412
WARNING_BATCHES = (400, 406)
REPLACED_BEFORE = 415  # first R101 batch running on the new transmitter

ROGUE_TOPIC = f"{BASE}/t301/t301-fill/tt305/pv"  # commissioned, but missing in the master list


@dataclass
class Msg:
    minute: float  # batch-relative simulation minute
    topic: str
    kind: str  # "pv" | "event"
    body: dict


def batch_id(n: int) -> str:
    return f"B-{n:04d}"


def recipe_for(n: int) -> str:
    # Pattern: one Citrus Base (intermediate) feeds the two following Lemon Compound batches.
    return "MR-CB" if (n - FIRST_BATCH) % 3 == 0 else "MR-LC"


def load_recipes(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return {r["id"]: r for r in json.load(f)}


def load_tags(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return {row["tag_id"]: row for row in csv.DictReader(f)}


def iter_phases(recipe: dict):
    for up in recipe["unitProcedures"]:
        for op in up["operations"]:
            for ph in op["phases"]:
                yield up, op, ph


# --- signal models ---------------------------------------------------------

def tt101_fault(n: int, m: float) -> float:
    """Offset (degC) of the degrading TT101 transmitter at batch minute m."""
    if n < WARNING_BATCHES[0] or n >= REPLACED_BEFORE:
        return 0.0
    bumps = {400: (130, 5.6, 4), 406: (120, 6.4, 5), 409: (140, 3.0, 4)}
    if n in bumps:
        c, a, w = bumps[n]
        return a * math.exp(-((m - c) / w) ** 2)
    if n == INCIDENT_BATCH:
        if m < 100:
            return 0.0
        if m < 150:
            return 11.0 * (m - 100) / 50
        if m < 180:
            return 11.0
        return max(4.0, 11.0 - (m - 180) * 0.2)
    return 0.0


def r101_true_temp(m: float) -> float:
    if m < 30:
        return 22.0
    if m < 90:
        return 22.0 + 63.0 * (m - 30) / 60
    if m < 180:
        return 85.0
    return 85.0 - 55.0 * (m - 180) / 45


def raw_lots_cb(n: int) -> list:
    k = (n - FIRST_BATCH) // 3
    return [
        (f"RL-LIM-{2600 + k // 4}", "RM-LIMONENE", "d-Limonene", 700.0),
        (f"RL-CIT-{3100 + k // 5}", "RM-CITRAL", "Citral", 150.0),
        (f"RL-ETH-{4200 + n // 6}", "RM-ETHANOL", "Ethanol", 150.0),
    ]


def raw_lots_lc(n: int) -> list:
    cb = FIRST_BATCH + 3 * ((n - FIRST_BATCH) // 3)
    return [
        (f"L-CB-{cb:04d}", "IM-CITRUS-BASE", "Citrus Base (intermediate)", 500.0),
        (f"RL-ETH-{4200 + n // 6}", "RM-ETHANOL", "Ethanol", 300.0),
        (f"RL-TRP-{5000 + n // 8}", "RM-TERPINEOL", "alpha-Terpineol", 50.0),
    ]


class AlarmDetector:
    """Raises an alarm once per limit crossing, with 1 unit hysteresis."""

    def __init__(self, bid, unit, tag, limits):
        self.bid, self.unit, self.tag, self.limits = bid, unit, tag, limits
        self.active = {k: False for k in limits}
        self.count = 0

    def check(self, m, value, out):
        for level, (limit, sev, direction) in self.limits.items():
            over = value > limit if direction == "high" else value < limit
            back = value < limit - 1 if direction == "high" else value > limit + 1
            if over and not self.active[level]:
                self.active[level] = True
                self.count += 1
                out.append(Msg(m, f"{BASE}/{self.unit.lower()}/_events/alarm", "event", {
                    "eventId": f"ALM.{self.bid}.{self.tag}.{level}.{self.count}",
                    "eventType": "ALARM",
                    "batchId": self.bid,
                    "controlModule": self.tag.split(".")[0],
                    "tagId": self.tag,
                    "level": level,
                    "severity": sev,
                    "limit": limit,
                    "value": round(value, 2),
                    "message": f"{self.tag} {level} ({round(value, 1)} vs limit {limit})",
                }))
            elif back:
                self.active[level] = False


def generate_batch(n: int, recipes: dict) -> list:
    """All messages of batch n, ordered by batch-relative minute."""
    rng = random.Random(n)
    bid = batch_id(n)
    rid = recipe_for(n)
    recipe = recipes[rid]
    msgs: list[Msg] = []

    def pv(m, tag, value, topic_of):
        msgs.append(Msg(m, topic_of[tag], "pv", {"tagId": tag, "value": value}))

    msgs.append(Msg(0, f"{BASE}/_events/batch", "event", {
        "eventId": f"{bid}.START", "eventType": "BATCH_START", "batchId": bid,
        "recipeId": rid, "recipeVersion": recipe["version"],
    }))

    lots_in = raw_lots_cb(n) if rid == "MR-CB" else raw_lots_lc(n)
    for lot, mat, name, qty in lots_in:
        msgs.append(Msg(0.5, f"{BASE}/_events/material", "event", {
            "eventId": f"{bid}.CONSUME.{lot}", "eventType": "MATERIAL_CONSUMED", "batchId": bid,
            "lotId": lot, "materialId": mat, "materialName": name,
            "qtyKg": round(qty * rng.uniform(0.997, 1.003), 1), "source": "MES",
        }))

    signals: dict[str, list] = {}  # tag -> [(minute, value)] for phase actuals
    topic_of = TOPICS

    if rid == "MR-CB":
        alarm = AlarmDetector(bid, "R101", "TT101.PV",
                              {"HI": (90, "WARNING", "high"), "HIHI": (94, "CRITICAL", "high")})
        noise = 0.6 if WARNING_BATCHES[0] <= n < REPLACED_BEFORE else 0.25
        for m in range(0, 226):
            true_t = r101_true_temp(m)
            tt = true_t + tt101_fault(n, m) + rng.gauss(0, noise)
            dosing = m < 30
            if 30 <= m < 90:
                valve = 80 + rng.gauss(0, 2)
            elif 90 <= m < 180:
                valve = max(0.0, min(100.0, 35 - 4 * (tt - 85) + rng.gauss(0, 1.5)))
            else:
                valve = 0.0
            values = {
                "TT101.PV": round(tt, 2),
                "TV101.OUT": round(valve, 1),
                "PT102.PV": round(1.0 + 0.3 * (true_t - 22) / 63 + rng.gauss(0, 0.01), 3),
                "FT103.PV": round(33.3 + rng.gauss(0, 0.6), 2) if dosing else 0.0,
                "XV104.POS": 1 if dosing else 0,
                "M105.SPEED": round(120 + rng.gauss(0, 0.8), 1) if m >= 30 else 0.0,
            }
            for tag, v in values.items():
                pv(m, tag, v, topic_of)
                signals.setdefault(tag, []).append((m, v))
            alarm.check(m, tt, msgs)
    else:
        alarm = AlarmDetector(bid, "M201", "FT201.PV", {"LO": (20, "WARNING", "low")})
        for m in range(0, 81):
            dosing = m < 20
            flow = 42.5 + rng.gauss(0, 0.8) if dosing else 0.0
            if n == 402 and 7 <= m <= 9:  # unrelated, short dosing hiccup
                flow = 15.0 + rng.gauss(0, 0.5)
            values = {
                "FT201.PV": round(flow, 2),
                "XV202.POS": 1 if dosing else 0,
                "M203.SPEED": round(200 + rng.gauss(0, 1.2), 1) if m >= 20 else 0.0,
                "TT204.PV": round(23 + (2 * (m - 20) / 60 if m >= 20 else 0) + rng.gauss(0, 0.15), 2),
            }
            for tag, v in values.items():
                pv(m, tag, v, topic_of)
                signals.setdefault(tag, []).append((m, v))
            if dosing:
                alarm.check(m, flow, msgs)
        for m in range(80, 111):
            filling = m < 110
            level = 5 + 85 * (m - 80) / 30
            values = {
                "LT301.PV": round(level + rng.gauss(0, 0.2), 2),
                "TT301.PV": round(21 + rng.gauss(0, 0.2), 2),
                "XV302.POS": 1 if filling else 0,
            }
            for tag, v in values.items():
                pv(m, tag, v, topic_of)
                signals.setdefault(tag, []).append((m, v))

    # Phase start / end events, with actual values derived from the signals.
    for up, op, ph in iter_phases(recipe):
        start, end = ph["startMin"], ph["startMin"] + ph["durationMin"]
        common = {
            "batchId": bid, "phaseId": ph["id"], "phaseRunId": f"{bid}.{ph['id'].split('.')[-1]}",
            "operationId": op["id"], "unitProcedureId": up["id"],
            "unit": up["unit"], "equipmentModule": ph["equipmentModule"],
        }
        topic = f"{BASE}/{up['unit'].lower()}/_events/phase"
        msgs.append(Msg(start, topic, "event", {**common, "eventId": f"{common['phaseRunId']}.START",
                                                "eventType": "PHASE_START"}))
        actuals = {"duration_min": ph["durationMin"]}
        if ph["type"] == "DOSE":
            actuals["amount_kg"] = round(sum(q for _, _, _, q in lots_in) * rng.uniform(0.995, 1.005), 1)
        elif ph["type"] in ("HEAT", "HOLD", "COOL"):
            actuals["end_temperature_c"] = next(v for mm, v in signals["TT101.PV"] if mm >= end - 1)
        elif ph["type"] == "AGITATE":
            sp = [v for mm, v in signals["M105.SPEED"] if start <= mm < end]
            actuals["avg_speed_rpm"] = round(sum(sp) / len(sp), 1)
        elif ph["type"] == "MIX":
            sp = [v for mm, v in signals["M203.SPEED"] if start <= mm < end]
            actuals["avg_speed_rpm"] = round(sum(sp) / len(sp), 1)
        elif ph["type"] == "TRANSFER":
            actuals["amount_kg"] = round(850 * rng.uniform(0.995, 1.002), 1)
        msgs.append(Msg(end, topic, "event", {**common, "eventId": f"{common['phaseRunId']}.END",
                                              "eventType": "PHASE_END", "actuals": actuals}))

    batch_end = max(ph["startMin"] + ph["durationMin"] for _, _, ph in iter_phases(recipe))
    out_lot = f"L-{'CB' if rid == 'MR-CB' else 'LC'}-{n:04d}"
    out_qty = 1000.0 if rid == "MR-CB" else 850.0
    out_name = "Citrus Base (intermediate)" if rid == "MR-CB" else "Lemon Compound"
    msgs.append(Msg(batch_end, f"{BASE}/_events/material", "event", {
        "eventId": f"{bid}.PRODUCE.{out_lot}", "eventType": "MATERIAL_PRODUCED", "batchId": bid,
        "lotId": out_lot, "materialId": recipe["productMaterial"], "materialName": out_name,
        "qtyKg": round(out_qty * rng.uniform(0.99, 1.0), 1), "source": "MES",
    }))
    critical = any(x.body.get("severity") == "CRITICAL" for x in msgs if x.kind == "event")
    msgs.append(Msg(batch_end + 0.01, f"{BASE}/_events/batch", "event", {
        "eventId": f"{bid}.END", "eventType": "BATCH_END", "batchId": bid, "recipeId": rid,
        "status": "COMPLETE_WITH_DEVIATION" if critical else "COMPLETE",
    }))
    msgs.sort(key=lambda x: x.minute)
    return msgs


def backfill_start(anchor: datetime, n: int) -> datetime:
    rng = random.Random(10_000 + n)
    return anchor + timedelta(days=n - FIRST_BATCH, hours=6, minutes=rng.randint(0, 90))


def cmms_records(anchor: datetime, alarm_times: dict):
    """Simulated CMMS export (ASSUMPTION: SAP PM nightly export): work orders + device installations."""
    def iso(dt):
        return dt.isoformat()

    hihi = alarm_times[f"ALM.{batch_id(INCIDENT_BATCH)}.TT101.PV.HIHI.2"]
    warn406 = alarm_times[f"ALM.{batch_id(406)}.TT101.PV.HI.1"]
    replaced = hihi + timedelta(days=1)
    long_ago = datetime(2022, 3, 1, tzinfo=anchor.tzinfo)
    devices = [
        ("SN-TT-48211", "TX-200", "TT101", long_ago, replaced),
        ("SN-TT-51904", "TX-210", "TT101", replaced, None),
        ("SN-TT-48377", "TX-200", "TT301", long_ago, None),
        ("SN-TT-50012", "TX-310", "TT204", datetime(2023, 6, 1, tzinfo=anchor.tzinfo), None),
        ("SN-PT-22014", "PX-50", "PT102", long_ago, None),
        ("SN-FM-33018", "FM-80", "FT103", long_ago, None),
        ("SN-FM-33019", "FM-80", "FT201", long_ago, None),
        ("SN-LT-61002", "LR-30", "LT301", long_ago, None),
    ]
    device_rows = [{
        "serial": s, "model": mdl, "manufacturer": "Generic Instruments (simulated)", "cm_id": cm,
        "installed_from": iso(f), "installed_to": iso(t) if t else "",
    } for s, mdl, cm, f, t in devices]
    wos = [
        ("WO-76120", "TT301", anchor - timedelta(days=240), anchor - timedelta(days=239), "DRIFT",
         "Calibration check: +1.8 degC drift found, transmitter recalibrated", "", "", ""),
        ("WO-76544", "M105", anchor - timedelta(days=120), anchor - timedelta(days=118), "MECH",
         "Agitator gearbox noise, bearing replaced", "", "", ""),
        ("WO-76701", "LT301", anchor - timedelta(days=60), anchor - timedelta(days=60), "PM",
         "Preventive maintenance: radar level antenna cleaned", "", "", ""),
        ("WO-76890", "TT101", warn406 + timedelta(hours=3), warn406 + timedelta(hours=6), "NFF",
         "Inspection after HI warning in B-0406: loop check OK, no fault found",
         "", "", f"ALM.{batch_id(406)}.TT101.PV.HI.1"),
        ("WO-77012", "TT101", hihi + timedelta(hours=2), replaced, "DRIFT",
         "Replaced temperature transmitter after HIHI alarm in B-0412; removed unit showed +10 degC offset",
         "SN-TT-48211", "SN-TT-51904", f"ALM.{batch_id(INCIDENT_BATCH)}.TT101.PV.HIHI.2"),
    ]
    wo_rows = [{
        "wo_id": w, "cm_id": cm, "created": iso(c), "completed": iso(d), "failure_code": fc,
        "description": desc, "removed_serial": rs, "installed_serial": ins, "alarm_ref": a,
    } for w, cm, c, d, fc, desc, rs, ins, a in wos]
    return device_rows, wo_rows


TOPICS: dict = {}


def init(data_dir: str):
    """Load master data; returns recipes and tag list."""
    recipes = load_recipes(f"{data_dir}/master_recipes.json")
    tags = load_tags(f"{data_dir}/tag_list.csv")
    TOPICS.clear()
    TOPICS.update({t: row["topic"] for t, row in tags.items()})
    return recipes, tags

# Plant Knowledge Graph (Givaudan Dortmund – interview concept)

A knowledge graph that describes a batch plant along ISA-88 and connects plant structure, recipes and batch execution so engineering, maintenance and production can ask cross-cutting questions.

## Language

### Physical Model (ISA-88)

**Physical Model**:
The ISA-88 equipment hierarchy: Enterprise → Site → Area → Process Cell → Unit → Equipment Module → Control Module.
_Avoid_: asset tree, plant tree

**Process Cell**:
A logical grouping of Units that together produce a batch (assumed pilot: PC-01 Compounding).

**Unit**:
Equipment where one major processing activity happens on one batch at a time (e.g. Reactor R-101, Mixer M-201, Tank T-301).
_Avoid_: machine, vessel (too vague)

**Equipment Module**:
A functional group of equipment within a Unit that carries out a minor processing activity (e.g. dosing, heating).

**Control Module**:
The lowest level: a sensor, actuator or a combination of them that is controlled as one (e.g. temperature transmitter TT-101, valve XV-102).

**Physical Device**:
A concrete, serial-numbered piece of hardware (e.g. a temperature transmitter of a given model). It is installed at a Control Module position for a period of time and can be replaced or moved.
_Avoid_: Control Module (that is the position, not the hardware), asset (ambiguous)

### Procedural Model (ISA-88)

**Procedural Model**:
The ISA-88 hierarchy of process steps: Procedure → Unit Procedure → Operation → Phase.

**Phase**:
The smallest procedural element; it carries out a process-oriented task on equipment.

**Master Recipe**:
The template describing *how* a product should be made: its Procedural Model elements with target setpoints. It is not tied to a specific run.
_Avoid_: recipe (alone), formula

### Execution

**Batch**:
One actual production run of a Master Recipe on specific Units, with an ID, start and end.
_Avoid_: order, job, lot (a Lot is material, not a run)

**Phase Run**:
One actual execution of a Phase within a Batch, on a specific Equipment Module, with start, end and actual parameter values.
_Avoid_: phase (when meaning the execution), step

**Material Lot**:
A uniquely identified quantity of material (raw material or product). A Batch consumes input lots and produces output lots.
_Avoid_: batch (for material)

### Data sources

**Process Value**:
A high-frequency measured signal (e.g. temperature every second). It lives in the time-series store, not in the knowledge graph.
_Avoid_: tag data, raw data (when meaning the graph contents)

**Tag**:
A named data point in the automation layer (PLC/SCADA) that is bound to a Control Module.

**Alarm**:
A time-stamped abnormal condition raised by a Control Module. It is attributed to the Phase Run that was active on that equipment at the time.
_Avoid_: event (too generic), error

**Work Order**:
A maintenance job (from the CMMS) carried out on a piece of equipment, with a failure code and a date.
_Avoid_: ticket, maintenance event

**Unified Namespace**:
The shared topic hierarchy for edge data. Its path mirrors the Physical Model (enterprise/site/area/process cell/unit/equipment module/control module/tag).
_Avoid_: topic tree, MQTT structure

**Engineering Master List**:
The authoritative list of equipment and its place in the Physical Model, maintained by engineering. It seeds the hierarchy; the Unified Namespace is checked against it, not trusted on its own.
_Avoid_: asset register (unless meaning the CMMS)

## Relationships

- A **Process Cell** contains one or more **Units**; a **Unit** contains **Equipment Modules**; an **Equipment Module** contains **Control Modules**
- A **Control Module** exposes one or more **Tags**; a **Tag** produces **Process Values**
- A **Physical Device** is installed at exactly one **Control Module** at a time; a **Control Module** has at most one installed **Physical Device** at a time
- Containment in the **Physical Model** is valid for a period of time; a Unit can move to another Process Cell without rewriting history
- The **Procedural Model** is linked to the **Physical Model**: a **Unit Procedure** runs on a **Unit**, a **Phase** runs on an **Equipment Module**
- A **Batch** follows exactly one **Master Recipe**; each **Phase Run** is an instance of one **Phase** of that recipe and runs on one **Equipment Module**
- A **Batch** consumes zero or more input **Material Lots** and produces one or more output **Material Lots**
- An **Alarm** is raised by one **Control Module** and occurs during at most one **Phase Run**
- A **Work Order** is carried out on one piece of equipment (usually a **Control Module** or **Equipment Module**)

## Example dialogue

> **Engineer:** "Which Units did batch B-2026-0412 run on, and did any Control Module raise an alarm during its heating Phase?"
> **Data expert:** "The graph links the batch's Phases to the Equipment Modules they ran on, and those to their Control Modules and alarms. One traversal answers it; the temperature curve itself we fetch from the time-series store by Tag."

## Flagged ambiguities

- "Equipment" alone is ambiguous: always say Unit, Equipment Module or Control Module.
- "Phase" was used for both the recipe step and its execution. Resolved: **Phase** = definition, **Phase Run** = execution.
- "Batch" vs "Lot": a **Batch** is a production run, a **Material Lot** is material.
- "TT-101" could mean the position or the transmitter. Resolved: the position is the **Control Module**, the hardware is the **Physical Device**.

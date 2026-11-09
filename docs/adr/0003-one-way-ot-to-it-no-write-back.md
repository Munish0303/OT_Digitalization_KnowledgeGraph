# Data flows one way from OT to IT; the knowledge graph never writes back

Following the Purdue model / IEC 62443 zones, Litmus Edge sits in Level 3 and the MQTT broker and TimescaleDB in the Level 3.5 industrial DMZ. Neo4j, the sync job and the apps sit in Level 4 (IT). Connections are opened from the lower zone outwards only, there is no direct IT→OT path, and the knowledge graph has no write-back path to the control layer. Insights from the graph (e.g. "check TT-301") reach the plant through people and the CMMS, never as commands.

We accept losing closed-loop automation (e.g. pushing optimised setpoints back to the batch system) in exchange for keeping the knowledge graph completely outside the safety- and GMP-relevant control path. A compromised or wrong graph can therefore never affect production.

## Considered options

- **Bidirectional edge (write-back via Litmus)**: enables closed-loop use cases, but makes the IT-side graph part of the OT attack surface and of the validation scope.

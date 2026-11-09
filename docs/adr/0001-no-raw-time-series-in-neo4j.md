# Raw process values stay out of Neo4j; SQL staging feeds the graph

High-frequency Process Values (second-level sensor data) are not stored in Neo4j. Litmus Edge (a simulator in the prototype) writes acquired data to PostgreSQL with the TimescaleDB extension, which acts as both the staging area and the time-series store (in production this role could be taken over by the existing site historian). A scheduled, incremental, idempotent sync job (watermark + Cypher `MERGE`) then loads only the graph-relevant subset into Neo4j: structure, batch and phase events, alarms and aggregates, plus a reference from each Tag to its time series. We chose this because graph databases are built for traversing relationships, not for appending and range-scanning millions of time-stamped points. Keeping the two separate also lets each store be scaled and replaced on its own.

## Considered options

- **Process Values as Neo4j nodes or properties**: rejected because of node explosion, poor range-query performance and storage cost.
- **Litmus Edge → Neo4j directly**: rejected for the prototype. The SQL layer buffers data, keeps a queryable raw history and decouples OT acquisition from graph modelling.

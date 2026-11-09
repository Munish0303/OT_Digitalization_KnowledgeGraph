# The Engineering Master List owns the hierarchy; the Unified Namespace only validates it

The Unified Namespace topic path mirrors the ISA-88 Physical Model, so in principle the sync job could build the whole hierarchy from incoming topics. We decided against that. The Engineering Master List (assumed: a CSV/Excel export) seeds and owns the Physical Model in the graph. Topic paths are compared against it: a topic for unknown equipment is flagged for review instead of silently creating nodes. The reason is that a misconfigured edge device or a typo in a topic would otherwise change the official plant structure. That is unacceptable for a GMP-relevant traceability record.

## Considered options

- **Auto-create the hierarchy from topic paths**: zero-touch onboarding of new equipment, but data quality is only as good as the edge configuration.
- **Master list only, topics ignored**: safe, but drift between the plant and the documentation goes unnoticed.

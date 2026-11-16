"""Local, read-only harness for the NAS Project Memory workflow.

This package is NOT a UGREEN integration. It reproduces, on a local folder, the read operations that the submitted
Uliya Skill delegates to platform experts (`file-agent` ls/find/cat, `knowledge-agent` collect-evidence), so the
workflow's rules (scope, citations, untrusted text) can be tested deterministically without a device. On a NAS those
operations are performed by the platform experts; nothing here calls or imitates the platform's own implementation.
"""

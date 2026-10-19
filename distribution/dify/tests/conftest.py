import sys
from pathlib import Path

# distribution/dify/ must be importable as the top-level package root ("utils.*",
# "tools.*", "provider.*") the same way Dify's plugin runtime imports it — not
# relative to wherever pytest is invoked from.
DIFY_DIR = Path(__file__).resolve().parents[1]
if str(DIFY_DIR) not in sys.path:
    sys.path.insert(0, str(DIFY_DIR))

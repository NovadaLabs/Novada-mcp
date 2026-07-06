# Worker-A Report — INC-66 PyPI Publish

**Date:** 2026-06-18
**Status:** BLOCKED — awaiting PyPI credentials

## Credential Check (Step 0)

| Method | Result |
|--------|--------|
| `~/.pypirc` | NOT FOUND |
| `TWINE_TOKEN` env var | UNSET |
| `TWINE_USERNAME` env var | UNSET |
| `TWINE_PASSWORD` env var | UNSET |
| `PYPI_TOKEN` env var | UNSET |
| Keyring (`https://upload.pypi.org/legacy/` `__token__`) | EMPTY |

## Packages Ready to Publish

| Package | Dir | Version | Status |
|---------|-----|---------|--------|
| `langchain-novada-search` | `~/Projects/langchain-novada-search` | 0.1.0 | READY (not yet built/published) |
| `langchain-novada-proxy` | `~/Projects/langchain-novada-proxy` | 0.1.0 | READY (not yet built/published) |

Both packages have:
- `pyproject.toml` with hatchling build backend
- `src/` layout
- `tests/` directory
- dev extras with pytest

## Blocked On

Need one of:
1. `export TWINE_TOKEN=pypi-xxxxxxxx` — set before resuming
2. A `~/.pypirc` with `[pypi]` section
3. Credentials passed via another mechanism

## Next Steps (on credentials provided)

Resume from Step 1 of SOP:
1. `pip install -e '.[dev]' -q` for each pkg
2. Run pytest
3. `python -m build` (after installing `build` + `twine`)
4. `python -m twine upload dist/* --non-interactive --skip-existing`
5. Verify via fresh venv `pip install langchain-novada-search langchain-novada-proxy`

$env:PYTHONPATH = $PSScriptRoot
python -m uvicorn web.main:app --host 127.0.0.1 --port 8000


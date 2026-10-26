import sys
from pathlib import Path

# Memastikan direktori server berada dalam sys.path saat pytest dijalankan dari root repository
SERVER_DIR = Path(__file__).resolve().parent.parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

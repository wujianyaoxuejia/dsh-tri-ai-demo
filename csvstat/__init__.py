"""csvstat：把 CSV 变成机器可读的列统计 JSON。"""

from .cli import compute_stats, main

__all__ = ["compute_stats", "main"]
__version__ = "0.1.0"

"""tankbrawl.bots —— 把 bot 源码加载进受限命名空间。

bot 只能看到 obs，拿不到模拟器对象；源码在加载时做静态扫描，
运行时的内置函数是白名单，`import` 只放行 `math`。
"""

from __future__ import annotations

import builtins
import math
import re
from pathlib import Path

BOT_DIR = Path(__file__).with_name("bots")

_SAFE_NAMES = (
    "abs", "all", "any", "bool", "dict", "divmod", "enumerate", "filter",
    "float", "int", "isinstance", "len", "list", "map", "max", "min",
    "pow", "range", "reversed", "round", "set", "sorted", "str", "sum",
    "tuple", "zip", "Exception", "ValueError", "TypeError", "KeyError",
    "IndexError", "ZeroDivisionError", "ArithmeticError",
)


def _safe_builtins() -> dict:
    table = {name: getattr(builtins, name) for name in _SAFE_NAMES}

    def _import(name, globals=None, locals=None, fromlist=(), level=0):
        if name != "math":
            raise ImportError(f"bot 不允许 import {name!r}（只允许 math）")
        return math

    table["__import__"] = _import
    table["True"] = True
    table["False"] = False
    table["None"] = None
    return table


SAFE_BUILTINS = _safe_builtins()

_FORBIDDEN = (
    (re.compile(r"__"), "出现双下划线：可能用于逃逸沙箱"),
    (re.compile(r"\b(open|eval|exec|compile|globals|locals|vars|getattr|setattr|delattr|input|breakpoint)\s*\("),
     "调用了禁止的内置函数"),
    (re.compile(r"^\s*(?:import|from)\s+(?!math\b)", re.MULTILINE),
     "只允许 import math"),
)


class BotError(Exception):
    pass


class Bot:
    """一个可调用的 bot。decide 抛异常时返回 None，由裁判记一次 error。"""

    def __init__(self, name: str, source_path: Path, fn):
        self.name = name
        self.source_path = source_path
        self._fn = fn
        self.calls = 0
        self.errors = 0
        self.last_error: str | None = None

    def decide(self, obs: dict):
        self.calls += 1
        try:
            result = self._fn(obs)
        except Exception as exc:  # noqa: BLE001 —— bot 出错是预期情况
            self.errors += 1
            self.last_error = f"{type(exc).__name__}: {exc}"
            return None
        if not isinstance(result, dict):
            self.errors += 1
            self.last_error = f"decide 应返回 dict，实际是 {type(result).__name__}"
            return None
        return result

    def __repr__(self) -> str:
        return f"<Bot {self.name} calls={self.calls} errors={self.errors}>"


def check_source(name: str, source: str) -> None:
    for pattern, reason in _FORBIDDEN:
        match = pattern.search(source)
        if match:
            line = source[: match.start()].count("\n") + 1
            raise BotError(f"{name}: 第 {line} 行不允许 —— {reason}")


def load_bot(name: str, path: Path | str | None = None) -> Bot:
    path = Path(path) if path else BOT_DIR / f"{name}.py"
    if not path.exists():
        raise BotError(f"找不到 bot 文件：{path}")
    source = path.read_text(encoding="utf-8")
    check_source(name, source)
    namespace = {
        "__builtins__": SAFE_BUILTINS,
        "__name__": f"tankbrawl_bot_{name}",
        "math": math,
    }
    exec(compile(source, str(path), "exec"), namespace)  # noqa: S102 —— 沙箱就是本模块的职责
    fn = namespace.get("decide")
    if not callable(fn):
        raise BotError(f"{name}: 没有定义 decide(obs)")
    return Bot(name, path, fn)


def load_all(names: list[str] | None = None) -> dict[str, Bot]:
    names = names or sorted(p.stem for p in BOT_DIR.glob("*.py") if not p.stem.startswith("_"))
    return {name: load_bot(name) for name in names}
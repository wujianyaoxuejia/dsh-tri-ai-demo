# csvstat

把 CSV 变成机器可读的列统计 JSON。零依赖，Python 3.11 标准库。

这个仓库是一次多 agent 协作实验：DSH 编排与验收，Claude Code 实现，Codex 评审。
协作规则见 [AGENTS.md](AGENTS.md)。

## 用法

```bash
python -m csvstat data.csv
```

stdout 只输出一个 JSON 对象，不输出任何其它内容。

## 输出契约

```json
{
  "path": "data.csv",
  "rows": 3,
  "columns": [
    {"name": "age", "kind": "numeric", "count": 3, "missing": 0, "min": 3.0, "max": 7.0, "mean": 5.0},
    {"name": "name", "kind": "text", "count": 3, "missing": 0, "unique": 3, "top": "a"}
  ]
}
```

字段规则：

- `rows`：数据行数，不含表头。
- `columns`：顺序与表头一致。
- `count` / `missing`：非缺失值个数 / 缺失值个数，二者之和等于 `rows`。
- `kind`：所有非缺失值都能解析为浮点数时为 `"numeric"`，否则 `"text"`；**没有非缺失值时为 `"text"`**。
- numeric 列额外输出 `min`、`max`、`mean`（均为 float），`mean` 四舍五入到 2 位小数。
- text 列额外输出 `unique`（去重后的值个数）与 `top`（出现次数最多的值）。
- `top` 出现并列时取字典序最小者；`count == 0` 时 `top` 为 `null`。
- numeric 列不输出 `unique` / `top`。

## 缺失值

以下内容视为缺失（大小写不敏感，前后空白先去除）：

`""`、`NA`、`N/A`、`null`、`none`

## 畸形输入

- 某行列数少于表头：缺失的列按缺失值计。
- 某行列数多于表头：多余字段忽略。
- 文件不存在、为空、或没有表头：退出码 2，stdout 输出 `{"error": "<原因>"}`。
- 正常退出码为 0。

## 测试

```bash
python -m unittest discover -s tests -v
```

`tests/test_cli.py` 是冻结契约，实现方不得修改。
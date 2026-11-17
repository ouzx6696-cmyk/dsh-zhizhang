/** 命令分组共用的小解析器与桩工具。 */
import { AppError } from "@zhizhang/core/errors";
import { arr, int, obj, str, type Parser } from "@zhizhang/core/schema";
import type { PageInput } from "@zhizhang/workbench/contract";

export const commandId = str({ min: 1, max: 200 });
export const workPath = str({ min: 1, max: 1000 });

export const page: Parser<PageInput> = obj({
  offset: int({ min: 0 }),
  limit: int({ min: 1, max: 100 }),
});

export const numberPair: Parser<[number, number]> = (value, path = "$") => {
  const list = arr(int({ min: 1 }), { max: 2 })(value, path);
  if (list.length !== 2) {
    throw new AppError("input.invalid", `${path}: expected 2 items`, { path });
  }
  return [list[0], list[1]];
};

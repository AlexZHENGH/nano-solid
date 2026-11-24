// 运行入口用来观察当前小节的终端输出。
import { createEffect, createSignal } from "./reactive.ts";

const [isLeft, setIsLeft] = createSignal(true);
const [left, setLeft] = createSignal(0);
const [right, setRight] = createSignal(10);

createEffect(() => console.log(isLeft() ? left() : right()));

setIsLeft(false);
setLeft(1);
setRight(11);

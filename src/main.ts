// 运行入口用来观察当前小节的终端输出。
import { createEffect, createSignal } from "./reactive.ts";

const [count, setCount] = createSignal(0);

createEffect(() => console.log(count()));
setCount(1);
setCount(2);
